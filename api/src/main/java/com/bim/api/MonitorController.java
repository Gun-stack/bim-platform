package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/** 모니터링(M6): 계통 멤버 장비 × 층/구역 × 상태 × 자산 × 작업지시 를 한 번에. 팀 매핑은 프론트(설정 한 곳). */
@RestController
@RequestMapping("/api/models/{id}")
class MonitorController {
	private final JdbcClient db;
	MonitorController(JdbcClient db) { this.db = db; }

	/** 배관·트레이·케이블 같은 "선" 은 빼고 장비만 (segments=true 면 포함) */
	@GetMapping("/monitor")
	Map<String, Object> monitor(@PathVariable UUID id, @RequestParam(defaultValue = "false") boolean segments) {
		List<Map<String, Object>> rows = db.sql("""
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name,
			       CASE WHEN sn.ifc_class = 'IfcBuildingStorey' THEN sn.name ELSE st.name END storey,
			       CASE WHEN sn.ifc_class = 'IfcSpace' THEN sn.name END zone,
			       coalesce(st.elevation, sn.elevation) elevation,
			       (SELECT string_agg(s.name, ',' ORDER BY s.id) FROM element_system es JOIN system s ON s.id = es.system_id WHERE es.element_id = e.id) systems,
			       (e.properties->'Pset_BimStatus')::text status,
			       a.id "assetId", a.tag "assetTag", a.status "assetStatus",
			       (SELECT max(inspected_on) FROM inspection i WHERE i.asset_id = a.id) "lastInspectedOn",
			       (SELECT result FROM inspection i WHERE i.asset_id = a.id ORDER BY inspected_on DESC, id DESC LIMIT 1) "lastResult",
			       (SELECT count(*) FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE') "openWorkOrders",
			       (SELECT w.assignee FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE' ORDER BY w.created_at DESC LIMIT 1) "woAssignee",
			       (SELECT w.due_on FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE' ORDER BY w.created_at DESC LIMIT 1) "woDueOn",
			       (SELECT w.status FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE' ORDER BY w.created_at DESC LIMIT 1) "woStatus"
			  FROM element e
			  JOIN element_system es0 ON es0.element_id = e.id
			  LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id
			  LEFT JOIN spatial_node st ON st.id = sn.parent_id AND st.ifc_class = 'IfcBuildingStorey'
			  LEFT JOIN asset a ON a.element_id = e.id
			 WHERE e.model_id = :id
			   AND (:seg OR e.ifc_class NOT IN ('IfcPipeSegment', 'IfcCableCarrierSegment', 'IfcCableSegment', 'IfcDuctSegment'))
			 GROUP BY e.id, sn.id, st.id, a.id
			 ORDER BY coalesce(st.elevation, sn.elevation) DESC NULLS LAST, e.ifc_class, e.name""")
			.param("id", id).param("seg", segments).query().listOfRows().stream().map(r -> {
				r.put("status", r.get("status") == null ? null : Json.parse((String) r.get("status")));
				r.put("systems", r.get("systems") == null ? List.of() : List.of(((String) r.get("systems")).split(",")));
				return r;
			}).toList();
		var power = db.sql("SELECT properties->'Pset_BimStatus'->>'Source' FROM element WHERE model_id = :id AND ifc_class = 'IfcSwitchingDevice' LIMIT 1").param("id", id).query(String.class).optional().orElse(null);
		return Map.of("power", power == null ? "UNKNOWN" : power, "rows", rows);
	}

	/** 최근 이벤트: 상태 변경(Pset_BimStatus.UpdatedAt — 상태 API 를 거친 것만 시각이 있다) + 작업지시 생성/변경. 최신순 limit */
	@GetMapping("/monitor/events")
	List<Map<String, Object>> events(@PathVariable UUID id, @RequestParam(defaultValue = "30") int limit) {
		return db.sql("""
			SELECT * FROM (
			  SELECT (e.properties->'Pset_BimStatus'->>'UpdatedAt')::timestamptz at, 'STATUS' kind, e.global_id "globalId", e.name,
			         e.properties->'Pset_BimStatus'->>'Status' status, coalesce(st.name, sn.name) storey, NULL::text "woTitle", NULL::text "woStatus"
			    FROM element e LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id LEFT JOIN spatial_node st ON st.id = sn.parent_id AND st.ifc_class = 'IfcBuildingStorey'
			   WHERE e.model_id = :id AND e.properties->'Pset_BimStatus'->>'UpdatedAt' IS NOT NULL
			  UNION ALL
			  SELECT coalesce(w.updated_at, w.created_at), 'WORK_ORDER', el.global_id, el.name, NULL, coalesce(st.name, sn.name), w.title, w.status
			    FROM work_order w JOIN asset a ON a.id = w.asset_id LEFT JOIN element el ON el.id = a.element_id
			    LEFT JOIN spatial_node sn ON sn.id = el.spatial_node_id LEFT JOIN spatial_node st ON st.id = sn.parent_id AND st.ifc_class = 'IfcBuildingStorey'
			   WHERE a.model_id = :id) x
			 ORDER BY at DESC NULLS LAST LIMIT :n""").param("id", id).param("n", Math.min(limit, 200)).query().listOfRows();
	}
}
