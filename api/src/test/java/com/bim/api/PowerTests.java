package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 정전 시나리오: 한전(MDB 하류 + 비상) ↔ 발전기(비상만). 탱크→발전기→ATS→EMDB→비상부하, MDB→일반부하 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class PowerTests {
	@Autowired JdbcClient db;
	@Autowired StatusService status;

	UUID mid;
	final Map<String, Long> el = new HashMap<>();

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		long elec = db.sql("INSERT INTO system (model_id, global_id, name, predefined_type) VALUES (:m, 'S1', '전기', 'ELECTRICAL') RETURNING id").param("m", mid).query(Long.class).single();
		for (var e : List.of(new String[]{"MDB", "IfcElectricDistributionBoard"}, new String[]{"TANK", "IfcTank"}, new String[]{"EG-1", "IfcElectricGenerator"},
				new String[]{"ATS", "IfcSwitchingDevice"}, new String[]{"EMDB", "IfcElectricDistributionBoard"}, new String[]{"LOAD", "IfcLamp"}, new String[]{"ELOAD", "IfcLamp"})) {
			long id = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, :g, :c, :g) RETURNING id").param("m", mid).param("g", e[0]).param("c", e[1]).query(Long.class).single();
			db.sql("INSERT INTO element_system (element_id, system_id) VALUES (:e, :s)").param("e", id).param("s", elec).update();
			el.put(e[0], id);
		}
		for (var c : List.of("MDB>LOAD", "MDB>ATS", "TANK>EG-1", "EG-1>ATS", "ATS>EMDB", "EMDB>ELOAD")) {
			var p = c.split(">");
			db.sql("INSERT INTO connection (model_id, from_element_id, to_element_id) VALUES (:m, :f, :t)").param("m", mid).param("f", el.get(p[0])).param("t", el.get(p[1])).update();
		}
	}

	@Test
	@SuppressWarnings("unchecked")
	void generatorPowersOnlyEmergencyLoads() {
		assertThat(status.powerSource(mid)).isEmpty();
		var utility = status.power(mid, "UTILITY");
		assertThat((List<Object>) utility.get("powered")).contains("LOAD", "ELOAD"); assertThat((List<Object>) utility.get("unpowered")).isEmpty();
		var gen = status.power(mid, "GENERATOR");
		assertThat((List<Object>) gen.get("powered")).contains("ELOAD", "EG-1").doesNotContain("LOAD");
		assertThat((List<Object>) gen.get("unpowered")).contains("LOAD").doesNotContain("ELOAD");
		assertThat(status.powerSource(mid)).contains("GENERATOR");   // ATS 에 기록됨
		assertThat(status.powerNow(mid).get("unpowered")).isEqualTo(gen.get("unpowered"));   // 조회는 변경과 같은 계산
	}
}
