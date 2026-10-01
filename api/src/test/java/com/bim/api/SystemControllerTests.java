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

/** /systems 응답이 계통 멤버 GlobalId 를 한 번에 담는지(B300·P104) — 뷰어가 탭을 열지 않고 마운트 때 전체를 받으려면
 *  더 이상 계통마다 /systems/{sid}/elements 를 따로 부르지 않아도 멤버를 알 수 있어야 한다 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class SystemControllerTests {
	@Autowired JdbcClient db;
	@Autowired SystemController systems;

	UUID mid;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		long sys = db.sql("INSERT INTO system (model_id, global_id, name, predefined_type) VALUES (:m, 'S1', '급수', 'DOMESTICCOLDWATER') RETURNING id").param("m", mid).query(Long.class).single();
		for (var g : List.of("PUMP", "PIPE")) {
			long eid = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, :g, 'IfcPump', :g) RETURNING id").param("m", mid).param("g", g).query(Long.class).single();
			db.sql("INSERT INTO element_system (element_id, system_id) VALUES (:e, :s)").param("e", eid).param("s", sys).update();
		}
		// 다른 계통에는 안 속함 — 섞여 들어가지 않는지 확인용
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'LONE', 'IfcPump', 'LONE')").param("m", mid).update();
	}

	@Test
	void systemsResponseIncludesMemberGlobalIds() {
		var rows = systems.systems(mid);
		assertThat(rows).hasSize(1);
		Map<String, Object> row = rows.getFirst();
		assertThat(row.get("memberCount")).isEqualTo(2L);
		@SuppressWarnings("unchecked") var members = (List<String>) row.get("members");
		assertThat(members).containsExactlyInAnyOrder("PUMP", "PIPE");   // 기존 /systems/{sid}/elements 와 같은 집합
	}
}
