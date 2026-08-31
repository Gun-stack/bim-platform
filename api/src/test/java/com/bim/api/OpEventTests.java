package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** op_event 이력: 이벤트가 "그때 값"으로 쌓여 다음 변경에도 사라지지 않는다 — 이전 유도 방식의 유실 수정 (V6). */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class OpEventTests {
	@Autowired JdbcClient db;
	@Autowired StatusService status;
	@Autowired FmService fm;
	@Autowired MonitorController monitor;

	UUID modelId;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		modelId = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'G1', 'IfcSensor', '감지기')").param("m", modelId).update();
		db.sql("INSERT INTO asset (model_id, element_id, tag) SELECT :m, id, 'SD-01' FROM element WHERE model_id = :m").param("m", modelId).update();
	}

	private List<Map<String, Object>> events(String kind) {
		return monitor.events(modelId, 30).stream().filter(e -> kind.equals(e.get("kind"))).toList();
	}

	@Test
	void statusHistoryAccumulates() {
		status.patch(modelId, "G1", Map.of("Status", "ALARM"));
		status.patch(modelId, "G1", Map.of("Status", "NORMAL"));
		var evs = events("STATUS");
		assertThat(evs).hasSize(2);   // 유도 방식이면 1건(현재값)만 남는다
		assertThat(evs.getFirst()).containsEntry("status", "NORMAL").containsEntry("globalId", "G1").containsEntry("name", "감지기");
		assertThat(evs.getLast()).containsEntry("status", "ALARM");
	}

	@Test
	void workOrderLifecycleLogged() {
		var wo = status.patch(modelId, "G1", Map.of("Status", "ALARM")).get("workOrder");   // 자산이라 자동 생성
		UUID wid = (UUID) ((Map<?, ?>) wo).get("id");
		fm.patchWorkOrder(wid, new FmService.WorkOrderPatch("IN_PROGRESS", null, null, null, null, null));
		fm.patchWorkOrder(wid, new FmService.WorkOrderPatch(null, "김반장", null, null, null, null));   // 상태 아닌 패치는 이벤트 없음
		var evs = events("WORK_ORDER");
		assertThat(evs).hasSize(2);
		assertThat(evs.getFirst()).containsEntry("woStatus", "IN_PROGRESS");
		assertThat(evs.getLast()).containsEntry("woStatus", "OPEN");
	}

	@Test
	void readingsReturnAscendingSeries() {
		status.patch(modelId, "G1", Map.of("Temp", 40));
		status.patch(modelId, "G1", Map.of("Temp", 42));
		var rs = status.readings(modelId, "G1", 100);
		assertThat(rs).hasSize(2);
		assertThat(((Map<?, ?>) rs.getFirst().get("data")).get("Temp")).isEqualTo(40);   // 오름차순
		assertThat(((Map<?, ?>) rs.getLast().get("data")).get("Temp")).isEqualTo(42);
	}

	@Test
	void measurementPatchKeepsDataForTrends() {
		status.patch(modelId, "G1", Map.of("Temp", 42));
		var data = db.sql("SELECT data->>'Temp' FROM op_event WHERE model_id = :m AND kind = 'STATUS'").param("m", modelId).query(String.class).single();
		assertThat(data).isEqualTo("42");
	}
}
