package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 24시간 발생 막대: 시간당 정상→이상 전이 수. 경보 통계(stats)와 같은 LAG 규칙 — 연속 이상 기록은 한 번만 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class TimelineTests {
	@Autowired JdbcClient db;
	@Autowired MonitorController monitor;

	@Test
	void hourlyOnsetsFixedBuckets() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		UUID mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		// SD: 3시간 전 경보(+같은 시간 반복 기록) → 2시간 전 정상 → 1시간 전 다시 경보. FP: 1시간 전 장애. OLD: 30시간 전 경보(기간 밖)
		for (var e : List.of(new String[]{"SD", "ALARM", "3 hours"}, new String[]{"SD", "ALARM", "3 hours -5 minutes"}, new String[]{"SD", "NORMAL", "2 hours"},
				new String[]{"SD", "ALARM", "1 hour"}, new String[]{"FP", "FAULT", "1 hour"}, new String[]{"OLD", "ALARM", "30 hours"}))
			db.sql("INSERT INTO op_event (model_id, at, kind, global_id, status) VALUES (:m, date_trunc('hour', now()) - :ago::interval + interval '1 minute', 'STATUS', :g, :s)")
				.param("m", mid).param("ago", e[2]).param("g", e[0]).param("s", e[1]).update();

		List<Map<String, Object>> t = monitor.timeline(mid, 24);
		assertThat(t).hasSize(24);   // 빈 시간도 0 으로 — 막대 수 고정
		int alarms = t.stream().mapToInt(r -> ((Number) r.get("alarms")).intValue()).sum(), faults = t.stream().mapToInt(r -> ((Number) r.get("faults")).intValue()).sum();
		assertThat(alarms).isEqualTo(2);   // 3시간 전 반복 기록은 1건, 30시간 전은 기간 밖
		assertThat(faults).isEqualTo(1);
		var lastHourAgo = t.get(t.size() - 2);   // 마지막 칸 = 현재 시각대, 그 앞 = 1시간 전
		assertThat(((Number) lastHourAgo.get("alarms")).intValue()).isEqualTo(1);
		assertThat(((Number) lastHourAgo.get("faults")).intValue()).isEqualTo(1);
	}
}
