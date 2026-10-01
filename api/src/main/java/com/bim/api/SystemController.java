package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/** 설비 계통(M6): 계통 목록·멤버, 흐름 경로 추적(상류/하류). 그래프 탐색은 PostgreSQL 재귀 CTE. */
@RestController
@RequestMapping("/api/models/{id}")
class SystemController {
	private final JdbcClient db;
	SystemController(JdbcClient db) { this.db = db; }

	/** 계통 목록 + 멤버 GlobalId(한 번에, B300·P104 — 탭을 열지 않아도 뷰어가 마운트 때 전체를 받는다) */
	@GetMapping("/systems")
	List<Map<String, Object>> systems(@PathVariable UUID id) {
		var rows = db.sql("""
			SELECT s.id, s.global_id "globalId", s.name, s.predefined_type "predefinedType",
			       count(es.element_id) "memberCount",
			       (SELECT count(*) FROM connection c JOIN element_system a ON a.element_id = c.from_element_id AND a.system_id = s.id) "connectionCount",
			       string_agg(e.global_id, ',' ORDER BY e.global_id) "members"
			  FROM system s LEFT JOIN element_system es ON es.system_id = s.id LEFT JOIN element e ON e.id = es.element_id
			 WHERE s.model_id = :id GROUP BY s.id ORDER BY s.id""").param("id", id).query().listOfRows();
		for (var r : rows) r.put("members", Sql.csv(r.get("members")));
		return rows;
	}

	/** 요소에서 흐름을 거슬러(up: 원천까지) 또는 따라(down: 말단까지) 추적. depth 순, 순환 방지. */
	@GetMapping("/elements/{globalId}/route")
	Map<String, Object> route(@PathVariable UUID id, @PathVariable String globalId, @RequestParam(defaultValue = "up") String dir, @RequestParam(name = "scope", defaultValue = "system") String dirScope) {
		boolean up = !"down".equals(dir);
		// 출발 요소가 속한 계통 안의 요소만 따라간다 — 소화펌프의 전원선(비상전원)까지 딸려오지 않게. scope=all 이면 전부
		String scope = "all".equals(dirScope) ? "" : " JOIN element_system es ON es.element_id = e.id AND es.system_id IN " + Sql.SYSTEM_SCOPE;
		String step = (up ? "JOIN connection c ON c.to_element_id = r.id JOIN element e ON e.id = c.from_element_id"
		                  : "JOIN connection c ON c.from_element_id = r.id JOIN element e ON e.id = c.to_element_id") + scope;
		var rows = db.sql("""
			WITH RECURSIVE r AS (
			  SELECT e.id, e.global_id, e.ifc_class, e.name, e.spatial_node_id, 0 AS depth, ARRAY[e.id] AS path, NULL::bigint AS via
			    FROM element e WHERE e.model_id = :id AND e.global_id = :gid
			  UNION ALL
			  SELECT e.id, e.global_id, e.ifc_class, e.name, e.spatial_node_id, r.depth + 1, r.path || e.id, r.id
			    FROM r %s
			   WHERE NOT e.id = ANY(r.path) AND r.depth < 50)
			SELECT DISTINCT ON (r.id) r.global_id "globalId", r.ifc_class "ifcClass", r.name, r.depth, sn.name "spatialName",
			       (SELECT global_id FROM element WHERE id = r.via) "via"
			  FROM r LEFT JOIN spatial_node sn ON sn.id = r.spatial_node_id
			 ORDER BY r.id, r.depth""".formatted(step))
			.param("id", id).param("gid", globalId).query().listOfRows();
		if (rows.isEmpty()) throw new ApiErrors.NotFound("element " + globalId);
		rows.sort((a, b) -> Integer.compare((int) a.get("depth"), (int) b.get("depth")));
		var systems = db.sql("""
			SELECT s.name FROM element_system es JOIN system s ON s.id = es.system_id JOIN element e ON e.id = es.element_id
			 WHERE e.model_id = :id AND e.global_id = :gid""").param("id", id).param("gid", globalId).query(String.class).list();
		return Map.of("globalId", globalId, "direction", up ? "up" : "down", "systems", systems, "nodes", rows);
	}
}
