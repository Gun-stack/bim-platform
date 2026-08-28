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

	@GetMapping("/systems")
	List<Map<String, Object>> systems(@PathVariable UUID id) {
		return db.sql("""
			SELECT s.id, s.global_id "globalId", s.name, s.predefined_type "predefinedType",
			       count(es.element_id) "memberCount",
			       (SELECT count(*) FROM connection c JOIN element_system a ON a.element_id = c.from_element_id AND a.system_id = s.id) "connectionCount"
			  FROM system s LEFT JOIN element_system es ON es.system_id = s.id
			 WHERE s.model_id = :id GROUP BY s.id ORDER BY s.id""").param("id", id).query().listOfRows();
	}

	/** 계통 멤버 요소 (gid, class, name, 층/구역, 상류·하류 개수) */
	@GetMapping("/systems/{sid}/elements")
	List<Map<String, Object>> members(@PathVariable UUID id, @PathVariable long sid) {
		return db.sql("""
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name, e.spatial_node_id "spatialNodeId", sn.name "spatialName",
			       (SELECT count(*) FROM connection c WHERE c.to_element_id = e.id) "upstream",
			       (SELECT count(*) FROM connection c WHERE c.from_element_id = e.id) "downstream"
			  FROM element_system es JOIN element e ON e.id = es.element_id LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id
			 WHERE es.system_id = :sid AND e.model_id = :id ORDER BY e.ifc_class, e.name""")
			.param("id", id).param("sid", sid).query().listOfRows();
	}

	/** 요소에서 흐름을 거슬러(up: 원천까지) 또는 따라(down: 말단까지) 추적. depth 순, 순환 방지. */
	@GetMapping("/elements/{globalId}/route")
	Map<String, Object> route(@PathVariable UUID id, @PathVariable String globalId, @RequestParam(defaultValue = "up") String dir, @RequestParam(name = "scope", defaultValue = "system") String dirScope) {
		boolean up = !"down".equals(dir);
		// 출발 요소가 속한 계통 안의 요소만 따라간다 — 소화펌프의 전원선(비상전원)까지 딸려오지 않게. scope=all 이면 전부
		String scope = "all".equals(dirScope) ? "" : " JOIN element_system es ON es.element_id = e.id AND es.system_id IN (SELECT es0.system_id FROM element_system es0 JOIN element e0 ON e0.id = es0.element_id WHERE e0.model_id = :id AND e0.global_id = :gid)";
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
		if (rows.isEmpty()) throw new ProjectController.NotFound("element " + globalId);
		rows.sort((a, b) -> Integer.compare((int) a.get("depth"), (int) b.get("depth")));
		var systems = db.sql("""
			SELECT s.name FROM element_system es JOIN system s ON s.id = es.system_id JOIN element e ON e.id = es.element_id
			 WHERE e.model_id = :id AND e.global_id = :gid""").param("id", id).param("gid", globalId).query(String.class).list();
		return Map.of("globalId", globalId, "direction", up ? "up" : "down", "systems", systems, "nodes", rows);
	}
}
