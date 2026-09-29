package com.bim.api;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
	private static final Logger log = LoggerFactory.getLogger(ModelController.class);
	private final JdbcClient db;
	private final TransactionTemplate tx;
	private final S3Client s3;
	private final String bucket;
	private final Notifier notifier;

	ModelController(JdbcClient db, TransactionTemplate tx, S3Client s3, @Value("${s3.bucket}") String bucket, Notifier notifier) {
		this.db = db; this.tx = tx; this.s3 = s3; this.bucket = bucket; this.notifier = notifier;
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

	/** 모델 삭제: DB 는 CASCADE(요소·공간·계통·자산·점검·작업지시·잡), S3 는 source.ifc + 썸네일 + glb/{id}/ 아래 전부(glb·3D Tiles). S3 실패는 무시하지 않고 500 — 행은 이미 지워졌으므로 로그로 남긴다. */
	@DeleteMapping("/models/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable UUID id) {
		var m = find(id);
		db.sql("DELETE FROM model WHERE id = :id").param("id", id).update();
		for (Object k : new Object[] { m.get("ifcKey"), thumbKey(id) })
			if (k != null) s3.deleteObject(b -> b.bucket(bucket).key((String) k));   // 없는 키 삭제는 S3 에서 성공
		// glb/ 는 익명 읽기 접두어 — 남기면 계속 공개된다. lease 별 glb 와 tiles/{lease}/… 를 접두어로 한 번에
		s3.listObjectsV2Paginator(b -> b.bucket(bucket).prefix("glb/" + id + "/")).contents()
			.forEach(o -> s3.deleteObject(b -> b.bucket(bucket).key(o.key())));
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

	/** 변환 진행률 SSE: 첫 스냅샷 + conversion_job 알림마다 모델 행 1회 조회. 종료 상태면 닫는다 — 구독자마다 1초 DB 폴링하던 것을 Notifier 하나로 */
	@GetMapping("/models/{id}/events")
	SseEmitter events(@PathVariable UUID id) throws IOException {
		var emitter = new SseEmitter(0L);
		var m = find(id);
		emitter.send(SseEmitter.event().name("status").data(m));
		if (DONE.contains((String) m.get("status"))) { emitter.complete(); return emitter; }
		Runnable[] off = { () -> {} };
		var done = new AtomicBoolean(false);   // 동시에 도착한 두 알림이 모두 DONE 을 보고 둘 다 complete() 하는 경쟁 방지 — 이 CAS 를 이긴 스레드만 종료 처리
		// Notifier 의 LISTEN 스레드를 막지 않도록 DB 재조회·전송은 가상 스레드에서 — 실패하면 구독 해제 + emitter 종료
		off[0] = notifier.subscribe(id, (kind, data) -> Thread.startVirtualThread(() -> onNotify(id, off[0], emitter, kind, done)));
		emitter.onCompletion(off[0]); emitter.onTimeout(off[0]); emitter.onError(t -> off[0].run());
		var again = find(id);   // 첫 조회와 구독 사이에 끝났으면 알림이 다시 오지 않는다
		if (DONE.contains((String) again.get("status")) && done.compareAndSet(false, true)) {
			emitter.send(SseEmitter.event().name("status").data(again)); off[0].run(); emitter.complete();
		}
		return emitter;
	}

	private void onNotify(UUID id, Runnable off, SseEmitter emitter, String kind, AtomicBoolean done) {
		if (done.get()) return;   // 이미 종료 처리된 구독 — 뒤늦게 도착한 알림은 버린다
		try {
			if (kind.equals("hb")) { emitter.send(SseEmitter.event().comment("hb")); return; }
			if (!kind.equals("job") && !kind.equals("resync")) return;
			var now = find(id);
			boolean finished = DONE.contains((String) now.get("status"));
			if (finished && !done.compareAndSet(false, true)) return;   // 다른 스레드가 먼저 종료 처리 — 중복 complete() 방지
			emitter.send(SseEmitter.event().name("status").data(now));
			if (finished) { off.run(); emitter.complete(); }
		} catch (IOException e) {   // 클라이언트 연결 종료로 추정되는 전송 실패
			log.debug("model {} events 전송 실패", id, e);
			off.run();
			try { emitter.completeWithError(e); } catch (Exception ignore) {}   // 이미 닫힌 emitter — completeWithError 자체 실패는 무시(스트림은 어차피 종료)
		} catch (RuntimeException e) {   // 모델 삭제 등
			log.warn("model {} events 처리 중 예외", id, e);
			off.run();
			try { emitter.completeWithError(e); } catch (Exception ignore) {}   // 위와 동일 — 무시
		}
	}

	private static final Set<String> DONE = Set.of("READY", "FAILED");
	private static final String SELECT = """
		SELECT m.id, m.name, m.status, m.ifc_schema "ifcSchema", m.glb_key "glbKey", m.tileset_key "tilesetKey", m.ifc_key "ifcKey",
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
		if (m.get("tilesetKey") != null) m.put("tilesetUrl", "/files/" + bucket + "/" + m.get("tilesetKey"));   // 3D Tiles(R2-2) — 같은 glb/ 익명 읽기·nginx 경로
		for (var k : List.of("footprint", "mapConversion")) if (m.get(k) instanceof String s) m.put(k, Json.parse(s));
		return m;
	}

	private Map<String, Object> find(UUID id) {
		return db.sql(SELECT + " WHERE m.id = :id").param("id", id).query().listOfRows().stream().findFirst()
			.map(this::withGlbUrl).orElseThrow(() -> new ApiErrors.NotFound("model " + id));
	}
}
