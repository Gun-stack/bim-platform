package com.bim.api;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
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

	@GetMapping("/models/{id}")
	Map<String, Object> get(@PathVariable UUID id) {
		var m = db.sql("""
			SELECT m.id, m.name, m.status, m.ifc_schema "ifcSchema", m.glb_key "glbKey",
			       m.element_count "elementCount", m.created_at "createdAt",
			       j.status "jobStatus", j.progress, j.attempts, j.error
			  FROM model m LEFT JOIN conversion_job j ON j.model_id = m.id
			 WHERE m.id = :id ORDER BY j.id DESC LIMIT 1""")
			.param("id", id).query().listOfRows().stream().findFirst()
			.orElseThrow(() -> new ProjectController.NotFound("model " + id));
		if (m.get("glbKey") != null) m.put("glbUrl", "/files/" + bucket + "/" + m.get("glbKey"));
		return m;
	}
}
