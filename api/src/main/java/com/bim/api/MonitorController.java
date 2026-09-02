package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 모니터링(M6): 계통 멤버 장비 × 층/구역 × 상태 × 자산 × 작업지시 를 한 번에. 팀 매핑은 프론트(teams.ts 한 곳). */
@RestController
@RequestMapping("/api/models/{id}")
class MonitorController {
	private final JdbcClient db;
	private final StatusService status;
	MonitorController(JdbcClient db, StatusService status) { this.db = db; this.status = status; }

	/** 배관·트레이·케이블 같은 "선" 은 빼고 장비만 (segments=true 면 포함). power 는 ATS 의 Source, 없으면 UNKNOWN(화면은 '전원 정보 없음') */
	@GetMapping("/monitor")
	Map<String, Object> monitor(@PathVariable UUID id, @RequestParam(defaultValue = "false") boolean segments) {
		List<Map<String, Object>> rows = db.sql("""
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name, coalesce(st.elevation, sn.elevation) elevation,
			""" + Sql.STOREY_ZONE_COLS + "," + Sql.SYSTEMS_AGG + """
			,
			       (e.properties->'Pset_BimStatus')::text status,
			       a.id "assetId", a.tag "assetTag", a.status "assetStatus",
			""" + Sql.ASSET_ROLLUP + "," + Sql.NEXT_DUE + """
			,
			       (SELECT w.assignee FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE' ORDER BY w.created_at DESC LIMIT 1) "woAssignee",
			       (SELECT w.due_on FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE' ORDER BY w.created_at DESC LIMIT 1) "woDueOn",
			       (SELECT w.status FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE' ORDER BY w.created_at DESC LIMIT 1) "woStatus"
			  FROM element e
			  JOIN element_system es0 ON es0.element_id = e.id
			""" + Sql.STOREY_ZONE_JOIN + """

			  LEFT JOIN asset a ON a.element_id = e.id
			 WHERE e.model_id = :id AND (:seg OR e.ifc_class NOT IN """ + Sql.SEGMENT_CLASSES + """
			)
			 GROUP BY e.id, sn.id, st.id, a.id
			 ORDER BY coalesce(st.elevation, sn.elevation) DESC NULLS LAST, e.ifc_class, e.name""")
			.param("id", id).param("seg", segments).query().listOfRows().stream().map(r -> {
				r.put("status", r.get("status") == null ? null : Json.parse((String) r.get("status")));
				r.put("systems", Sql.csv(r.get("systems")));
				return r;
			}).toList();
		return Map.of("power", status.powerSource(id).orElse("UNKNOWN"), "rows", rows);
	}

	/** 최근 이벤트: op_event 이력 — 상태 패치·작업지시 생성/상태 변경이 그때 값으로 쌓인다 (V6). 최신순 limit */
	@GetMapping("/monitor/events")
	List<Map<String, Object>> events(@PathVariable UUID id, @RequestParam(defaultValue = "30") int limit) {
		return db.sql("""
			SELECT ev.at, ev.kind, ev.global_id "globalId", e.name,
			       CASE WHEN ev.kind = 'STATUS' THEN ev.status END status,
			       coalesce(st.name, sn.name) storey,
			       ev.wo_title "woTitle", CASE WHEN ev.kind = 'WORK_ORDER' THEN ev.status END "woStatus"
			  FROM op_event ev
			  LEFT JOIN element e ON e.model_id = ev.model_id AND e.global_id = ev.global_id
			""" + Sql.STOREY_ZONE_JOIN + """

			 WHERE ev.model_id = :id ORDER BY ev.at DESC, ev.id DESC LIMIT :n""").param("id", id).param("n", Math.min(limit, 200)).query().listOfRows();
	}
}
