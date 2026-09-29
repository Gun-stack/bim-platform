package com.bim.api;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.function.BiConsumer;
import javax.sql.DataSource;
import org.postgresql.PGConnection;
import org.postgresql.PGNotification;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/** 실시간 푸시: DB 트리거의 pg_notify('bim', {m,k,g,s,p}) 를 풀 연결 하나로 LISTEN → 그 모델 구독자에게 (kind, json) 팬아웃.
 *  구독자 = SSE 어댑터(StreamController)·변환 진행률(ModelController.events)·테스트. sink 가 예외를 던지면(끊긴 SSE) 그 구독은 해제.
 *  연결이 끊기면 1→2→4…30초 백오프 재연결, 재연결 뒤 전원에게 resync(놓친 알림 — 화면이 전체 재조회). HEARTBEAT_MS 마다 hb(죽은 SSE 정리·프록시 유휴 타임아웃 방지) */
@Component
class Notifier implements SmartLifecycle {
	private static final Logger log = LoggerFactory.getLogger(Notifier.class);
	static final int HEARTBEAT_MS = 20_000;
	private final DataSource ds;
	private final Map<UUID, Set<BiConsumer<String, String>>> subs = new ConcurrentHashMap<>();
	private volatile boolean running;
	private volatile Thread thread;
	private final CountDownLatch listening = new CountDownLatch(1);

	Notifier(DataSource ds) { this.ds = ds; }

	/** 구독. 반환된 Runnable 을 실행하면 해제. 추가·제거 모두 compute 안에서 — 빈 집합은 맵에서 빠지고(누수 없음), 제거와 추가가 엇갈려도 구독이 사라지지 않음 */
	Runnable subscribe(UUID model, BiConsumer<String, String> sink) {
		subs.compute(model, (k, s) -> { if (s == null) s = ConcurrentHashMap.newKeySet(); s.add(sink); return s; });
		return () -> remove(model, sink);
	}

	private void remove(UUID model, BiConsumer<String, String> sink) {
		subs.computeIfPresent(model, (k, s) -> { s.remove(sink); return s.isEmpty() ? null : s; });
	}

	int subscribers() { return subs.values().stream().mapToInt(Set::size).sum(); }

	// 첫 LISTEN 이 걸릴 때까지 최대 10초 블록 — NotifyTests 처럼 기동 직후 INSERT 하는 테스트가 알림을 놓치지 않도록
	@Override public void start() {
		running = true;
		thread = Thread.ofVirtual().name("notifier").start(this::loop);
		try {
			if (!listening.await(10, TimeUnit.SECONDS)) log.warn("notifier 첫 LISTEN 이 10초 안에 걸리지 않음 — 계속 진행");
		} catch (InterruptedException e) { Thread.currentThread().interrupt(); }
	}
	@Override public void stop() { running = false; if (thread != null) thread.interrupt(); }
	@Override public boolean isRunning() { return running; }

	private void loop() {
		long backoff = 1000; boolean first = true;
		while (running) {
			try (Connection c = ds.getConnection()) {   // 풀에서 하나를 계속 점유 — LISTEN 은 연결 단위
				try (var st = c.createStatement()) { st.execute("LISTEN bim"); }
				listening.countDown();
				if (!first) toAll("resync", "{}");
				first = false; backoff = 1000;
				PGConnection pg = c.unwrap(PGConnection.class);
				long hb = System.currentTimeMillis();
				while (running) {
					PGNotification[] ns = pg.getNotifications(HEARTBEAT_MS / 2);
					// 잘못된 payload(수동 NOTIFY 등) 하나가 리스너 스레드를 죽이지 않도록 알림 단위로 격리
					if (ns != null) for (var n : ns) try { dispatch(n.getParameter()); } catch (RuntimeException e) { log.warn("notifier payload 무시: {}", n.getParameter(), e); }
					if (System.currentTimeMillis() - hb >= HEARTBEAT_MS) { toAll("hb", null); hb = System.currentTimeMillis(); }
				}
			} catch (SQLException e) {
				if (!running) return;
				log.warn("notifier 연결 끊김 — {}ms 뒤 재연결: {}", backoff, e.getMessage());
				try { Thread.sleep(backoff); } catch (InterruptedException ie) { return; }
				backoff = Math.min(backoff * 2, 30_000);
			}
		}
	}

	@SuppressWarnings("unchecked")
	private void dispatch(String json) {
		var p = (Map<String, Object>) Json.parse(json);
		var m = UUID.fromString((String) p.get("m"));
		var s = subs.get(m);
		if (s != null) send(m, s, (String) p.get("k"), json);
	}

	private void toAll(String kind, String data) { subs.forEach((m, s) -> send(m, s, kind, data)); }

	private void send(UUID m, Set<BiConsumer<String, String>> s, String kind, String data) {
		for (var sink : s) try { sink.accept(kind, data); } catch (RuntimeException e) { remove(m, sink); }
	}
}
