package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 홈 카드 운영 칩 — 모델 목록의 경보·장애·열린 작업지시 수가 웹 isAbnormal(ALARM·FAULT)·칸반(DONE 제외)과 같은 기준인지 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ModelSummaryTests {
	@Autowired JdbcClient db;
	@Autowired ModelController models;

	@Test
	void listCountsAlarmsFaultsAndOpenWorkOrders() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		UUID mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		long pump = 0;
		for (var e : new String[][] { { "A1", "ALARM" }, { "A2", "ALARM" }, { "F1", "FAULT" }, { "S1", "STANDBY" }, { "N1", null } }) {
			long id = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name, properties) VALUES (:m, :g, 'IfcSensor', :g, CAST(:p AS jsonb)) RETURNING id")
				.param("m", mid).param("g", e[0]).param("p", e[1] == null ? "{}" : "{\"Pset_BimStatus\": {\"Status\": \"" + e[1] + "\"}}").query(Long.class).single();
			if (e[0].equals("F1")) pump = id;
		}
		UUID aid = db.sql("INSERT INTO asset (model_id, element_id, tag) VALUES (:m, :e, 'T-1') RETURNING id").param("m", mid).param("e", pump).query(UUID.class).single();
		for (var st : new String[] { "OPEN", "IN_PROGRESS", "DONE" })
			db.sql("INSERT INTO work_order (asset_id, title, status) VALUES (:a, 't', :s)").param("a", aid).param("s", st).update();

		Map<String, Object> m = models.list(pid).getFirst();
		assertThat(((Number) m.get("alarms")).intValue()).isEqualTo(2);
		assertThat(((Number) m.get("faults")).intValue()).isEqualTo(1);   // STANDBY·상태 없음은 제외
		assertThat(((Number) m.get("openWorkOrders")).intValue()).isEqualTo(2);   // DONE 제외
		assertThat(models.get(mid).get("alarms")).isEqualTo(m.get("alarms"));   // 단건도 같은 SELECT
	}
}
