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

	/** BCF 2.1 내보내기: 작업지시 → topic, 저장된 뷰포인트 → viewpoint.bcfv 카메라·선택 요소.
	 *  뷰어 좌표는 glTF Y-up (IfcOpenShell 이 Z-up 을 -90° X 회전) → IFC 좌표 복원: (x, y, z)_scene → (x, -z, y)_ifc.
	 *  작업지시 viewpoint 필드가 BCF viewpoint 와 맞게 설계됨 (README "조정·검토" 절) — 이슈를 Navisworks/BIMcollab 쪽으로 넘길 수 있다 */
	@GetMapping("/bcf")
	ResponseEntity<byte[]> bcf(@PathVariable UUID id) throws IOException {
		var wos = db.sql("""
			SELECT w.id, w.title, w.status, w.priority, w.description, w.assignee,
			       to_char(w.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') created, w.due_on due, w.viewpoint::text vp
			  FROM work_order w JOIN asset a ON a.id = w.asset_id WHERE a.model_id = :id ORDER BY w.created_at""").param("id", id).query().listOfRows();
		var out = new ByteArrayOutputStream();
		try (var zip = new ZipOutputStream(out)) {
			entry(zip, "bcf.version", "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Version VersionId=\"2.1\"><DetailedVersion>2.1</DetailedVersion></Version>");
			for (var w : wos) {
				String guid = String.valueOf(w.get("id"));
				String vpGuid = UUID.nameUUIDFromBytes((guid + ":vp").getBytes(StandardCharsets.UTF_8)).toString();
				@SuppressWarnings("unchecked") var vp = (java.util.Map<String, Object>) Json.parse((String) w.get("vp"));
				String status = switch (String.valueOf(w.get("status"))) { case "IN_PROGRESS" -> "In Progress"; case "DONE" -> "Closed"; default -> "Active"; };
				var m = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<Markup><Topic Guid=\"%s\" TopicType=\"Issue\" TopicStatus=\"%s\">".formatted(guid, status));
				m.append("<Title>").append(xml(w.get("title"))).append("</Title>");
				if (w.get("priority") != null) m.append("<Priority>").append(xml(w.get("priority"))).append("</Priority>");
				m.append("<CreationDate>").append(w.get("created")).append("</CreationDate><CreationAuthor>bim-platform</CreationAuthor>");
				if (w.get("due") != null) m.append("<DueDate>").append(w.get("due")).append("T00:00:00Z</DueDate>");
				if (w.get("assignee") != null) m.append("<AssignedTo>").append(xml(w.get("assignee"))).append("</AssignedTo>");
				if (w.get("description") != null) m.append("<Description>").append(xml(w.get("description"))).append("</Description>");
				m.append("</Topic>");
				if (vp != null) m.append("<Viewpoints Guid=\"%s\"><Viewpoint>viewpoint.bcfv</Viewpoint></Viewpoints>".formatted(vpGuid));
				m.append("</Markup>");
				entry(zip, guid + "/markup.bcf", m.toString());
				if (vp != null) entry(zip, guid + "/viewpoint.bcfv", bcfv(vpGuid, vp));
			}
		}
		var h = new HttpHeaders();
		h.setContentDisposition(ContentDisposition.attachment().filename("workorders-" + id + ".bcfzip").build());
		h.set(HttpHeaders.CONTENT_TYPE, "application/octet-stream");
		return new ResponseEntity<>(out.toByteArray(), h, org.springframework.http.HttpStatus.OK);
	}

	private static String bcfv(String guid, java.util.Map<String, Object> vp) {
		var sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<VisualizationInfo Guid=\"" + guid + "\">");
		if (vp.get("sel") instanceof List<?> sel && !sel.isEmpty()) {
			sb.append("<Components><Selection>");
			for (var g : sel) sb.append("<Component IfcGuid=\"").append(xml(g)).append("\"/>");
			sb.append("</Selection></Components>");
		}
		if (vp.get("v") instanceof List<?> v && v.size() >= 6) {
			// scene(Y-up) → IFC(Z-up): (x, y, z) → (x, -z, y)
			double px = d(v.get(0)), py = -d(v.get(2)), pz = d(v.get(1));
			double tx = d(v.get(3)), ty = -d(v.get(5)), tz = d(v.get(4));
			double dx = tx - px, dy = ty - py, dz = tz - pz, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
			if (len > 0) { dx /= len; dy /= len; dz /= len; }
			double ux = -dx * dz, uy = -dy * dz, uz = 1 - dz * dz, ul = Math.sqrt(ux * ux + uy * uy + uz * uz);   // up = Z 를 시선에 직교화
			if (ul < 1e-6) { ux = 0; uy = 1; uz = 0; } else { ux /= ul; uy /= ul; uz /= ul; }
			sb.append("<PerspectiveCamera>").append(xyz("CameraViewPoint", px, py, pz)).append(xyz("CameraDirection", dx, dy, dz))
			  .append(xyz("CameraUpVector", ux, uy, uz)).append("<FieldOfView>60</FieldOfView></PerspectiveCamera>");   // 뷰어 카메라 fov
		}
		return sb.append("</VisualizationInfo>").toString();
	}
	private static double d(Object o) { return ((Number) o).doubleValue(); }
	private static String xyz(String tag, double x, double y, double z) { return "<%1$s><X>%2$s</X><Y>%3$s</Y><Z>%4$s</Z></%1$s>".formatted(tag, x + 0.0, y + 0.0, z + 0.0); }   // +0.0: -0.0 정리
	private static String xml(Object s) { return String.valueOf(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;"); }
	private static void entry(ZipOutputStream zip, String name, String content) throws IOException {
		zip.putNextEntry(new ZipEntry(name)); zip.write(content.getBytes(StandardCharsets.UTF_8)); zip.closeEntry();
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
