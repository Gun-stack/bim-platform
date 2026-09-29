# R2-1 실시간 푸시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 5초 폴링을 DB 트리거(`pg_notify`) → API 리스너 1개 → 모델별 SSE 팬아웃으로 바꿔 경보 반영 지연과 유휴 요청 수를 줄이고, 전후 수치를 README 에 남긴다

**Architecture:** `op_event` INSERT·`conversion_job` UPDATE 트리거가 채널 `bim` 에 `{m,k,g,s,p}` 를 NOTIFY. API 의 `Notifier`(SmartLifecycle, 가상 스레드, 풀 연결 하나 점유)가 `LISTEN bim` 후 모델별 구독자(`BiConsumer<kind, json>`)에게 전달. `StreamController` 가 SSE 어댑터, 변환 진행률 `/events` 도 같은 리스너 위로. 웹은 `stream.ts` 의 모델별 공유 `EventSource` + `useStream` 훅으로 기존 `reload()` 를 호출

**Tech Stack:** PostgreSQL 16 LISTEN/NOTIFY·plpgsql 트리거, Spring Boot 4 MVC `SseEmitter`, pgjdbc `PGConnection.getNotifications`, React 19 `EventSource`, vitest, puppeteer-core(측정)

**Spec:** `docs/superpowers/specs/2026-09-29-round2-tech-depth-design.md` (2~3절)

## Global Constraints

- Flyway V1~V7 수정 금지(체크섬). 새 마이그레이션은 `V8__notify.sql`
- 새 라이브러리 금지. `org.postgresql:postgresql` 을 `runtimeOnly` → `implementation` 으로 바꾸는 것만 허용(같은 아티팩트, `PGConnection` 컴파일용)
- 이벤트 이름: `status`·`work_order`·`job`·`resync` (+ 내부 `hb` = SSE 주석 하트비트). 트리거의 `lower(kind)` 와 일치
- 알림은 "다시 조회" 신호로만 쓴다 — 화면 부분 갱신 금지
- 커밋 메시지 접두 `api:`/`web:`/`docs:` + 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 커밋 금지 파일: `docs/learning/`, `docs/superpowers/specs/2026-09-07-virtual-building-expansion-review.md`
- 이 사내망에서는 컨테이너 안 gradle 빌드가 TLS 로 실패 → api 반영은 호스트 `./gradlew bootJar -x test` 후 `$SP/apijar`(Dockerfile `FROM bim-platform-api` + `COPY app.jar /app/app.jar`)로 이미지 교체, `docker compose up -d --no-build --force-recreate api`. web 은 `docker compose build web` 후 `up -d --no-build --force-recreate web`
- `$SP` = `/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad`

## 파일 구조

| 파일 | 책임 |
|---|---|
| `api/src/main/resources/db/migration/V8__notify.sql` (신규) | 트리거 함수 2개 + 트리거 2개 |
| `api/src/main/java/com/bim/api/Notifier.java` (신규) | LISTEN 루프·재연결·하트비트·모델별 팬아웃 |
| `api/src/main/java/com/bim/api/StreamController.java` (신규) | `GET /api/models/{id}/stream` SSE 어댑터 |
| `api/src/main/java/com/bim/api/ModelController.java` | `/events` 를 Notifier 위로 재구현 |
| `api/src/main/java/com/bim/api/OpEvents.java` · `StatusService.java` | 정전 전환을 `op_event` 로 적재 |
| `api/src/test/java/com/bim/api/NotifyTests.java` (신규) | 트리거 → Notifier → 구독자 |
| `web/src/stream.ts` (신규) · `stream.test.ts` | 공유 EventSource(참조 카운트)·디바운스·`useStream` |
| `web/src/useAlerts.tsx` · `MonitorPage.tsx` · `FmPage.tsx` | 폴링 → `useStream` |
| `$SP/latency.mjs` (저장소 밖) | 경보 지연·유휴 요청 수 측정 |

---

### Task 1: 기준선 측정 (변경 전)

**Files:**
- Create (저장소 밖): `$SP/latency.mjs`

**Interfaces:**
- Produces: `node $SP/latency.mjs <label>` → 표준출력 `latency avg/max ms`, `idle requests/min`

- [ ] **Step 1: 측정 스크립트 작성** — `$SP/latency.mjs`

```js
// 실시간 푸시 전후 측정 — node latency.mjs <label>   (컨테이너 5173 기준)
// ① 경보 지연: 모니터링 화면에서 PATCH ALARM → 행에 '경보'가 보일 때까지 (10회)
// ② 유휴 요청: 뷰어·모니터링·시설관리 세 탭을 60초 열어 둔 동안 /api 요청 수 (SSE 스트림 연결 자체는 제외)
import puppeteer from '/Users/hubilon_map/orca/projects/bim-platform/web/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const BASE = 'http://localhost:5173', API = 'http://localhost:8080/api', M = '32d1ef4f-d6b0-439d-9649-645e47e196b2'
const label = process.argv[2] ?? 'run', sleep = ms => new Promise(r => setTimeout(r, ms))
const status = await (await fetch(`${API}/models/${M}/status`)).json()
const target = status.find(r => r.status.Status === 'ALARM' && /감지기/.test(r.name ?? ''))   // 이미 경보 + 열린 작업지시가 있는 감지기 — 끝 상태가 시작과 같다
if (!target) throw new Error('경보 중인 감지기가 없다')
const patch = s => fetch(`${API}/models/${M}/elements/${encodeURIComponent(target.globalId)}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Status: s }) })
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'], defaultViewport: { width: 1500, height: 950 } })
const p = await b.newPage(); await p.goto(`${BASE}/#/models/${M}/monitor?mode=all`); await sleep(4000)
const shows = word => p.waitForFunction((g, w) => document.querySelector(`[data-gid="${CSS.escape(g)}"]`)?.textContent?.includes(w), { polling: 50, timeout: 15000 }, target.globalId, word)
const lat = []
for (let i = 0; i < 10; i++) {
  await patch('NORMAL'); await shows('정상'); await sleep(300)
  const t0 = Date.now(); await patch('ALARM'); await shows('경보'); lat.push(Date.now() - t0)
}
console.log(`[${label}] ${target.name} latency avg ${Math.round(lat.reduce((a, x) => a + x, 0) / lat.length)} ms · max ${Math.max(...lat)} ms · ${lat.join(',')}`)
await p.close()
const pages = await Promise.all([`#/models/${M}`, `#/models/${M}/monitor`, `#/models/${M}/fm`].map(async h => { const q = await b.newPage(); await q.goto(`${BASE}/${h}`); return q }))
await sleep(10000)   // 첫 로드 요청은 빼고
let n = 0; for (const q of pages) q.on('request', r => { if (r.url().includes('/api/') && !r.url().endsWith('/stream')) n++ })
await sleep(60000)
console.log(`[${label}] idle requests/min (3 pages) ${n}`)
await b.close()
```

- [ ] **Step 2: 기준선 실행**

Run: `node $SP/latency.mjs before`
Expected: 경보 지연 평균 약 2,500ms(0~5,000 분포), 유휴 요청 약 70회/분. 두 줄을 Task 5 README 표에 쓰기 위해 `$SP/r2-1-before.txt` 에 저장 (`node … | tee $SP/r2-1-before.txt`)

---

### Task 2: 트리거 + 정전 이벤트 + Notifier

**Files:**
- Create: `api/src/main/resources/db/migration/V8__notify.sql`, `api/src/main/java/com/bim/api/Notifier.java`, `api/src/test/java/com/bim/api/NotifyTests.java`
- Modify: `api/build.gradle` (postgresql `implementation`), `api/src/main/java/com/bim/api/OpEvents.java`, `api/src/main/java/com/bim/api/StatusService.java` (`power`)

**Interfaces:**
- Produces: `Notifier.subscribe(UUID model, BiConsumer<String, String> sink): Runnable`(반환 = 해제), `Notifier.subscribers(): int`, `Notifier.HEARTBEAT_MS = 20_000`. 전달 kind = `status`·`work_order`·`job`·`resync`·`hb`(data null)
- Produces: `OpEvents.power(JdbcClient, UUID, String source)`

- [ ] **Step 1: 실패하는 테스트** — `NotifyTests.java`

```java
package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 실시간 푸시: DB 트리거 pg_notify → Notifier(LISTEN) → 그 모델 구독자에게만. 정전 전환도 op_event 로 남아 알림이 간다 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class NotifyTests {
	@Autowired JdbcClient db;
	@Autowired Notifier notifier;
	@Autowired StatusService status;

	UUID mid, other;
	final BlockingQueue<String[]> got = new LinkedBlockingQueue<>();
	Runnable off;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		mid = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		other = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'o', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		db.sql("INSERT INTO element (model_id, global_id, ifc_class, name) VALUES (:m, 'ATS', 'IfcSwitchingDevice', 'ATS'), (:m, 'EG-1', 'IfcElectricGenerator', 'EG-1')").param("m", mid).update();
		off = notifier.subscribe(mid, (k, d) -> got.add(new String[] { k, d }));
	}

	@AfterEach
	void unsubscribe() { off.run(); }

	/** kind 가 올 때까지 다른 종류(hb 등)는 건너뛴다. 5초 안에 안 오면 실패 */
	@SuppressWarnings("unchecked")
	Map<String, Object> next(String kind) throws InterruptedException {
		for (;;) {
			var e = got.poll(5, TimeUnit.SECONDS);
			assertThat(e).as("'%s' 이벤트", kind).isNotNull();
			if (e[0].equals(kind)) return (Map<String, Object>) Json.parse(e[1]);
		}
	}

	@Test
	void opEventGoesOnlyToThatModelsSubscribers() throws InterruptedException {
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status) VALUES (:m, 'STATUS', 'X', 'ALARM')").param("m", other).update();
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status) VALUES (:m, 'STATUS', 'SD', 'ALARM')").param("m", mid).update();
		var e = next("status");
		assertThat(e.get("g")).isEqualTo("SD");   // 다른 모델의 X 는 오지 않았다
		assertThat(e.get("s")).isEqualTo("ALARM");
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status, wo_title) VALUES (:m, 'WORK_ORDER', 'SD', 'OPEN', 't')").param("m", mid).update();
		assertThat(next("work_order").get("s")).isEqualTo("OPEN");
	}

	@Test
	void conversionProgressNotifies() throws InterruptedException {
		long job = db.sql("INSERT INTO conversion_job (model_id) VALUES (:m) RETURNING id").param("m", mid).query(Long.class).single();
		db.sql("UPDATE conversion_job SET progress = 40 WHERE id = :j").param("j", job).update();
		assertThat(((Number) next("job").get("p")).intValue()).isEqualTo(40);
	}

	@Test
	void powerSwitchIsRecordedAndNotified() throws InterruptedException {
		status.power(mid, "GENERATOR");
		assertThat(next("status").get("g")).isIn("ATS", "EG-1");
		assertThat(db.sql("SELECT count(*) FROM op_event WHERE model_id = :m AND global_id = 'ATS' AND status = 'TRANSFERRED'").param("m", mid).query(Long.class).single()).isEqualTo(1);
	}
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test --tests 'com.bim.api.NotifyTests' -q`
Expected: 컴파일 실패 — `Notifier` 없음

- [ ] **Step 3: V8 마이그레이션** — `V8__notify.sql`

```sql
-- 실시간 푸시(R2-1): 운영 이벤트·변환 진행률을 NOTIFY 로. API 의 Notifier 가 LISTEN bim → 모델별 SSE 로 팬아웃.
-- 트리거인 이유: 워커(Python)가 conversion_job 을 직접 갱신 — API 에서만 발행하면 진행률이 빠진다. NOTIFY 는 커밋 때만 전달.
CREATE FUNCTION notify_op_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', lower(NEW.kind), 'g', NEW.global_id, 's', NEW.status)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER op_event_notify AFTER INSERT ON op_event FOR EACH ROW EXECUTE FUNCTION notify_op_event();

CREATE FUNCTION notify_conversion_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', 'job', 's', NEW.status, 'p', NEW.progress)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER conversion_job_notify AFTER UPDATE OF status, progress ON conversion_job FOR EACH ROW EXECUTE FUNCTION notify_conversion_job();
```

- [ ] **Step 4: `build.gradle`** — `runtimeOnly 'org.postgresql:postgresql'` → `implementation 'org.postgresql:postgresql'   // PGConnection.getNotifications (Notifier)`

- [ ] **Step 5: `Notifier.java`**

```java
package com.bim.api;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
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

	Notifier(DataSource ds) { this.ds = ds; }

	/** 구독. 반환된 Runnable 을 실행하면 해제 */
	Runnable subscribe(UUID model, BiConsumer<String, String> sink) {
		subs.computeIfAbsent(model, k -> ConcurrentHashMap.newKeySet()).add(sink);
		return () -> { var s = subs.get(model); if (s != null) s.remove(sink); };
	}

	int subscribers() { return subs.values().stream().mapToInt(Set::size).sum(); }

	@Override public void start() { running = true; thread = Thread.ofVirtual().name("notifier").start(this::loop); }
	@Override public void stop() { running = false; if (thread != null) thread.interrupt(); }
	@Override public boolean isRunning() { return running; }

	private void loop() {
		long backoff = 1000; boolean first = true;
		while (running) {
			try (Connection c = ds.getConnection()) {   // 풀에서 하나를 계속 점유 — LISTEN 은 연결 단위
				try (var st = c.createStatement()) { st.execute("LISTEN bim"); }
				if (!first) toAll("resync", "{}");
				first = false; backoff = 1000;
				PGConnection pg = c.unwrap(PGConnection.class);
				long hb = System.currentTimeMillis();
				while (running) {
					PGNotification[] ns = pg.getNotifications(HEARTBEAT_MS / 2);
					if (ns != null) for (var n : ns) dispatch(n.getParameter());
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
		var s = subs.get(UUID.fromString((String) p.get("m")));
		if (s != null) send(s, (String) p.get("k"), json);
	}

	private void toAll(String kind, String data) { subs.values().forEach(s -> send(s, kind, data)); }

	private static void send(Set<BiConsumer<String, String>> s, String kind, String data) {
		for (var sink : s) try { sink.accept(kind, data); } catch (RuntimeException e) { s.remove(sink); }
	}
}
```

- [ ] **Step 6: 정전 전환 적재** — `OpEvents.java` 에 추가:

```java
	/** 정전 전환(ATS·발전기) 직후 — 요소를 직접 UPDATE 하던 경로라 이력도 알림도 없었다 */
	static void power(JdbcClient db, UUID modelId, String source) {
		db.sql("""
			INSERT INTO op_event (model_id, kind, global_id, status, data)
			SELECT :m, 'STATUS', global_id, properties->'Pset_BimStatus'->>'Status', jsonb_build_object('Source', :s)
			  FROM element WHERE model_id = :m AND ifc_class IN ('IfcSwitchingDevice', 'IfcElectricGenerator')""")
			.param("m", modelId).param("s", source).update();
	}
```
`StatusService.power` 의 두 `set(...)` 줄 다음에 `OpEvents.power(db, id, source);`

- [ ] **Step 7: 테스트 통과 + 전체 회귀**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test -q; for f in build/test-results/test/*.xml; do grep -o 'testsuite name="[^"]*" tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' $f; done`
Expected: `NotifyTests` 3개 포함 전부 failures=0 errors=0 (기존 18 + 3 = 21)

- [ ] **Step 8: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add api/build.gradle api/src/main/resources/db/migration/V8__notify.sql api/src/main/java/com/bim/api/Notifier.java api/src/main/java/com/bim/api/OpEvents.java api/src/main/java/com/bim/api/StatusService.java api/src/test/java/com/bim/api/NotifyTests.java && git commit -m "api: 실시간 푸시 원천 — op_event·conversion_job 트리거 pg_notify, Notifier(LISTEN·재연결·하트비트·모델별 팬아웃), 정전 전환 op_event 적재

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: SSE 엔드포인트 + 변환 진행률 재구현

**Files:**
- Create: `api/src/main/java/com/bim/api/StreamController.java`
- Modify: `api/src/main/java/com/bim/api/ModelController.java` (생성자·`events`)

**Interfaces:**
- Consumes: Task 2 `Notifier.subscribe`
- Produces: `GET /api/models/{id}/stream` — `text/event-stream`, 이벤트 `status`·`work_order`·`job`·`resync`(data = 트리거 JSON), 주석 `:ready`(연결 직후)·`:hb`(20초)

- [ ] **Step 1: `StreamController.java`**

```java
package com.bim.api;

import java.io.IOException;
import java.io.UncheckedIOException;
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
		Runnable off = notifier.subscribe(id, (kind, data) -> {
			try { em.send(kind.equals("hb") ? SseEmitter.event().comment("hb") : SseEmitter.event().name(kind).data(data, MediaType.APPLICATION_JSON)); }
			catch (IOException e) { throw new UncheckedIOException(e); }   // Notifier 가 이 구독을 해제
		});
		em.onCompletion(off); em.onTimeout(off); em.onError(t -> off.run());
		em.send(SseEmitter.event().comment("ready"));   // 헤더를 바로 내보내 EventSource open 이 즉시 뜨게
		return em;
	}
}
```

- [ ] **Step 2: `ModelController` 에 Notifier 주입** — 필드 `private final Notifier notifier;`, 생성자 매개변수 끝에 `Notifier notifier` 추가하고 `this.notifier = notifier;`

- [ ] **Step 3: `events` 교체** (import `java.io.UncheckedIOException` 추가)

```java
	/** 변환 진행률 SSE: 첫 스냅샷 + conversion_job 알림마다 모델 행 1회 조회. 종료 상태면 닫는다 — 구독자마다 1초 DB 폴링하던 것을 Notifier 하나로 */
	@GetMapping("/models/{id}/events")
	SseEmitter events(@PathVariable UUID id) throws IOException {
		var emitter = new SseEmitter(0L);
		var m = find(id);
		emitter.send(SseEmitter.event().name("status").data(m));
		if (DONE.contains((String) m.get("status"))) { emitter.complete(); return emitter; }
		Runnable[] off = { () -> {} };
		off[0] = notifier.subscribe(id, (kind, data) -> {
			try {
				if (kind.equals("hb")) { emitter.send(SseEmitter.event().comment("hb")); return; }
				if (!kind.equals("job") && !kind.equals("resync")) return;
				var now = find(id);
				emitter.send(SseEmitter.event().name("status").data(now));
				if (DONE.contains((String) now.get("status"))) { off[0].run(); emitter.complete(); }
			} catch (IOException e) { throw new UncheckedIOException(e); }
			catch (RuntimeException e) { emitter.completeWithError(e); throw e; }   // 모델 삭제 등
		});
		emitter.onCompletion(off[0]); emitter.onTimeout(off[0]); emitter.onError(t -> off[0].run());
		var again = find(id);   // 첫 조회와 구독 사이에 끝났으면 알림이 다시 오지 않는다
		if (DONE.contains((String) again.get("status"))) { emitter.send(SseEmitter.event().name("status").data(again)); off[0].run(); emitter.complete(); }
		return emitter;
	}
```

- [ ] **Step 4: 빌드·전체 테스트**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test -q; for f in build/test-results/test/*.xml; do grep -o 'tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' $f; done | sort | uniq -c`
Expected: 전부 failures=0 errors=0

- [ ] **Step 5: 라이브 확인** (jar 교체 배포 — Global Constraints)

Run:
```bash
cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew bootJar -x test -q && cp build/libs/api-0.0.1-SNAPSHOT.jar $SP/apijar/app.jar && docker build -q -t bim-platform-api $SP/apijar && cd .. && docker compose up -d --no-build --force-recreate api && for i in $(seq 1 60); do curl -sf localhost:8080/api/projects >/dev/null && break; sleep 2; done
(curl -sN --max-time 6 localhost:5173/api/models/32d1ef4f-d6b0-439d-9649-645e47e196b2/stream &) ; sleep 1; curl -s -X POST 'localhost:8080/api/models/32d1ef4f-d6b0-439d-9649-645e47e196b2/power?source=UTILITY' -o /dev/null; sleep 5
```
Expected: 스트림 출력에 `:ready` 뒤 `event:status` 와 ATS·발전기 `data:{"m" : …}` 두 줄 (nginx 경유 — 버퍼링 없이 즉시)

- [ ] **Step 6: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add api/src/main/java/com/bim/api/StreamController.java api/src/main/java/com/bim/api/ModelController.java && git commit -m "api: GET /models/{id}/stream SSE, 변환 진행률 /events 를 Notifier 위로 — 구독자별 1초 DB 폴링 제거

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 웹 — 공유 스트림과 useStream

**Files:**
- Create: `web/src/stream.ts`, `web/src/stream.test.ts`
- Modify: `web/src/useAlerts.tsx`, `web/src/MonitorPage.tsx`, `web/src/FmPage.tsx`

**Interfaces:**
- Consumes: Task 3 `/api/models/{id}/stream`
- Produces: `subscribe(modelId, fn: (kind: string) => void, make?: (url: string) => EventSourceLike): () => void`, `debounce(fn, ms): () => void`, `useStream(modelId, kinds: string[], fn: () => void)`

- [ ] **Step 1: 실패하는 테스트** — `web/src/stream.test.ts`

```ts
import { describe, expect, it, vi } from 'vitest'
import { debounce, subscribe } from './stream'

/** 가짜 EventSource — 이름별 리스너, open/close 기록 */
class FakeES {
  static made: FakeES[] = []
  url: string; closed = false; onopen: (() => void) | null = null
  private ls = new Map<string, (() => void)[]>()
  constructor(url: string) { this.url = url; FakeES.made.push(this) }
  addEventListener(k: string, f: () => void) { this.ls.set(k, [...(this.ls.get(k) ?? []), f]) }
  emit(k: string) { this.ls.get(k)?.forEach(f => f()) }
  close() { this.closed = true }
}
const make = (u: string) => new FakeES(u)

describe('subscribe — 모델별 EventSource 하나를 공유', () => {
  it('같은 모델 구독자 둘은 연결 1개, 마지막 해제 때 닫힌다', () => {
    FakeES.made = []
    const a: string[] = [], b: string[] = []
    const offA = subscribe('m1', k => a.push(k), make), offB = subscribe('m1', k => b.push(k), make)
    expect(FakeES.made).toHaveLength(1); expect(FakeES.made[0].url).toBe('/api/models/m1/stream')
    FakeES.made[0].emit('status')
    expect(a).toEqual(['status']); expect(b).toEqual(['status'])
    offA(); expect(FakeES.made[0].closed).toBe(false)
    offB(); expect(FakeES.made[0].closed).toBe(true)
  })
  it('첫 open 은 무시하고, 재연결(두 번째 open)은 resync 로 알린다', () => {
    FakeES.made = []
    const got: string[] = []
    const off = subscribe('m2', k => got.push(k), make)
    FakeES.made[0].onopen?.(); FakeES.made[0].onopen?.()
    expect(got).toEqual(['resync'])
    off()
  })
})

describe('debounce', () => {
  it('연속 호출은 마지막 한 번만', () => {
    vi.useFakeTimers()
    const f = vi.fn(), d = debounce(f, 300)
    d(); d(); d(); vi.advanceTimersByTime(299); expect(f).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(f).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npx vitest run src/stream.test.ts`
Expected: FAIL — `Cannot find module './stream'`

- [ ] **Step 3: `web/src/stream.ts`**

```ts
import { useEffect, useRef } from 'react'

/** 서버 푸시 — GET /api/models/{id}/stream (SSE). 이벤트는 '다시 조회' 신호로만 쓴다(R2-1) */
type EventSourceLike = { addEventListener(k: string, f: () => void): void; close(): void; onopen: (() => void) | null }
type Fn = (kind: string) => void
const KINDS = ['status', 'work_order', 'job', 'resync']
const shared = new Map<string, { es: EventSourceLike; fns: Set<Fn> }>()

/** 모델별 EventSource 하나를 페이지 안에서 공유(참조 카운트) — 구독자가 0 이 되면 닫는다. 브라우저가 끊기면 알아서 재연결하고, 두 번째 open 부터는 resync 로 알린다(놓친 이벤트 보정) */
export function subscribe(modelId: string, fn: Fn, make: (url: string) => EventSourceLike = u => new EventSource(u)): () => void {
  let s = shared.get(modelId)
  if (!s) {
    const es = make(`/api/models/${modelId}/stream`), fns = new Set<Fn>()
    for (const k of KINDS) es.addEventListener(k, () => fns.forEach(f => f(k)))
    let opened = false
    es.onopen = () => { if (opened) fns.forEach(f => f('resync')); opened = true }
    s = { es, fns }; shared.set(modelId, s)
  }
  const entry = s
  entry.fns.add(fn)
  return () => { entry.fns.delete(fn); if (!entry.fns.size) { entry.es.close(); shared.delete(modelId) } }
}

export const debounce = (fn: () => void, ms: number) => { let t: ReturnType<typeof setTimeout> | undefined; return () => { clearTimeout(t); t = setTimeout(fn, ms) } }

/** kinds 이벤트(+resync)마다 300ms 디바운스 후 fn. 60초 안전망 폴링 — SSE 를 막는 프록시 대비 */
export function useStream(modelId: string, kinds: string[], fn: () => void) {
  const ref = useRef(fn); ref.current = fn
  const key = kinds.join()
  useEffect(() => {
    const run = debounce(() => ref.current(), 300), want = new Set([...key.split(','), 'resync'])
    const off = subscribe(modelId, k => { if (want.has(k)) run() })
    const t = setInterval(() => ref.current(), 60_000)
    return () => { off(); clearInterval(t) }
  }, [modelId, key])
}
```

- [ ] **Step 4: 테스트 통과**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npx vitest run src/stream.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 적용**
  - `useAlerts.tsx`: import `useStream` from `./stream`. 폴링 effect 를 `useEffect(() => { prev.current = null; setFresh([]); reload() }, [reload])` 로 바꾸고 바로 아래 `useStream(modelId, ['status'], reload)`. 주석 "상태 5초 폴링" → "상태 구독(서버 푸시, 60초 안전망)"
  - `MonitorPage.tsx`: `useEffect(() => { api<Model>(…).then(setModel); load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [modelId, load])` → `useEffect(() => { api<Model>(`/models/${modelId}`).then(setModel); load() }, [modelId, load])` + `useStream(modelId, ['status', 'work_order'], load)`. 헤더 `갱신 {hms(tick)} · 5초` → `갱신 {hms(tick)} · 실시간`, 파일 머리 주석 "5초 자동 갱신" → "서버 푸시로 갱신"
  - `FmPage.tsx`: `reload` 선언 다음에 `useStream(modelId, ['work_order'], reload)` — 경보가 만든 작업지시가 칸반에 바로 뜬다

- [ ] **Step 6: 빌드·테스트·린트**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npm run build && npm test && npm run lint`
Expected: 0오류, 전부 PASS(50), 0경고

- [ ] **Step 7: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add web/src/stream.ts web/src/stream.test.ts web/src/useAlerts.tsx web/src/MonitorPage.tsx web/src/FmPage.tsx && git commit -m "web: 5초 폴링 → 서버 푸시 구독(useStream) — 모델별 EventSource 공유, 재연결 resync, 60초 안전망

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 배포·측정(후)·문서

**Files:**
- Modify: `README.md` (규모 측정 절, 아키텍처/설계 결정 불릿), `docs/screen-design.md` (모니터링 "5초 갱신" 표현)

- [ ] **Step 1: web 컨테이너 반영**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform && docker compose build web && docker compose up -d --no-build --force-recreate web`

- [ ] **Step 2: 측정(후)**

Run: `node $SP/latency.mjs after | tee $SP/r2-1-after.txt`
Expected: 경보 지연 평균 < 500ms, 유휴 요청 < 10회/분 (안전망 60초 폴링 3회 + 알림으로 인한 재조회). 미달이면 원인(디바운스·nginx 버퍼링·트리거 누락)을 찾아 고친 뒤 재측정

- [ ] **Step 3: README**
  - "규모 측정" 절에 표 추가:

```markdown
| 실시간 푸시 (R2-1) | 폴링(5초) | 푸시(LISTEN/NOTIFY → SSE) |
|---|---|---|
| 경보 반영 지연 (10회 평균 · 최대) | {before avg} ms · {before max} ms | {after avg} ms · {after max} ms |
| 유휴 API 요청 (3화면 · 1분) | {before n} | {after n} |
```
  (중괄호는 `$SP/r2-1-before.txt`·`after.txt` 실측값으로 치환)
  - 아키텍처 절 불릿 한 줄: `- 실시간 푸시: DB 트리거 pg_notify → API Notifier(LISTEN 하나) → 모델별 SSE. 워커가 쓰는 변환 진행률도 같은 경로`
- [ ] **Step 4: screen-design.md** — "5초 갱신"·"5초 폴링" 표현을 "서버 푸시(SSE, 60초 안전망)" 로 (`grep -n '5초' docs/screen-design.md` 로 찾아 모두)

- [ ] **Step 5: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add README.md docs/screen-design.md && git commit -m "docs: 실시간 푸시 전후 수치(경보 지연·유휴 요청)와 구조

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
