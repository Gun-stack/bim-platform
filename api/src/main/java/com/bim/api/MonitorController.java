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

	/** 경보 통계: 기간 안에 정상→ALARM/FAULT 로 넘어간 에피소드를 요소별로 센다 (계측 갱신으로 같은 상태가 반복 기록돼도 1건).
	 *  복구 = 그 뒤 처음 이상 아닌 상태가 기록된 시각. 팀 묶음·평균은 프론트(teams.ts)가 — 팀 매핑이 거기 한 곳이라 */
	@GetMapping("/monitor/stats")
	List<Map<String, Object>> stats(@PathVariable UUID id, @RequestParam(defaultValue = "30") int days) {
		return db.sql("""
			WITH ev AS (
			  SELECT global_id, at, status, LAG(status) OVER (PARTITION BY global_id ORDER BY at, id) prev
			    FROM op_event WHERE model_id = :id AND kind = 'STATUS' AND global_id IS NOT NULL),
			onset AS (
			  SELECT o.global_id, o.at, o.status,
			         (SELECT min(r.at) FROM ev r WHERE r.global_id = o.global_id AND r.at > o.at AND r.status NOT IN ('ALARM', 'FAULT')) recovered
			    FROM ev o
			   WHERE o.status IN ('ALARM', 'FAULT') AND coalesce(o.prev, '') NOT IN ('ALARM', 'FAULT') AND o.at > now() - make_interval(days => :d))
			SELECT o.global_id "globalId", e.name, e.ifc_class "ifcClass",
			""" + Sql.SYSTEMS_AGG + """
			,
			       count(*) FILTER (WHERE o.status = 'ALARM') alarms, count(*) FILTER (WHERE o.status = 'FAULT') faults,
			       count(*) FILTER (WHERE o.recovered IS NOT NULL) recovered, count(*) FILTER (WHERE o.recovered IS NULL) open,
			       round(avg(EXTRACT(EPOCH FROM (o.recovered - o.at)) / 60)) "mttrMin", max(o.at) "lastAt"
			  FROM onset o LEFT JOIN element e ON e.model_id = :id AND e.global_id = o.global_id
			 GROUP BY o.global_id, e.id ORDER BY count(*) DESC, max(o.at) DESC""")
			.param("id", id).param("d", Math.max(1, Math.min(days, 365))).query().listOfRows().stream()
			.map(r -> { r.put("systems", Sql.csv(r.get("systems"))); return r; }).toList();
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
