package com.bim.api;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/** FMS: 자산 → 점검 → 작업지시. 상태 enum 검증은 DB CHECK 가 한다 (02-data-model). */
@RestController
@RequestMapping("/api")
class FmController {
	private final JdbcClient db;
	private static final ObjectMapper JSON = new ObjectMapper();
	FmController(JdbcClient db) { this.db = db; }

	// ---------- asset ----------
	record AssetIn(String globalId, String tag, String category, LocalDate installedOn, Map<String, Object> attributes) {}

	/** 모델의 자산 목록 (+ 연결 요소·최근 점검·열린 작업지시 수) */
	@GetMapping("/models/{id}/assets")
	List<Map<String, Object>> assets(@PathVariable UUID id) {
		return db.sql("""
			SELECT a.id, a.tag, a.category, a.status, a.installed_on "installedOn", a.attributes::text attributes,
			       e.global_id "globalId", e.ifc_class "ifcClass", e.name "elementName",
			       (SELECT max(inspected_on) FROM inspection i WHERE i.asset_id = a.id) "lastInspectedOn",
			       (SELECT result FROM inspection i WHERE i.asset_id = a.id ORDER BY inspected_on DESC, id DESC LIMIT 1) "lastResult",
			       (SELECT count(*) FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE') "openWorkOrders"
			  FROM asset a LEFT JOIN element e ON e.id = a.element_id
			 WHERE a.model_id = :id ORDER BY a.tag""").param("id", id).query().listOfRows().stream().map(FmController::json).toList();
	}

	/** 자산 등록. globalId 가 있으면 요소에 연결(없는 요소면 404). tag 중복은 409 */
	@PostMapping("/models/{id}/assets")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Object> createAsset(@PathVariable UUID id, @RequestBody AssetIn in) {
		if (in.tag() == null || in.tag().isBlank()) throw new ProjectController.BadRequest("tag required");
		Long elementId = null;
		if (in.globalId() != null) elementId = db.sql("SELECT id FROM element WHERE model_id = :m AND global_id = :g").param("m", id).param("g", in.globalId())
			.query(Long.class).optional().orElseThrow(() -> new ProjectController.NotFound("element " + in.globalId()));
		if (db.sql("SELECT count(*) FROM asset WHERE model_id = :m AND tag = :t").param("m", id).param("t", in.tag()).query(Long.class).single() > 0)
			throw new Conflict("tag exists: " + in.tag());
		UUID aid = db.sql("""
			INSERT INTO asset (model_id, element_id, tag, category, installed_on, attributes)
			VALUES (:m, :e, :t, :c, :d, :a::jsonb) RETURNING id""")
			.param("m", id).param("e", elementId).param("t", in.tag()).param("c", in.category()).param("d", in.installedOn())
			.param("a", JSON.writeValueAsString(in.attributes() == null ? Map.of() : in.attributes())).query(UUID.class).single();
		return asset(aid);
	}

	/** 장비 일괄 자산 등록: 계통 멤버 중 배관·트레이·케이블을 뺀 요소 가운데 자산이 없는 것 전부. 태그 = 클래스 약어-층-순번 */
	@PostMapping("/models/{id}/assets/bulk")
	Map<String, Object> bulk(@PathVariable UUID id) {
		var rows = db.sql("""
			SELECT DISTINCT e.id, e.global_id, e.ifc_class, e.name, coalesce(st.name, sn.name) storey
			  FROM element e JOIN element_system es ON es.element_id = e.id
			  LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id
			  LEFT JOIN spatial_node st ON st.id = sn.parent_id AND st.ifc_class = 'IfcBuildingStorey'
			  LEFT JOIN asset a ON a.element_id = e.id
			 WHERE e.model_id = :id AND a.id IS NULL
			   AND e.ifc_class NOT IN ('IfcPipeSegment', 'IfcCableCarrierSegment', 'IfcCableSegment', 'IfcDuctSegment')
			 ORDER BY e.ifc_class, e.name""").param("id", id).query().listOfRows();
		var seq = new java.util.HashMap<String, Integer>();
		int n = 0;
		for (var r : rows) {
			String cls = ((String) r.get("ifc_class")).replace("Ifc", "");
			String abbr = cls.replaceAll("[a-z]", ""); if (abbr.length() < 2) abbr = cls.substring(0, Math.min(3, cls.length())).toUpperCase();
			String key = abbr + "-" + r.get("storey");
			String tag = key + "-" + String.format("%02d", seq.merge(key, 1, Integer::sum));
			db.sql("INSERT INTO asset (model_id, element_id, tag, category, attributes) VALUES (:m, :e, :t, :c, '{}'::jsonb) ON CONFLICT DO NOTHING")
				.param("m", id).param("e", r.get("id")).param("t", tag).param("c", cls).update();
			n++;
		}
		return Map.of("registered", n);
	}

	@GetMapping("/assets/{id}")
	Map<String, Object> asset(@PathVariable UUID id) {
		var a = json(db.sql("""
			SELECT a.id, a.model_id "modelId", a.tag, a.category, a.status, a.installed_on "installedOn", a.attributes::text attributes,
			       e.global_id "globalId", e.ifc_class "ifcClass", e.name "elementName"
			  FROM asset a LEFT JOIN element e ON e.id = a.element_id WHERE a.id = :id""").param("id", id).query().listOfRows()
			.stream().findFirst().orElseThrow(() -> new ProjectController.NotFound("asset " + id)));
		a.put("inspections", db.sql("SELECT id, inspected_on \"inspectedOn\", result, note FROM inspection WHERE asset_id = :id ORDER BY inspected_on DESC, id DESC").param("id", id).query().listOfRows());
		a.put("workOrders", db.sql("SELECT id, title, status, assignee, due_on \"dueOn\", inspection_id \"inspectionId\", viewpoint::text viewpoint, created_at \"createdAt\" FROM work_order WHERE asset_id = :id ORDER BY created_at DESC")
			.param("id", id).query().listOfRows().stream().map(w -> json(w, "viewpoint")).toList());
		return a;
	}

	record AssetPatch(String status, String category) {}
	@PatchMapping("/assets/{id}")
	Map<String, Object> patchAsset(@PathVariable UUID id, @RequestBody AssetPatch p) {
		db.sql("UPDATE asset SET status = coalesce(:s, status), category = coalesce(:c, category) WHERE id = :id").param("s", p.status()).param("c", p.category()).param("id", id).update();
		return asset(id);
	}

	@DeleteMapping("/assets/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void deleteAsset(@PathVariable UUID id) { db.sql("DELETE FROM asset WHERE id = :id").param("id", id).update(); }

	// ---------- inspection ----------
	record InspectionIn(LocalDate inspectedOn, String result, String note) {}
	@PostMapping("/assets/{id}/inspections")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Object> inspect(@PathVariable UUID id, @RequestBody InspectionIn in) {
		if (in.result() == null) throw new ProjectController.BadRequest("result OK|DEFECT required");
		return db.sql("""
			INSERT INTO inspection (asset_id, inspected_on, result, note) VALUES (:a, coalesce(:d, CURRENT_DATE), :r, :n)
			RETURNING id, asset_id "assetId", inspected_on "inspectedOn", result, note""")
			.param("a", id).param("d", in.inspectedOn()).param("r", in.result()).param("n", in.note()).query().listOfRows().getFirst();
	}

	// ---------- work order ----------
	record WorkOrderIn(String title, String assignee, LocalDate dueOn, UUID inspectionId, Map<String, Object> viewpoint) {}

	/** 모델의 작업지시 목록 (보드용). status 로 필터 가능 */
	@GetMapping("/models/{id}/work-orders")
	List<Map<String, Object>> workOrders(@PathVariable UUID id, @RequestParam(required = false) String status) {
		return db.sql("""
			SELECT w.id, w.title, w.status, w.assignee, w.due_on "dueOn", w.inspection_id "inspectionId", w.viewpoint::text viewpoint, w.created_at "createdAt",
			       a.id "assetId", a.tag "assetTag", e.global_id "globalId", e.ifc_class "ifcClass", e.name "elementName"
			  FROM work_order w JOIN asset a ON a.id = w.asset_id LEFT JOIN element e ON e.id = a.element_id
			 WHERE a.model_id = :id AND (:s::text IS NULL OR w.status = :s)
			 ORDER BY CASE w.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END, w.due_on NULLS LAST, w.created_at DESC""")
			.param("id", id).param("s", status).query().listOfRows().stream().map(w -> json(w, "viewpoint")).toList();
	}

	@PostMapping("/assets/{id}/work-orders")
	@ResponseStatus(HttpStatus.CREATED)
	Map<String, Object> createWorkOrder(@PathVariable UUID id, @RequestBody WorkOrderIn in) {
		if (in.title() == null || in.title().isBlank()) throw new ProjectController.BadRequest("title required");
		UUID wid = db.sql("""
			INSERT INTO work_order (asset_id, inspection_id, title, assignee, due_on, viewpoint)
			VALUES (:a, :i, :t, :as, :d, :v::jsonb) RETURNING id""")
			.param("a", id).param("i", in.inspectionId()).param("t", in.title()).param("as", in.assignee()).param("d", in.dueOn())
			.param("v", in.viewpoint() == null ? null : JSON.writeValueAsString(in.viewpoint())).query(UUID.class).single();
		return workOrder(wid);
	}

	@GetMapping("/work-orders/{id}")
	Map<String, Object> workOrder(@PathVariable UUID id) {
		return json(db.sql("""
			SELECT w.id, w.title, w.status, w.assignee, w.due_on "dueOn", w.inspection_id "inspectionId", w.viewpoint::text viewpoint, w.created_at "createdAt",
			       a.id "assetId", a.tag "assetTag", a.model_id "modelId", e.global_id "globalId", e.ifc_class "ifcClass", e.name "elementName"
			  FROM work_order w JOIN asset a ON a.id = w.asset_id LEFT JOIN element e ON e.id = a.element_id WHERE w.id = :id""")
			.param("id", id).query().listOfRows().stream().findFirst().orElseThrow(() -> new ProjectController.NotFound("work order " + id)), "viewpoint");
	}

	record WorkOrderPatch(String status, String assignee, LocalDate dueOn) {}
	@PatchMapping("/work-orders/{id}")
	Map<String, Object> patchWorkOrder(@PathVariable UUID id, @RequestBody WorkOrderPatch p) {
		db.sql("UPDATE work_order SET status = coalesce(:s, status), assignee = coalesce(:a, assignee), due_on = coalesce(:d, due_on), updated_at = now() WHERE id = :id")
			.param("s", p.status()).param("a", p.assignee()).param("d", p.dueOn()).param("id", id).update();
		return workOrder(id);
	}

	// ---------- helpers ----------
	private static Map<String, Object> json(Map<String, Object> row) { return json(row, "attributes"); }
	private static Map<String, Object> json(Map<String, Object> row, String col) {
		var v = row.get(col);
		if (v != null) row.put(col, Json.parse((String) v));
		return row;
	}
	@ResponseStatus(HttpStatus.CONFLICT)
	static class Conflict extends RuntimeException { Conflict(String m) { super(m); } }
}
