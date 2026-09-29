package com.bim.api;

import java.io.IOException;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** GET /api/models/{id}/stream — 운영 이벤트 SSE(status·work_order·job·resync). 화면은 '다시 조회' 신호로만 쓴다 */
@RestController
@RequestMapping("/api")
class StreamController {
	private static final Logger log = LoggerFactory.getLogger(StreamController.class);
	private final Notifier notifier;
	private final JdbcClient db;

	StreamController(Notifier notifier, JdbcClient db) { this.notifier = notifier; this.db = db; }

	@GetMapping(value = "/models/{id}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
	SseEmitter stream(@PathVariable UUID id) throws IOException {
		// 없는 모델이면 404 — 아무도 알림을 안 보내는 구독이 연결을 붙잡지 않게
		if (db.sql("SELECT 1 FROM model WHERE id = :id").param("id", id).query(Integer.class).optional().isEmpty()) throw new ApiErrors.NotFound("model " + id);
		var em = new SseEmitter(0L);   // 시간 제한 없음 — 끊김은 하트비트 송신 실패로 정리
		Runnable[] off = { () -> {} };
		// Notifier 의 LISTEN 스레드를 막지 않도록 실제 전송은 가상 스레드에서 — 실패하면 구독 해제 + emitter 종료
		off[0] = notifier.subscribe(id, (kind, data) -> Thread.startVirtualThread(() -> deliver(id, em, off[0], kind, data)));
		em.onCompletion(off[0]); em.onTimeout(off[0]); em.onError(t -> off[0].run());
		em.send(SseEmitter.event().comment("ready"));   // 헤더를 바로 내보내 EventSource open 이 즉시 뜨게
		return em;
	}

	private static void deliver(UUID id, SseEmitter em, Runnable off, String kind, String data) {
		try {
			em.send(kind.equals("hb") ? SseEmitter.event().comment("hb") : SseEmitter.event().name(kind).data(data, MediaType.APPLICATION_JSON));
		} catch (IOException e) {
			log.debug("model {} stream 전송 실패 — 클라이언트 연결 종료로 추정", id, e);
			off.run();
			try { em.completeWithError(e); } catch (Exception ignore) {}   // 이미 닫힌 emitter — completeWithError 자체 실패는 무시(스트림은 어차피 종료)
		} catch (RuntimeException e) {
			log.warn("model {} stream 처리 중 예외", id, e);
			off.run();
			try { em.completeWithError(e); } catch (Exception ignore) {}   // 위와 동일 — 무시
		}
	}
}
