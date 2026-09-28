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
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;

/** IFC 업로드 → MinIO → model + conversion_job. worker 가 잡을 집어간다. */
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
		if (!name.toLowerCase().endsWith(".ifc")) throw new ApiErrors.BadRequest("only .ifc");
		UUID id = UUID.randomUUID();
		String key = "models/" + id + "/source.ifc";
		Path tmp = Files.createTempFile("ifc", ".ifc");
		try {
			file.transferTo(tmp);
			s3.putObject(b -> b.bucket(bucket).key(key), tmp);
		} finally {
			Files.deleteIfExists(tmp);
		}
		// S3 put 후 DB insert. DB 실패 시 객체 삭제
		try {
			tx.executeWithoutResult(st -> {
				db.sql("INSERT INTO model (id, project_id, name, ifc_key) VALUES (:id, :pid, :name, :key)")
					.param("id", id).param("pid", pid).param("name", name).param("key", key).update();
				db.sql("INSERT INTO conversion_job (model_id) VALUES (:id)").param("id", id).update();
			});
		} catch (RuntimeException e) {
			s3.deleteObject(b -> b.bucket(bucket).key(key));
			if (e instanceof DataIntegrityViolationException) throw new ApiErrors.NotFound("project " + pid);
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

	/** 모델 삭제: DB 는 CASCADE(요소·공간·계통·자산·점검·작업지시·잡), S3 는 source.ifc + glb. S3 실패는 무시하지 않고 500 — 행은 이미 지워졌으므로 로그로 남긴다. */
	@DeleteMapping("/models/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable UUID id) {
		var m = find(id);
		db.sql("DELETE FROM model WHERE id = :id").param("id", id).update();
		for (Object k : new Object[] { m.get("ifcKey"), m.get("glbKey"), thumbKey(id) })
			if (k != null) s3.deleteObject(b -> b.bucket(bucket).key((String) k));   // 없는 키 삭제는 S3 에서 성공
	}

	/** 홈 카드 썸네일(뷰어가 첫 로드 때 렌더해 올린다). 없으면 404 — 카드는 자리표시로 */
	@GetMapping(value = "/models/{id}/thumbnail", produces = MediaType.IMAGE_JPEG_VALUE)
	ResponseEntity<byte[]> thumbnail(@PathVariable UUID id) {
		try {
			return ResponseEntity.ok().header("Cache-Control", "no-cache").body(s3.getObjectAsBytes(b -> b.bucket(bucket).key(thumbKey(id))).asByteArray());
		} catch (NoSuchKeyException e) {
			throw new ApiErrors.NotFound("thumbnail " + id);
		}
	}

	@PutMapping(value = "/models/{id}/thumbnail", consumes = MediaType.IMAGE_JPEG_VALUE)
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void putThumbnail(@PathVariable UUID id, @RequestBody byte[] jpeg) {
		find(id);   // 없는 모델이면 404
		if (jpeg.length == 0 || jpeg.length > THUMB_MAX) throw new ApiErrors.BadRequest("thumbnail 1B~" + THUMB_MAX / 1024 + "KB");
		if ((jpeg[0] & 0xff) != 0xff || (jpeg[1] & 0xff) != 0xd8) throw new ApiErrors.BadRequest("not a JPEG");   // SOI 마커
		s3.putObject(b -> b.bucket(bucket).key(thumbKey(id)).contentType(MediaType.IMAGE_JPEG_VALUE), software.amazon.awssdk.core.sync.RequestBody.fromBytes(jpeg));   // Spring @RequestBody 와 이름 충돌
	}

	private static final int THUMB_MAX = 256 * 1024;
	private static String thumbKey(UUID id) { return "thumb/" + id + ".jpg"; }

	/** FAILED 모델의 잡 재등록. 이전 잡 행은 이력으로 남긴다 (conversion_job 1:N). */
	@PostMapping("/models/{id}/retry")
	Map<String, Object> retry(@PathVariable UUID id) {
		var m = find(id);
		if (!"FAILED".equals(m.get("status"))) throw new ApiErrors.BadRequest("not FAILED: " + m.get("status"));
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
		SELECT m.id, m.name, m.status, m.ifc_schema "ifcSchema", m.glb_key "glbKey", m.ifc_key "ifcKey",
		       m.element_count "elementCount", m.created_at "createdAt",
		       ST_AsGeoJSON(m.footprint)::text footprint, m.map_conversion::text "mapConversion",
		       j.status "jobStatus", j.progress, j.attempts, j.error,
		       st.alarms, st.faults,
		       (SELECT count(*) FROM work_order w JOIN asset a ON a.id = w.asset_id WHERE a.model_id = m.id AND w.status <> 'DONE') "openWorkOrders"
		  FROM model m LEFT JOIN LATERAL (SELECT * FROM conversion_job WHERE model_id = m.id ORDER BY id DESC LIMIT 1) j ON true
		  LEFT JOIN LATERAL (   -- 홈 카드 운영 칩: 웹 isAbnormal 과 같은 기준(ALARM·FAULT)
		    SELECT count(*) FILTER (WHERE s = 'ALARM') alarms, count(*) FILTER (WHERE s = 'FAULT') faults
		      FROM (SELECT e.properties->'Pset_BimStatus'->>'Status' s FROM element e WHERE e.model_id = m.id) x) st ON true""";

	private Map<String, Object> withGlbUrl(Map<String, Object> m) {
		if (m.get("glbKey") != null) m.put("glbUrl", "/files/" + bucket + "/" + m.get("glbKey"));
		for (var k : List.of("footprint", "mapConversion")) if (m.get(k) instanceof String s) m.put(k, Json.parse(s));
		return m;
	}

	private Map<String, Object> find(UUID id) {
		return db.sql(SELECT + " WHERE m.id = :id").param("id", id).query().listOfRows().stream().findFirst()
			.map(this::withGlbUrl).orElseThrow(() -> new ApiErrors.NotFound("model " + id));
	}
}
