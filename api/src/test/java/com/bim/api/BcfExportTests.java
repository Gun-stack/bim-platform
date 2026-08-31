package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** BCF 2.1 zip: topic 상태 매핑, 좌표 변환(scene Y-up → IFC Z-up), 선택 요소, XML 이스케이프. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class BcfExportTests {
	@Autowired JdbcClient db;
	@Autowired FmService fm;
	@Autowired ExportController export;

	@Test
	void bcfZipHasTopicAndViewpoint() throws Exception {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		UUID mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		UUID aid = db.sql("INSERT INTO asset (model_id, tag) VALUES (:m, 'PUMP-01') RETURNING id").param("m", mid).query(UUID.class).single();
		var wo = fm.createWorkOrder(aid, new FmService.WorkOrderIn("펌프 <수리> & 점검", "김반장", LocalDate.of(2026, 9, 1), null,
			Map.of("v", List.of(10, 2, 3, 10, 2, 0), "sel", List.of("G1")), "HIGH", null));
		fm.patchWorkOrder((UUID) wo.get("id"), new FmService.WorkOrderPatch("IN_PROGRESS", null, null, null, null, null));

		var body = export.bcf(mid).getBody();
		Map<String, String> files = new HashMap<>();
		try (var zin = new ZipInputStream(new ByteArrayInputStream(body))) {
			for (var e = zin.getNextEntry(); e != null; e = zin.getNextEntry()) files.put(e.getName(), new String(zin.readAllBytes(), StandardCharsets.UTF_8));
		}
		String markup = files.get(wo.get("id") + "/markup.bcf"), vp = files.get(wo.get("id") + "/viewpoint.bcfv");
		assertThat(files).containsKey("bcf.version");
		assertThat(markup).contains("TopicStatus=\"In Progress\"").contains("펌프 &lt;수리&gt; &amp; 점검")
			.contains("<AssignedTo>김반장</AssignedTo>").contains("<DueDate>2026-09-01T00:00:00Z</DueDate>");
		// scene (10,2,3) → IFC (10,-3,2); 시선 scene (0,0,-3) → IFC (0,3,0) 정규화 (0,1,0); up 은 Z 직교화 → (0,0,1)
		assertThat(vp).contains("<CameraViewPoint><X>10.0</X><Y>-3.0</Y><Z>2.0</Z></CameraViewPoint>")
			.contains("<CameraDirection><X>0.0</X><Y>1.0</Y><Z>0.0</Z></CameraDirection>")
			.contains("<CameraUpVector><X>0.0</X><Y>0.0</Y><Z>1.0</Z></CameraUpVector>")
			.contains("<Component IfcGuid=\"G1\"/>");
	}
}
