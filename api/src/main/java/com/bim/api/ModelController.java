package com.bim.api;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import software.amazon.awssdk.services.s3.S3Client;

/** IFC 업로드 → MinIO → model + conversion_job. worker 가 잡을 집어간다 (ADR 0003). */
@RestController
@RequestMapping("/api")
class ModelController {
	private final JdbcClient db;
	private final TransactionTemplate tx;
	private final S3Client s3;
	private final String bucket;

	ModelController(JdbcClient db, TransactionTemplate tx, S3Client s3, @Value("${s3.bucket}") String bucket) {
		this.db = db; this.tx = tx; this.s3 = s3; this.bucket = bucket;
	}

	@PostMapping("/projects/{pid}/models")
	@ResponseStatus(HttpStatus.ACCEPTED)
	Map<String, Object> upload(@PathVariable UUID pid, @RequestPart("file") MultipartFile file) throws IOException {
		String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename();
		if (!name.toLowerCase().endsWith(".ifc")) throw new ProjectController.BadRequest("only .ifc");
		UUID id = UUID.randomUUID();
		String key = "models/" + id + "/source.ifc";
		Path tmp = Files.createTempFile("ifc", ".ifc");
		try {
			file.transferTo(tmp);
			s3.putObject(b -> b.bucket(bucket).key(key), tmp);
		} finally {
			Files.deleteIfExists(tmp);
		}
		// S3 put 후 DB insert. DB 실패 시 객체 삭제 (ADR 0006 영향 절)
		try {
			tx.executeWithoutResult(st -> {
				db.sql("INSERT INTO model (id, project_id, name, ifc_key) VALUES (:id, :pid, :name, :key)")
					.param("id", id).param("pid", pid).param("name", name).param("key", key).update();
				db.sql("INSERT INTO conversion_job (model_id) VALUES (:id)").param("id", id).update();
			});
		} catch (RuntimeException e) {
			s3.deleteObject(b -> b.bucket(bucket).key(key));
			if (e instanceof DataIntegrityViolationException) throw new ProjectController.NotFound("project " + pid);
			throw e;
		}
		return Map.of("id", id, "name", name, "status", "UPLOADED", "size", file.getSize());
	}

	@GetMapping("/projects/{pid}/models")
	List<Map<String, Object>> list(@PathVariable UUID pid) {
		return db.sql(SELECT + " WHERE m.project_id = :pid ORDER BY m.created_at DESC").param("pid", pid).query().listOfRows()
			.stream().map(this::withGlbUrl).toList();
	}

	@GetMapping("/models/{id}")
	Map<String, Object> get(@PathVariable UUID id) {
		return find(id);
	}

	/** FAILED 모델의 잡 재등록. 이전 잡 행은 이력으로 남긴다 (conversion_job 1:N). */
	@PostMapping("/models/{id}/retry")
	Map<String, Object> retry(@PathVariable UUID id) {
		var m = find(id);
		if (!"FAILED".equals(m.get("status"))) throw new ProjectController.BadRequest("not FAILED: " + m.get("status"));
		tx.executeWithoutResult(st -> {
			db.sql("UPDATE model SET status='UPLOADED' WHERE id=:id").param("id", id).update();
			db.sql("INSERT INTO conversion_job (model_id) VALUES (:id)").param("id", id).update();
		});
		return find(id);
	}

	/** 1초 폴링 → SSE. 종료 상태(READY/FAILED)면 마지막 이벤트 후 닫는다. 가상 스레드라 클라이언트당 스레드 비용 무시. */
	@GetMapping("/models/{id}/events")
	SseEmitter events(@PathVariable UUID id) {
		var emitter = new SseEmitter(0L);
		Thread.startVirtualThread(() -> {
			try {
				while (true) {
					var m = find(id);
					emitter.send(SseEmitter.event().name("status").data(m));
					if (DONE.contains((String) m.get("status"))) break;
					Thread.sleep(1000);
				}
				emitter.complete();
			} catch (Exception e) {  // 클라이언트 끊김·404 → 조용히 종료
				emitter.completeWithError(e);
			}
		});
		return emitter;
	}

	private static final Set<String> DONE = Set.of("READY", "FAILED");
	private static final String SELECT = """
		SELECT m.id, m.name, m.status, m.ifc_schema "ifcSchema", m.glb_key "glbKey",
		       m.element_count "elementCount", m.created_at "createdAt",
		       ST_AsGeoJSON(m.footprint)::text footprint, m.map_conversion::text "mapConversion",
		       j.status "jobStatus", j.progress, j.attempts, j.error
		  FROM model m LEFT JOIN LATERAL (SELECT * FROM conversion_job WHERE model_id = m.id ORDER BY id DESC LIMIT 1) j ON true""";

	private Map<String, Object> withGlbUrl(Map<String, Object> m) {
		if (m.get("glbKey") != null) m.put("glbUrl", "/files/" + bucket + "/" + m.get("glbKey"));
		for (var k : List.of("footprint", "mapConversion")) if (m.get(k) instanceof String s) m.put(k, Json.parse(s));
		return m;
	}

	private Map<String, Object> find(UUID id) {
		return db.sql(SELECT + " WHERE m.id = :id").param("id", id).query().listOfRows().stream().findFirst()
			.map(this::withGlbUrl).orElseThrow(() -> new ProjectController.NotFound("model " + id));
	}
}
