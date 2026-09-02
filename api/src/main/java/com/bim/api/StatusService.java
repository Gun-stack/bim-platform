package com.bim.api;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Stream;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** 런타임 상태(M6): Pset_BimStatus 를 jsonb 병합으로 갱신. IFC 는 설계 정보라 상태 자리가 없고, 운영에선 BMS/수신기 값이 여기로 들어온다.
 *  재변환 시 IFC 값으로 초기화됨 (의도: 상태는 IFC 가 아니라 운영 시스템의 것). */
@Service
class StatusService {
	private final JdbcClient db;
	private final TransactionTemplate tx;
	StatusService(JdbcClient db, TransactionTemplate tx) { this.db = db; this.tx = tx; }

	/** 상태 병합 → 이력 → 파생값 재계산 → Status 가 ALARM/FAULT 로 바뀌고 요소가 자산이면 작업지시(억제·재사용·재오픈 규칙) */
	Map<String, Object> patch(UUID id, String globalId, Map<String, Object> patch) {
		var p = new HashMap<>(patch); p.put("UpdatedAt", OffsetDateTime.now().toString());
		return tx.execute(st -> {
			int n = db.sql("""
				UPDATE element SET properties = jsonb_set(properties, '{Pset_BimStatus}', coalesce(properties->'Pset_BimStatus', '{}'::jsonb) || :p::jsonb)
				 WHERE model_id = :id AND global_id = :gid""").param("id", id).param("gid", globalId).param("p", Json.write(p)).update();
			if (n == 0) throw new ApiErrors.NotFound("element " + globalId);
			OpEvents.status(db, id, globalId, Json.write(p));
			demoAggregates(id);
			String status = String.valueOf(patch.get("Status"));
			Map<String, Object> wo = status.equals("ALARM") || status.equals("FAULT") ? workOrderFor(id, globalId, status) : null;
			var el = db.sql("SELECT global_id \"globalId\", name, properties->'Pset_BimStatus' AS s FROM element WHERE model_id = :id AND global_id = :gid")
				.param("id", id).param("gid", globalId).query().listOfRows().getFirst();
			var out = new HashMap<String, Object>(Map.of("globalId", el.get("globalId"), "name", el.get("name"), "status", Json.parse(el.get("s").toString())));
			if (wo != null) out.put("workOrder", wo);
			return out;
		});
	}

	/** 가상 건물(gen_mep.py) 전용 파생값 — 이름 접두어(FACP/PCS/DISP)로 찾으므로 실무 IFC 에선 아무 행도 안 건드린다.
	 *  수신기: 모델 안의 ALARM/FAULT 감지기 수. 주차관제: 주차면 센서(Occupied) → PCS Capacity/Occupied, 표시판 Text */
	private void demoAggregates(UUID id) {
		db.sql("""
			UPDATE element SET properties = jsonb_set(properties, '{Pset_BimStatus}', (properties->'Pset_BimStatus') || jsonb_build_object(
			  'ActiveAlarms', (SELECT count(*) FROM element s WHERE s.model_id = :id AND s.ifc_class = 'IfcSensor' AND s.properties->'Pset_BimStatus'->>'Status' = 'ALARM'),
			  'Faults',       (SELECT count(*) FROM element s WHERE s.model_id = :id AND s.ifc_class = 'IfcSensor' AND s.properties->'Pset_BimStatus'->>'Status' = 'FAULT')))
			 WHERE model_id = :id AND ifc_class = 'IfcUnitaryControlElement' AND name LIKE 'FACP%'""").param("id", id).update();
		db.sql("""
			WITH p AS (SELECT count(*) cap, count(*) FILTER (WHERE (properties->'Pset_BimStatus'->>'Occupied')::boolean) occ
			             FROM element WHERE model_id = :id AND ifc_class = 'IfcSensor' AND jsonb_typeof(properties->'Pset_BimStatus'->'Occupied') = 'boolean')
			UPDATE element e SET properties = jsonb_set(e.properties, '{Pset_BimStatus}', (e.properties->'Pset_BimStatus') ||
			  CASE WHEN e.name LIKE 'PCS%' THEN jsonb_build_object('Capacity', p.cap, 'Occupied', p.occ)
			       ELSE jsonb_build_object('Text', CASE WHEN p.cap - p.occ > 0 THEN '여유 ' || (p.cap - p.occ) ELSE '만차' END) END)
			  FROM p WHERE e.model_id = :id AND p.cap > 0 AND (e.name LIKE 'PCS%' OR e.name LIKE 'DISP%')""").param("id", id).update();
	}

	/** 이상 상태 요소의 작업지시. 상위 장비 억제 → 열린 것 재사용 → 10분 내 DONE 재오픈(플래핑) → 신규. 자산이 아니면 null */
	private Map<String, Object> workOrderFor(UUID id, String globalId, String status) {
		var asset = db.sql("SELECT a.id, a.tag FROM asset a JOIN element e ON e.id = a.element_id WHERE e.model_id = :id AND e.global_id = :gid")
			.param("id", id).param("gid", globalId).query().listOfRows().stream().findFirst().orElse(null);
		// 상위 장비 억제: 같은 계통 상류에 이미 이상 상태인 장비가 있으면 원인은 그쪽 — 하위 요소는 작업지시를 만들지 않는다
		var cause = db.sql("""
			WITH RECURSIVE r AS (
			  SELECT e.id, 0 depth, ARRAY[e.id] path FROM element e WHERE e.model_id = :id AND e.global_id = :gid
			  UNION ALL
			  SELECT e.id, r.depth + 1, r.path || e.id FROM r JOIN connection c ON c.to_element_id = r.id JOIN element e ON e.id = c.from_element_id
			    JOIN element_system es ON es.element_id = e.id AND es.system_id IN """ + Sql.SYSTEM_SCOPE + """

			   WHERE NOT e.id = ANY(r.path) AND r.depth < 10)
			SELECT e.global_id, e.name FROM r JOIN element e ON e.id = r.id
			 WHERE r.depth > 0 AND e.properties->'Pset_BimStatus'->>'Status' IN ('ALARM', 'FAULT', 'OFFLINE', 'TRIPPED')
			 ORDER BY r.depth LIMIT 1""").param("id", id).param("gid", globalId).query().listOfRows().stream().findFirst().orElse(null);
		if (cause != null) return Map.of("suppressedBy", Map.of("globalId", cause.get("global_id"), "name", cause.get("name")));
		if (asset == null) return null;
		String prefix = status.equals("ALARM") ? "경보 확인: " : "장애 점검: ";
		var open = db.sql("SELECT id FROM work_order WHERE asset_id = :a AND status <> 'DONE' ORDER BY created_at DESC LIMIT 1")
			.param("a", asset.get("id")).query(UUID.class).optional();
		if (open.isPresent()) return Map.of("id", open.get(), "assetTag", asset.get("tag"), "existing", true);
		var recent = db.sql("""
			SELECT id FROM work_order WHERE asset_id = :a AND status = 'DONE' AND title LIKE :t AND updated_at > now() - interval '10 minutes'
			 ORDER BY updated_at DESC LIMIT 1""").param("a", asset.get("id")).param("t", prefix + "%").query(UUID.class).optional();
		if (recent.isPresent()) {
			db.sql("UPDATE work_order SET status = 'OPEN', updated_at = now() WHERE id = :w").param("w", recent.get()).update();
			OpEvents.workOrder(db, recent.get());
			return Map.of("id", recent.get(), "assetTag", asset.get("tag"), "existing", true, "reopened", true);
		}
		var name = db.sql("SELECT name FROM element WHERE model_id = :id AND global_id = :gid").param("id", id).param("gid", globalId).query(String.class).single();
		UUID wid = db.sql("INSERT INTO work_order (asset_id, title, viewpoint, priority, description) VALUES (:a, :t, :v::jsonb, :p, :d) RETURNING id")
			.param("a", asset.get("id")).param("t", prefix + name).param("p", status.equals("ALARM") ? "URGENT" : "HIGH").param("d", "상태 API 자동 생성 (" + status + ")")
			.param("v", Json.write(Map.of("sel", List.of(globalId)))).query(UUID.class).single();
		OpEvents.workOrder(db, wid);
		return Map.of("id", wid, "assetTag", asset.get("tag"), "existing", false);
	}

	/** 이미 ALARM/FAULT 인데 열린 작업지시가 없는 자산 요소에 작업지시를 만든다 — 규칙(억제·재사용·시간창)은 patch 와 같다.
	 *  IFC 초기값·외부 갱신은 상태 API 를 안 거쳐 작업지시가 없는 채로 남기 때문. 자산 일괄 등록 뒤와 보드에서 호출 */
	Map<String, Object> sync(UUID id) {
		var rows = db.sql("""
			SELECT e.global_id gid, e.properties->'Pset_BimStatus'->>'Status' st FROM element e JOIN asset a ON a.element_id = e.id
			 WHERE e.model_id = :id AND e.properties->'Pset_BimStatus'->>'Status' IN ('ALARM', 'FAULT')
			   AND NOT EXISTS (SELECT 1 FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE')""").param("id", id).query().listOfRows();
		int created = 0, suppressed = 0;
		for (var r : rows) {
			var wo = patch(id, (String) r.get("gid"), Map.of("Status", r.get("st"))).get("workOrder");
			if (wo instanceof Map<?, ?> m) { if (m.containsKey("suppressedBy")) suppressed++; else created++; }
		}
		return Map.of("checked", rows.size(), "created", created, "suppressed", suppressed);
	}

	/** 상태 있는 요소 목록 (상태판) */
	List<Map<String, Object>> list(UUID id) {
		return db.sql("""
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name, sn.name "spatialName", (e.properties->'Pset_BimStatus')::text s
			  FROM element e LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id
			 WHERE e.model_id = :id AND jsonb_exists(e.properties, 'Pset_BimStatus')   -- '?' 연산자는 JDBC 플레이스홀더와 충돌
			 ORDER BY CASE e.properties->'Pset_BimStatus'->>'Status' WHEN 'ALARM' THEN 0 WHEN 'FAULT' THEN 1 ELSE 2 END, e.name""")
			.param("id", id).query().listOfRows().stream().map(r -> { r.put("status", Json.parse((String) r.remove("s"))); return r; }).toList();
	}

	/** 계측 이력 (op_event.data — 상태 패치 내용): 최신 limit 건을 시간 오름차순으로. 트렌드 차트용 */
	List<Map<String, Object>> readings(UUID id, String globalId, int limit) {
		var rows = new ArrayList<>(db.sql("""
			SELECT at, data::text d FROM op_event
			 WHERE model_id = :id AND global_id = :gid AND kind = 'STATUS' AND data IS NOT NULL
			 ORDER BY at DESC, id DESC LIMIT :n""").param("id", id).param("gid", globalId).param("n", Math.min(limit, 2000)).query().listOfRows());
		Collections.reverse(rows);
		return rows.stream().map(r -> { r.put("data", Json.parse((String) r.remove("d"))); return r; }).toList();
	}

	/** 정전 시나리오: source=UTILITY(한전) | GENERATOR(발전기). ATS·발전기 상태를 바꾸고 전원 있는/없는 요소를 계산 */
	Map<String, Object> power(UUID id, String source) {
		boolean gen = source.equals("GENERATOR");
		if (!gen && !source.equals("UTILITY")) throw new ApiErrors.BadRequest("source=UTILITY|GENERATOR");
		set(id, "IfcSwitchingDevice", Map.of("Status", gen ? "TRANSFERRED" : "NORMAL", "Source", source));
		set(id, "IfcElectricGenerator", Map.of("Status", gen ? "RUNNING" : "STANDBY"));
		return powered(id, source);
	}

	/** 현재 전원 상태 조회 (변경 없음). ATS 가 없는 모델은 한전 수전으로 본다 */
	Map<String, Object> powerNow(UUID id) { return powered(id, powerSource(id).orElse("UTILITY")); }

	/** ATS(IfcSwitchingDevice)에 기록된 현재 전원 원천. ATS 가 없으면 empty */
	Optional<String> powerSource(UUID id) {
		return db.sql("SELECT properties->'Pset_BimStatus'->>'Source' FROM element WHERE model_id = :id AND ifc_class = 'IfcSwitchingDevice' LIMIT 1").param("id", id).query(String.class).optional();
	}

	/** 한전: MDB 하류 전부 + 비상 계통. 발전기: 비상 계통만 (MDB 하류 중 비상 아닌 것은 무전원).
	 *  비상 계통의 뿌리는 EMDB 가 아니라 발전기(EG-%)와 그 직접 공급원(연료탱크) — 탱크→발전기→ATS→EMDB→하류. EMDB 를 뿌리로 잡으면 발전기·ATS 가 상류라 빠져 무전원/비활성으로 보인다. */
	private Map<String, Object> powered(UUID id, String source) {
		boolean gen = "GENERATOR".equals(source);
		List<String> normal = downstream(id, "MDB%"), emergency = downstream(id, "EG-%");
		List<String> powered = gen ? emergency : Stream.concat(normal.stream(), emergency.stream()).distinct().toList();
		List<String> unpowered = gen ? normal.stream().filter(g -> !emergency.contains(g)).toList() : List.of();
		return Map.of("source", source, "powered", powered, "unpowered", unpowered);
	}

	private void set(UUID id, String cls, Map<String, Object> patch) {
		db.sql("UPDATE element SET properties = jsonb_set(properties, '{Pset_BimStatus}', coalesce(properties->'Pset_BimStatus', '{}'::jsonb) || :p::jsonb) WHERE model_id = :id AND ifc_class = :c")
			.param("id", id).param("c", cls).param("p", Json.write(patch)).update();
	}

	private List<String> downstream(UUID id, String namePattern) {
		return db.sql("""
			WITH RECURSIVE elec AS (
			  SELECT es.element_id FROM element_system es JOIN system s ON s.id = es.system_id WHERE s.model_id = :id AND s.predefined_type = 'ELECTRICAL'
			), r AS (
			  SELECT e.id, ARRAY[e.id] path, true trav, e.ifc_class FROM element e WHERE e.model_id = :id
			     AND (e.name LIKE :n OR e.id IN (SELECT c.from_element_id FROM connection c JOIN element t ON t.id = c.to_element_id WHERE t.model_id = :id AND t.name LIKE :n))  -- 뿌리 + 뿌리에 직접 공급하는 요소(발전기 연료탱크)
			  UNION ALL
			  -- connection 엔 계통이 없어 통신·공조 링크까지 타고 간다(UPS→MDF→IDF→DDC→VAV→디퓨저) → 전기 계통(ELECTRICAL) 멤버만 통과.
			  -- 예외: 분전반·개폐기 직결 요소는 계통 무관하게 부하로 도달(trav=false, 더 타진 않음) — 엘리베이터처럼 IfcDistributionSystem 에 못 들어가는 부하용
			  SELECT e.id, r.path || e.id, e.id IN (SELECT element_id FROM elec), e.ifc_class
			    FROM r JOIN connection c ON c.from_element_id = r.id JOIN element e ON e.id = c.to_element_id
			   WHERE NOT e.id = ANY(r.path) AND r.trav
			     AND (e.id IN (SELECT element_id FROM elec) OR r.ifc_class IN ('IfcElectricDistributionBoard', 'IfcSwitchingDevice'))
			)
			SELECT DISTINCT e.global_id FROM r JOIN element e ON e.id = r.id""").param("id", id).param("n", namePattern).query(String.class).list();
	}
}
