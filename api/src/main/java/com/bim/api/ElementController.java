package com.bim.api;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/** 공간 트리·요소 검색·요소 상세. 뷰어(M2)가 쓴다. */
@RestController
@RequestMapping("/api/models/{id}")
class ElementController {
	private final JdbcClient db;
	ElementController(JdbcClient db) { this.db = db; }

	/** 평면 목록(부모가 항상 먼저). 트리는 프론트에서 조립. */
	@GetMapping("/spatial")
	List<Map<String, Object>> spatial(@PathVariable UUID id) {
		return db.sql("""
			SELECT id, parent_id "parentId", global_id "globalId", ifc_class "ifcClass", name, elevation
			  FROM spatial_node WHERE model_id = :id ORDER BY id""").param("id", id).query().listOfRows();
	}

	/** 속성 제외한 가벼운 목록(전체) — 뷰어 트리용. 2만 요소 2.5MB/124ms 라 아직 페이징 안 함 */
	@GetMapping("/elements")
	List<Map<String, Object>> elements(@PathVariable UUID id) {
		return db.sql("""
			SELECT global_id "globalId", ifc_class "ifcClass", name, spatial_node_id "spatialNodeId"
			  FROM element WHERE model_id = :id ORDER BY ifc_class, name""")
			.param("id", id).query().listOfRows();
	}

	/** 색상 모드용: 모델에 등장하는 "Pset.속성" 키와 요소 수. 상위 200개 */
	@GetMapping("/property-keys")
	List<Map<String, Object>> propertyKeys(@PathVariable UUID id) {
		return db.sql("""
			SELECT p.key || '.' || q.key AS key, count(*) AS n
			  FROM element e, jsonb_each(e.properties) p, jsonb_each(p.value) q
			 WHERE e.model_id = :id AND jsonb_typeof(p.value) = 'object'
			 GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 200""").param("id", id).query().listOfRows();
	}

	/** 색상 모드용: key("Pset.속성") 의 값을 가진 요소 → {globalId, value(text)} */
	@GetMapping("/property-values")
	List<Map<String, Object>> propertyValues(@PathVariable UUID id, @RequestParam String key) {
		int dot = key.indexOf('.');
		if (dot < 1) throw new ApiErrors.BadRequest("key must be Pset.Property");
		return db.sql("""
			SELECT global_id "globalId", properties #>> ARRAY[:pset, :prop] AS value
			  FROM element WHERE model_id = :id AND properties #> ARRAY[:pset, :prop] IS NOT NULL""")
			.param("id", id).param("pset", key.substring(0, dot)).param("prop", key.substring(dot + 1)).query().listOfRows();
	}

	@GetMapping("/elements/{globalId}")
	Map<String, Object> element(@PathVariable UUID id, @PathVariable String globalId) {
		return db.sql("""
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name, e.properties::text properties,
			       s.id "spatialNodeId", s.ifc_class "spatialClass", s.name "spatialName",
			""" + Sql.SYSTEMS_AGG + """

			  FROM element e LEFT JOIN spatial_node s ON s.id = e.spatial_node_id
			 WHERE e.model_id = :id AND e.global_id = :gid""")
			.param("id", id).param("gid", globalId).query().listOfRows().stream().findFirst()
			.map(m -> { m.put("properties", Json.parse((String) m.get("properties"))); m.put("systems", Sql.csv(m.get("systems"))); return m; })
			.orElseThrow(() -> new ApiErrors.NotFound("element " + globalId));
	}
}
