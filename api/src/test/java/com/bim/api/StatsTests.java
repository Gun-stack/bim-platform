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

/** 경보 통계: op_event 에서 정상→이상 전이만 에피소드로 세고, 복구까지 걸린 시간을 평균낸다 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class StatsTests {
	@Autowired JdbcClient db;
	@Autowired MonitorController monitor;

	UUID mid;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'SD', 'IfcSensor', '감지기'), (:m, 'FP', 'IfcPump', '펌프')").param("m", mid).update();
		// 감지기: ALARM(계측 갱신으로 ALARM 2번 더 기록) → 30분 뒤 NORMAL → 다음날 ALARM 미복구. 펌프: FAULT → 60분 뒤 RUNNING. 40일 전 ALARM 은 기간 밖
		for (var e : List.of(new String[]{"SD", "ALARM", "2 days"}, new String[]{"SD", "ALARM", "2 days -10 minutes"}, new String[]{"SD", "ALARM", "2 days -20 minutes"}, new String[]{"SD", "NORMAL", "2 days -30 minutes"},
				new String[]{"SD", "ALARM", "1 day"}, new String[]{"FP", "FAULT", "3 days"}, new String[]{"FP", "RUNNING", "3 days -60 minutes"}, new String[]{"FP", "ALARM", "40 days"}, new String[]{"FP", "NORMAL", "39 days"}))
			db.sql("INSERT INTO op_event (model_id, at, kind, global_id, status) VALUES (:m, now() - :ago::interval, 'STATUS', :g, :s)")
				.param("m", mid).param("ago", e[2]).param("g", e[0]).param("s", e[1]).update();
	}

	@Test
	void episodesAndMttr() {
		Map<String, Map<String, Object>> by = new java.util.HashMap<>();
		for (var r : monitor.stats(mid, 30)) by.put((String) r.get("globalId"), r);
		Map<String, Object> sd = by.get("SD"), fp = by.get("FP");
		assertThat(((Number) sd.get("alarms")).intValue()).isEqualTo(2);        // 연속 ALARM 기록 3건은 에피소드 1건
		assertThat(((Number) sd.get("recovered")).intValue()).isEqualTo(1);
		assertThat(((Number) sd.get("open")).intValue()).isEqualTo(1);           // 어제 경보는 미복구
		assertThat(((Number) sd.get("mttrMin")).intValue()).isEqualTo(30);
		assertThat(((Number) fp.get("faults")).intValue()).isEqualTo(1);
		assertThat(((Number) fp.get("alarms")).intValue()).isEqualTo(0);         // 40일 전 경보는 기간 밖
		assertThat(((Number) fp.get("mttrMin")).intValue()).isEqualTo(60);
		assertThat(monitor.stats(mid, 60)).anySatisfy(r -> { if (r.get("globalId").equals("FP")) assertThat(((Number) r.get("alarms")).intValue()).isEqualTo(1); });
	}
}
