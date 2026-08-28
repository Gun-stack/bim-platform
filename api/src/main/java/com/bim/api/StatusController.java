package com.bim.api;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** 런타임 상태(M6): Pset_BimStatus 를 jsonb 병합으로 갱신. IFC 는 설계 정보라 상태 자리가 없고, 운영에선 BMS/수신기 값이 여기로 들어온다.
 *  재변환 시 IFC 값으로 초기화됨 (의도: 상태는 IFC 가 아니라 운영 시스템의 것). */
@RestController
@RequestMapping("/api/models/{id}")
class StatusController {
	private final JdbcClient db;
	private final TransactionTemplate tx;
	private static final ObjectMapper JSON = new ObjectMapper();
	StatusController(JdbcClient db, TransactionTemplate tx) { this.db = db; this.tx = tx; }

	/** 상태 병합. Status 가 ALARM/FAULT 로 바뀌고 요소가 자산이면 작업지시 자동 생성, 수신기 ActiveAlarms/Faults 재계산 */
	@PatchMapping("/elements/{globalId}/status")
	Map<String, Object> patch(@PathVariable UUID id, @PathVariable String globalId, @RequestBody Map<String, Object> patch) {
		var p = new java.util.HashMap<>(patch); p.put("UpdatedAt", OffsetDateTime.now().toString());
		return tx.execute(st -> {
			int n = db.sql("""
				UPDATE element SET properties = jsonb_set(properties, '{Pset_BimStatus}', coalesce(properties->'Pset_BimStatus', '{}'::jsonb) || :p::jsonb)
				 WHERE model_id = :id AND global_id = :gid""").param("id", id).param("gid", globalId).param("p", JSON.writeValueAsString(p)).update();
			if (n == 0) throw new ProjectController.NotFound("element " + globalId);
			// 수신기 집계: 모델 안의 ALARM/FAULT 감지기 수
			db.sql("""
				UPDATE element SET properties = jsonb_set(properties, '{Pset_BimStatus}', (properties->'Pset_BimStatus') || jsonb_build_object(
				  'ActiveAlarms', (SELECT count(*) FROM element s WHERE s.model_id = :id AND s.ifc_class = 'IfcSensor' AND s.properties->'Pset_BimStatus'->>'Status' = 'ALARM'),
				  'Faults',       (SELECT count(*) FROM element s WHERE s.model_id = :id AND s.ifc_class = 'IfcSensor' AND s.properties->'Pset_BimStatus'->>'Status' = 'FAULT')))
				 WHERE model_id = :id AND ifc_class = 'IfcUnitaryControlElement' AND name LIKE 'FACP%'""").param("id", id).update();
			String status = String.valueOf(patch.get("Status"));
			Map<String, Object> wo = null;
			if (status.equals("ALARM") || status.equals("FAULT")) {   // 자산이면 작업지시
				var asset = db.sql("SELECT a.id, a.tag FROM asset a JOIN element e ON e.id = a.element_id WHERE e.model_id = :id AND e.global_id = :gid")
					.param("id", id).param("gid", globalId).query().listOfRows().stream().findFirst().orElse(null);
				if (asset != null) {
					// 중복 억제: 같은 자산에 열린 작업지시(OPEN/IN_PROGRESS)가 있으면 새로 만들지 않고 재사용. DONE 뒤 재발이면 새로 생성.
					var open = db.sql("SELECT id FROM work_order WHERE asset_id = :a AND status <> 'DONE' ORDER BY created_at DESC LIMIT 1")
						.param("a", asset.get("id")).query(UUID.class).optional();
					if (open.isPresent()) {
						wo = Map.of("id", open.get(), "assetTag", asset.get("tag"), "existing", true);
					} else {
						var name = db.sql("SELECT name FROM element WHERE model_id = :id AND global_id = :gid").param("id", id).param("gid", globalId).query(String.class).single();
						UUID wid = db.sql("""
							INSERT INTO work_order (asset_id, title, viewpoint) VALUES (:a, :t, :v::jsonb) RETURNING id""")
							.param("a", asset.get("id")).param("t", (status.equals("ALARM") ? "경보 확인: " : "장애 점검: ") + name)
							.param("v", JSON.writeValueAsString(Map.of("sel", List.of(globalId)))).query(UUID.class).single();
						wo = Map.of("id", wid, "assetTag", asset.get("tag"), "existing", false);
					}
				}
			}
			var el = db.sql("SELECT global_id \"globalId\", name, properties->'Pset_BimStatus' AS s FROM element WHERE model_id = :id AND global_id = :gid")
				.param("id", id).param("gid", globalId).query().listOfRows().getFirst();
			var out = new java.util.HashMap<String, Object>(Map.of("globalId", el.get("globalId"), "name", el.get("name"), "status", Json.parse(el.get("s").toString())));
			if (wo != null) out.put("workOrder", wo);
			return out;
		});
	}

	/** 상태 있는 요소 목록 (상태판) */
	@GetMapping("/status")
	List<Map<String, Object>> list(@PathVariable UUID id) {
		return db.sql("""
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name, sn.name "spatialName", (e.properties->'Pset_BimStatus')::text s
			  FROM element e LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id
			 WHERE e.model_id = :id AND jsonb_exists(e.properties, 'Pset_BimStatus')   -- '?' 연산자는 JDBC 플레이스홀더와 충돌
			 ORDER BY CASE e.properties->'Pset_BimStatus'->>'Status' WHEN 'ALARM' THEN 0 WHEN 'FAULT' THEN 1 ELSE 2 END, e.name""")
			.param("id", id).query().listOfRows().stream().map(r -> { r.put("status", Json.parse((String) r.remove("s"))); return r; }).toList();
	}

	/** 정전 시나리오: source=UTILITY(한전) | GENERATOR(발전기). ATS·발전기 상태를 바꾸고, 전원 있는/없는 요소를 흐름 그래프로 계산.
	 *  한전: MDB 하류 전부 + EMDB 하류. 발전기: EMDB 하류만 (MDB 하류 중 비상 아닌 것은 무전원). */
	@PostMapping("/power")
	Map<String, Object> power(@PathVariable UUID id, @RequestParam String source) {
		boolean gen = source.equals("GENERATOR");
		if (!gen && !source.equals("UTILITY")) throw new ProjectController.BadRequest("source=UTILITY|GENERATOR");
		set(id, "IfcSwitchingDevice", Map.of("Status", gen ? "TRANSFERRED" : "NORMAL", "Source", source));
		set(id, "IfcElectricGenerator", Map.of("Status", gen ? "RUNNING" : "STANDBY"));
		List<String> normal = downstream(id, "MDB%"), emergency = downstream(id, "EMDB%");
		List<String> powered = gen ? emergency : java.util.stream.Stream.concat(normal.stream(), emergency.stream()).distinct().toList();
		List<String> unpowered = gen ? normal.stream().filter(g -> !emergency.contains(g)).toList() : List.of();
		return Map.of("source", source, "powered", powered, "unpowered", unpowered);
	}

	/** 현재 전원 상태 조회 (변경 없음): 모니터 페이지가 무전원 요소를 회색 처리하는 데 쓴다 */
	@GetMapping("/power")
	Map<String, Object> powerNow(@PathVariable UUID id) {
		String source = db.sql("SELECT properties->'Pset_BimStatus'->>'Source' FROM element WHERE model_id = :id AND ifc_class = 'IfcSwitchingDevice' LIMIT 1").param("id", id).query(String.class).optional().orElse("UTILITY");
		boolean gen = "GENERATOR".equals(source);
		List<String> normal = downstream(id, "MDB%"), emergency = downstream(id, "EMDB%");
		return Map.of("source", source, "powered", gen ? emergency : java.util.stream.Stream.concat(normal.stream(), emergency.stream()).distinct().toList(),
		              "unpowered", gen ? normal.stream().filter(g -> !emergency.contains(g)).toList() : List.of());
	}

	private void set(UUID id, String cls, Map<String, Object> patch) {
		db.sql("UPDATE element SET properties = jsonb_set(properties, '{Pset_BimStatus}', coalesce(properties->'Pset_BimStatus', '{}'::jsonb) || :p::jsonb) WHERE model_id = :id AND ifc_class = :c")
			.param("id", id).param("c", cls).param("p", JSON.writeValueAsString(patch)).update();
	}

	private List<String> downstream(UUID id, String namePattern) {
		return db.sql("""
			WITH RECURSIVE r AS (
			  SELECT e.id, ARRAY[e.id] path FROM element e WHERE e.model_id = :id AND e.name LIKE :n
			  UNION ALL
			  SELECT e.id, r.path || e.id FROM r JOIN connection c ON c.from_element_id = r.id JOIN element e ON e.id = c.to_element_id WHERE NOT e.id = ANY(r.path))
			SELECT DISTINCT e.global_id FROM r JOIN element e ON e.id = r.id""").param("id", id).param("n", namePattern).query(String.class).list();
	}
}
