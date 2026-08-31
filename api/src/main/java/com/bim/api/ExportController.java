package com.bim.api;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/** COBie 축소 내보내기: Facility/Floor/Space/Type/Component/Job 시트를 CSV 로 담은 zip.
 *  COBie 2.4 의 시트·열 이름을 따르되 이 플랫폼이 가진 것만 채운다 (README "인수인계" 절).
 *  ponytail: xlsx 대신 CSV zip — 의존성 없이 스프레드시트로 열림. 정식 xlsx 는 POI 도입 시 */
@RestController
@RequestMapping("/api/models/{id}/export")
class ExportController {
	private final JdbcClient db;
	ExportController(JdbcClient db) { this.db = db; }

	@GetMapping("/cobie")
	ResponseEntity<byte[]> cobie(@PathVariable UUID id) throws IOException {
		var m = db.sql("SELECT m.name, m.created_at::date co, p.name pj FROM model m JOIN project p ON p.id = m.project_id WHERE m.id = :id")
			.param("id", id).query().listOfRows().stream().findFirst().orElseThrow(() -> new ProjectController.NotFound("model " + id));
		Object co = m.get("co");
		var out = new ByteArrayOutputStream();
		try (var zip = new ZipOutputStream(out)) {
			sheet(zip, "Facility", List.of(row("Name", "CreatedOn", "Category", "ProjectName", "Description"),
				row(m.get("name"), co, "Facility", m.get("pj"), "BIM Operations Platform export")));

			var floors = start("Name", "CreatedOn", "Category", "Elevation");
			db.sql("SELECT name, elevation FROM spatial_node WHERE model_id = :id AND ifc_class = 'IfcBuildingStorey' ORDER BY elevation").param("id", id)
				.query().listOfRows().forEach(r -> floors.add(row(r.get("name"), co, "Floor", r.get("elevation"))));
			sheet(zip, "Floor", floors);

			var spaces = start("Name", "CreatedOn", "Category", "FloorName");
			db.sql("""
				SELECT s.name, st.name floor FROM spatial_node s LEFT JOIN spatial_node st ON st.id = s.parent_id
				 WHERE s.model_id = :id AND s.ifc_class = 'IfcSpace' ORDER BY st.elevation, s.name""").param("id", id)
				.query().listOfRows().forEach(r -> spaces.add(row(r.get("name"), co, "Space", r.get("floor"))));
			sheet(zip, "Space", spaces);

			var types = start("Name", "CreatedOn", "Category");
			db.sql("SELECT DISTINCT category FROM asset WHERE model_id = :id AND category IS NOT NULL ORDER BY 1").param("id", id)
				.query(String.class).list().forEach(c -> types.add(row(c, co, "Type")));
			sheet(zip, "Type", types);

			var comps = start("Name", "CreatedOn", "TypeName", "Space", "Description", "TagNumber", "ExtIdentifier", "InstallationDate");
			db.sql("""
				SELECT a.tag, a.installed_on io, a.category, e.name en, e.global_id gid,
				       coalesce(st.name, sn.name) storey, CASE WHEN sn.ifc_class = 'IfcSpace' THEN sn.name END zone
				  FROM asset a LEFT JOIN element e ON e.id = a.element_id
				  LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id LEFT JOIN spatial_node st ON st.id = sn.parent_id AND st.ifc_class = 'IfcBuildingStorey'
				 WHERE a.model_id = :id ORDER BY a.tag""").param("id", id)
				.query().listOfRows().forEach(r -> comps.add(row(r.get("tag"), co, r.get("category"),
					r.get("zone") != null ? r.get("zone") : r.get("storey"), r.get("en"), r.get("tag"), r.get("gid"), r.get("io"))));
			sheet(zip, "Component", comps);

			var jobs = start("Name", "CreatedOn", "Category", "Status", "ComponentName", "Description", "DueDate");
			db.sql("SELECT a.tag, i.inspected_on d, i.result, i.note FROM inspection i JOIN asset a ON a.id = i.asset_id WHERE a.model_id = :id ORDER BY d, i.id").param("id", id)
				.query().listOfRows().forEach(r -> jobs.add(row(r.get("tag") + " 점검 " + r.get("d"), r.get("d"), "Inspection", r.get("result"), r.get("tag"), r.get("note"), null)));
			db.sql("SELECT a.tag, w.created_at::date d, w.title, w.status, w.assignee, w.due_on due FROM work_order w JOIN asset a ON a.id = w.asset_id WHERE a.model_id = :id ORDER BY w.created_at").param("id", id)
				.query().listOfRows().forEach(r -> jobs.add(row(r.get("title"), r.get("d"), "WorkOrder", r.get("status"), r.get("tag"), r.get("assignee"), r.get("due"))));
			sheet(zip, "Job", jobs);
		}
		var h = new HttpHeaders();
		h.setContentDisposition(ContentDisposition.attachment().filename("cobie-" + id + ".zip").build());
		h.set(HttpHeaders.CONTENT_TYPE, "application/zip");
		return new ResponseEntity<>(out.toByteArray(), h, org.springframework.http.HttpStatus.OK);
	}

	private static List<String[]> start(String... header) { var l = new ArrayList<String[]>(); l.add(header); return l; }
	private static String[] row(Object... v) { return Arrays.stream(v).map(x -> x == null ? "" : String.valueOf(x)).toArray(String[]::new); }

	/** CSV: 쉼표·따옴표·개행 포함 필드는 따옴표 감싸기, UTF-8 BOM(엑셀 한글) */
	private static void sheet(ZipOutputStream zip, String name, List<String[]> rows) throws IOException {
		zip.putNextEntry(new ZipEntry(name + ".csv"));
		var sb = new StringBuilder("﻿");
		for (var r : rows) sb.append(String.join(",", Arrays.stream(r).map(ExportController::esc).toList())).append("\r\n");
		zip.write(sb.toString().getBytes(StandardCharsets.UTF_8));
		zip.closeEntry();
	}
	private static String esc(String s) {
		return (s.contains(",") || s.contains("\"") || s.contains("\n") || s.contains("\r")) ? '"' + s.replace("\"", "\"\"") + '"' : s;
	}
}
