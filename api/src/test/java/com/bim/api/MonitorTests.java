package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 모니터링 목록이 공유 SQL 조각(Sql.SEGMENT_CLASSES·NEXT_DUE·STOREY_ZONE)을 자산 대장과 같은 규칙으로 쓰는지 — 두 화면이 어긋나던 지점 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class MonitorTests {
	@Autowired JdbcClient db;
	@Autowired FmService fm;
	@Autowired MonitorController monitor;
	@Autowired StatusService status;

	UUID mid;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		long st = db.sql("INSERT INTO spatial_node (model_id, global_id, ifc_class, name, elevation) VALUES (:m, 'ST1', 'IfcBuildingStorey', 'B1', -3.5) RETURNING id").param("m", mid).query(Long.class).single();
		long sp = db.sql("INSERT INTO spatial_node (model_id, parent_id, global_id, ifc_class, name) VALUES (:m, :p, 'SP1', 'IfcSpace', '기계실') RETURNING id").param("m", mid).param("p", st).query(Long.class).single();
		long sys = db.sql("INSERT INTO system (model_id, global_id, name, predefined_type) VALUES (:m, 'S1', '급수', 'DOMESTICCOLDWATER') RETURNING id").param("m", mid).query(Long.class).single();
		for (var e : List.of(new String[]{"PUMP", "IfcPump", "WP-1"}, new String[]{"PIPE", "IfcPipeSegment", "배관"}, new String[]{"FIT", "IfcFlowFitting", "엘보"})) {
			long eid = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name, spatial_node_id) VALUES (:m, :g, :c, :n, :s) RETURNING id")
				.param("m", mid).param("g", e[0]).param("c", e[1]).param("n", e[2]).param("s", sp).query(Long.class).single();
			db.sql("INSERT INTO element_system (element_id, system_id) VALUES (:e, :s)").param("e", eid).param("s", sys).update();
		}
	}

	@Test
	void segmentsExcludedAndAssetRulesMatchFm() {
		assertThat(fm.bulk(mid).get("registered")).isEqualTo(1);   // 배관·피팅은 자산으로 안 잡힘
		UUID aid = UUID.fromString(String.valueOf(fm.assets(mid).getFirst().get("id")));
		fm.patchAsset(aid, new FmService.AssetPatch(null, null, 6));
		fm.inspect(aid, new FmService.InspectionIn(LocalDate.of(2026, 1, 15), "OK", null));

		Map<String, Object> m = monitor.monitor(mid, false);
		@SuppressWarnings("unchecked") var rows = (List<Map<String, Object>>) m.get("rows");
		assertThat(rows).extracting(r -> r.get("globalId")).containsExactly("PUMP");   // 같은 제외 목록
		var pump = rows.getFirst();
		assertThat(String.valueOf(pump.get("nextDueOn"))).isEqualTo("2026-07-15");   // 같은 다음 점검일 규칙
		assertThat(pump.get("storey")).isEqualTo("B1"); assertThat(pump.get("zone")).isEqualTo("기계실");
		assertThat(pump.get("systems")).isEqualTo(List.of("급수"));
		assertThat(m.get("power")).isEqualTo("UNKNOWN");   // ATS 없음 → 화면은 '전원 정보 없음'
		assertThat(status.powerNow(mid).get("source")).isEqualTo("UTILITY");   // 계산은 한전 수전으로
		@SuppressWarnings("unchecked") var all = (List<Map<String, Object>>) monitor.monitor(mid, true).get("rows");
		assertThat(all).hasSize(3);   // segments=true 면 선도 포함
	}
}
