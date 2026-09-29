package com.bim.api;

import java.io.IOException;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/** GET /api/models/{id}/stream — 운영 이벤트 SSE(status·work_order·job·resync). 화면은 '다시 조회' 신호로만 쓴다 */
@RestController
@RequestMapping("/api")
class StreamController {
	private final Notifier notifier;

	StreamController(Notifier notifier) { this.notifier = notifier; }

	@GetMapping(value = "/models/{id}/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
	SseEmitter stream(@PathVariable UUID id) throws IOException {
		var em = new SseEmitter(0L);   // 시간 제한 없음 — 끊김은 하트비트 송신 실패로 정리
		Runnable[] off = { () -> {} };
		// Notifier 의 LISTEN 스레드를 막지 않도록 실제 전송은 가상 스레드에서 — 실패하면 구독 해제 + emitter 종료
		off[0] = notifier.subscribe(id, (kind, data) -> Thread.startVirtualThread(() -> deliver(em, off[0], kind, data)));
		em.onCompletion(off[0]); em.onTimeout(off[0]); em.onError(t -> off[0].run());
		em.send(SseEmitter.event().comment("ready"));   // 헤더를 바로 내보내 EventSource open 이 즉시 뜨게
		return em;
	}

	private static void deliver(SseEmitter em, Runnable off, String kind, String data) {
		try {
			em.send(kind.equals("hb") ? SseEmitter.event().comment("hb") : SseEmitter.event().name(kind).data(data, MediaType.APPLICATION_JSON));
		} catch (IOException | RuntimeException e) {
			off.run();
			try { em.completeWithError(e); } catch (Exception ignore) {}
		}
	}
}
