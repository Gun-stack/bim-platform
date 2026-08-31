package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** COBie CSV zip: 시트 구성과 Component/Job 행 내용, CSV 이스케이프. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ExportTests {
	@Autowired JdbcClient db;
	@Autowired FmService fm;
	@Autowired ExportController export;

	@Test
	void cobieZipHasSheetsWithRows() throws Exception {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		UUID mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		long st = db.sql("INSERT INTO spatial_node (model_id, global_id, ifc_class, name, elevation) VALUES (:m, 'ST1', 'IfcBuildingStorey', '1F', 0) RETURNING id").param("m", mid).query(Long.class).single();
		long sp = db.sql("INSERT INTO spatial_node (model_id, parent_id, global_id, ifc_class, name) VALUES (:m, :p, 'SP1', 'IfcSpace', '1F-A') RETURNING id").param("m", mid).param("p", st).query(Long.class).single();
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name, spatial_node_id) VALUES (:m, 'G1', 'IfcPump', '소화, \"주\"펌프', :s)").param("m", mid).param("s", sp).update();
		UUID aid = db.sql("INSERT INTO asset (model_id, element_id, tag, category) SELECT :m, id, 'PUMP-01', 'Pump' FROM element WHERE model_id = :m RETURNING id").param("m", mid).query(UUID.class).single();
		fm.inspect(aid, new FmService.InspectionIn(LocalDate.of(2026, 1, 2), "DEFECT", "누수"));
		fm.createWorkOrder(aid, new FmService.WorkOrderIn("펌프 수리", "김반장", null, null, null, "HIGH", null));

		var body = export.cobie(mid).getBody();
		Map<String, String> sheets = new HashMap<>();
		try (var zin = new ZipInputStream(new ByteArrayInputStream(body))) {
			for (var e = zin.getNextEntry(); e != null; e = zin.getNextEntry()) sheets.put(e.getName(), new String(zin.readAllBytes(), StandardCharsets.UTF_8));
		}
		assertThat(sheets.keySet()).containsExactlyInAnyOrder("Facility.csv", "Floor.csv", "Space.csv", "Type.csv", "Component.csv", "Job.csv");
		assertThat(sheets.get("Component.csv")).contains("PUMP-01").contains("G1").contains("1F-A").contains("\"소화, \"\"주\"\"펌프\"");   // CSV 이스케이프
		assertThat(sheets.get("Job.csv")).contains("PUMP-01 점검 2026-01-02,2026-01-02,Inspection,DEFECT").contains("펌프 수리").contains("WorkOrder,OPEN");
		assertThat(sheets.get("Floor.csv")).contains("1F");
	}
}
