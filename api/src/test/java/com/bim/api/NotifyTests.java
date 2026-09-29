package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 실시간 푸시: DB 트리거 pg_notify → Notifier(LISTEN) → 그 모델 구독자에게만. 정전 전환도 op_event 로 남아 알림이 간다 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class NotifyTests {
	@Autowired JdbcClient db;
	@Autowired Notifier notifier;
	@Autowired StatusService status;
	@Autowired StreamController stream;

	UUID mid, other;
	final BlockingQueue<String[]> got = new LinkedBlockingQueue<>();
	Runnable off;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		other = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'o', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'ATS', 'IfcSwitchingDevice', 'ATS'), (:m, 'EG-1', 'IfcElectricGenerator', 'EG-1')").param("m", mid).update();
		off = notifier.subscribe(mid, (k, d) -> got.add(new String[] { k, d }));
	}

	@AfterEach
	void unsubscribe() { off.run(); }

	/** kind 가 올 때까지 다른 종류(hb 등)는 건너뛴다. 5초 안에 안 오면 실패 */
	@SuppressWarnings("unchecked")
	Map<String, Object> next(String kind) throws InterruptedException {
		for (;;) {
			var e = got.poll(5, TimeUnit.SECONDS);
			assertThat(e).as("'%s' 이벤트", kind).isNotNull();
			if (e[0].equals(kind)) return (Map<String, Object>) Json.parse(e[1]);
		}
	}

	@Test
	void opEventGoesOnlyToThatModelsSubscribers() throws InterruptedException {
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status) VALUES (:m, 'STATUS', 'X', 'ALARM')").param("m", other).update();
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status) VALUES (:m, 'STATUS', 'SD', 'ALARM')").param("m", mid).update();
		var e = next("status");
		assertThat(e.get("g")).isEqualTo("SD");   // 다른 모델의 X 는 오지 않았다
		assertThat(e.get("s")).isEqualTo("ALARM");
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status, wo_title) VALUES (:m, 'WORK_ORDER', 'SD', 'OPEN', 't')").param("m", mid).update();
		assertThat(next("work_order").get("s")).isEqualTo("OPEN");
	}

	@Test
	void conversionProgressNotifies() throws InterruptedException {
		long job = db.sql("INSERT INTO conversion_job (model_id) VALUES (:m) RETURNING id").param("m", mid).query(Long.class).single();
		db.sql("UPDATE conversion_job SET progress = 40 WHERE id = :j").param("j", job).update();
		assertThat(((Number) next("job").get("p")).intValue()).isEqualTo(40);
	}

	@Test
	void powerSwitchIsRecordedAndNotified() throws InterruptedException {
		status.power(mid, "GENERATOR");
		assertThat(next("status").get("g")).isIn("ATS", "EG-1");
		assertThat(db.sql("SELECT count(*) FROM op_event WHERE model_id = :m AND global_id = 'ATS' AND status = 'TRANSFERRED'").param("m", mid).query(Long.class).single()).isEqualTo(1);
	}

	@Test
	void malformedPayloadDoesNotKillListener() throws InterruptedException {
		db.sql("NOTIFY bim, 'not json'").update();          // 파싱 실패
		db.sql("NOTIFY bim, '{\"k\":\"status\"}'").update();  // m 없음 → UUID.fromString(null)
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status) VALUES (:m, 'STATUS', 'SD', 'ALARM')").param("m", mid).update();
		assertThat(next("status").get("g")).isEqualTo("SD");   // 리스너가 살아 있다
	}

	@Test
	void unknownModelStreamIs404() {
		assertThatThrownBy(() -> stream.stream(UUID.randomUUID())).isInstanceOf(ApiErrors.NotFound.class);
	}
}
