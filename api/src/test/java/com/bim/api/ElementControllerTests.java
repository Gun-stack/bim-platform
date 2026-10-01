package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 요소 상세의 connected 플래그(규칙 6) — 계통(IfcSystem)은 없어도 포트 연결만 있는 실무 IFC 에서
 *  요약 카드가 "전체 연결에서 추적" 버튼을 보일지 말지 판단하는 데이터 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ElementControllerTests {
	@Autowired JdbcClient db;
	@Autowired ElementController elements;

	UUID mid;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		long from = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'FROM', 'IfcPump', 'FROM') RETURNING id").param("m", mid).query(Long.class).single();
		long to = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'TO', 'IfcPipeSegment', 'TO') RETURNING id").param("m", mid).query(Long.class).single();
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'LONE', 'IfcPump', 'LONE')").param("m", mid).update();
		db.sql("INSERT INTO connection (model_id, from_element_id, to_element_id) VALUES (:m, :f, :t)").param("m", mid).param("f", from).param("t", to).update();
	}

	@Test
	void connectedTrueOnBothEndsOfAConnectionEvenWithoutAnySystem() {
		assertThat(elements.element(mid, "FROM").get("connected")).isEqualTo(true);
		assertThat(elements.element(mid, "TO").get("connected")).isEqualTo(true);
		assertThat(elements.element(mid, "FROM").get("systems")).isEqualTo(java.util.List.of());   // 계통 없음 — 그래도 connected
	}

	@Test
	void connectedFalseWithNoConnectionAtAll() {
		assertThat(elements.element(mid, "LONE").get("connected")).isEqualTo(false);
	}
}
