# R2-3 관측성·부하 측정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** R2-1(실시간 푸시)·R2-2(3D Tiles)가 만든 구조를 지표로 보이고, "상태 이벤트 초당 R건 × SSE 구독자 M개에서 PATCH p95·이벤트 지연 p95·누락·API CPU" 를 세 시나리오로 재서 README 에 남긴다

**Architecture:** api 에 `micrometer-registry-prometheus` 를 더해 `/actuator/prometheus`(compose 내부망·호스트 127.0.0.1 만, nginx 는 404)를 연다. Flyway V10 이 알림 트리거 함수 3개를 `CREATE OR REPLACE` 해 payload 에 트리거 시각 `t`(ms)를 싣고, `Notifier` 가 구독자 게이지·종류별 알림 카운터·`t`→dispatch 지연 타이머를 기록한다. compose profile `obs` 의 Prometheus(5초 수집)·Grafana(익명 보기, 9패널 프로비저닝)가 대시보드. `load/` 의 k6(compose 망 → api:8080 직접)가 열린 작업지시가 있는 감지기에 상태 PATCH 를 초당 R건 쏘고, Node 워커 스레드들이 SSE 구독자 M개로 종단 지연·누락을 모으며, `run.sh` 가 한 판을 돌리고 요소 상태·이벤트를 시작 시점으로 되돌린다. R2-1 보류 두 건(SSE 404 고정 재시도·Notifier 종료 WARN)을 함께 정리

**Tech Stack:** Spring Boot 4.1 Actuator + Micrometer(Prometheus 레지스트리), PostgreSQL 16 plpgsql(Flyway V10), Prometheus v3.15.0, Grafana 13.2.3, k6 2.3.0(`grafana/k6` 이미지), Node 22 표준 fetch·worker_threads·`node:test`, vitest, puppeteer-core(촬영)

**Spec:** `docs/superpowers/specs/2026-09-30-r2-3-observability-design.md`

## Global Constraints

- 선행: R2-2(`feat/r2-2-tiles`)가 main 에 병합된 뒤 main 에서 브랜치 `feat/r2-3-obs`. V9(`notify_model_status` 함수·`model_status_notify` 트리거)와 `NotifyTests.modelStatusChangeNotifies` 가 main 에 있어야 한다(Task 1 Step 0)
- Flyway V1~V9 수정 금지(체크섬 — 주석도). 새 마이그레이션은 `V10__notify_time.sql` 하나
- 의존성: gradle `io.micrometer:micrometer-registry-prometheus`(Boot 관리 버전, 버전 표기 없음) 하나만. npm·pip 추가 금지. `load/` 는 Node 22 표준 모듈 + k6 이미지
- 도커 이미지(계획 작성 중 pull·실행 확인): `prom/prometheus:v3.15.0`, `grafana/grafana:13.2.3`, `grafana/k6:2.3.0`. pull 이 실패하면 그 단계를 보고하고 멈춘다(스펙 7절) — 다른 태그로 임의 대체 금지
- 이 사내망은 TLS 가로채기로 컨테이너 안 gradle·pip 다운로드가 실패한다(호스트 gradle 다운로드는 됨 — `micrometer-registry-prometheus` 확인)
  - api 배포: 호스트 `./gradlew bootJar -x test` → `$SP/apijar/app.jar` 복사 → `docker build -q -t bim-platform-api $SP/apijar`(이미 있는 Dockerfile, app.jar 만 교체) → `docker compose up -d --no-build --force-recreate api` → 헬스 대기 루프(재기동 직후 curl 은 빈 응답)
  - web 배포: `docker compose build web` → `docker compose up -d --no-build --force-recreate web`
- `$SP` = `/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad` — 셸 상태가 이어지지 않으므로 `$SP` 를 쓰는 명령은 앞에 `SP=…;` 를 붙여 실행
- 모든 명령은 절대 경로(cwd 가 호출마다 초기화). `docker compose`·`load/run.sh` 는 `cd /Users/hubilon_map/orca/projects/bim-platform && …`
- GlobalId 는 `$` 를 품는다 → 명령줄에 직접 쓰지 않는다(zsh 전개). 스크립트가 API 로 찾는다
- 부하는 api:8080 직접 — k6 는 compose 망(`bim-platform_default`, run.sh 가 api 컨테이너에서 찾음) 안에서 `http://api:8080`, SSE 구독자는 호스트에서 `http://localhost:8080`. 5173(nginx, IP 당 20r/s)은 쓰지 않는다
- 데모 데이터 위생: 부하 대상 = 열린 작업지시가 있는 감지기(경보가 새 작업지시를 만들지 않고 재사용). `run.sh` 가 시작 전 요소 상태를 떠 두고 끝나면(중단돼도) 그대로 복원 + 그 사이 STATUS 이벤트 삭제. 부하 중 BMS 시뮬레이터(`sim`, profile demo)는 정지
- 호스트 도구: node 22(v22.22), jq(`/usr/bin/jq`), psql(`/opt/homebrew/bin/psql` — Task 5 시계 확인에만)
- 커밋 메시지 접두 `api:`/`web:`/`obs:`/`load:`/`docs:` + 한국어, 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. `git add` 는 파일을 명시
- 커밋 금지: `docs/learning/`, `docs/superpowers/specs/2026-09-07-virtual-building-expansion-review.md`
- web: `tsconfig.app.json` strict·`erasableSyntaxOnly`, `npm run lint` = oxlint `--deny-warnings` 0경고
- 헤드리스: `web/node_modules/puppeteer-core`, Chrome `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, `--use-angle=metal`
- 모델: mep-building `32d1ef4f-d6b0-439d-9649-645e47e196b2`(1,613 요소, 열린 작업지시가 있는 감지기 14개 — 계획 작성 시점)
- 테스트 개수는 작성 시점 기준(API 25 → 26, 웹은 R2-2 병합 후 개수) — "현재 개수 + 새 테스트 수" 로 판정

## 지표·계약 (모든 태스크 공통)

| 이름 | 종류 | 뜻 | 만드는 곳 → 쓰는 곳 |
|---|---|---|---|
| payload `t` | 알림 JSON 필드(bigint ms) | 트리거 실행 시각 `clock_timestamp()` | V10 → `Notifier`·`sse-clients.mjs`. 웹은 무시 |
| `bim_sse_subscribers` | 게이지 | `Notifier.subscribers()` — SSE 스트림 + 변환 진행률 | Task 1 → 대시보드·`run.sh subs()` |
| `bim_notify_events_total{kind}` | 카운터 | dispatch 한 알림 수(`status`·`work_order`·`job`) | Task 1 → 대시보드 |
| `bim_notify_lag_seconds_bucket/_count/_sum/_max` | 타이머(히스토그램) | `t` → Notifier dispatch | Task 1 → 대시보드·`sse-clients.mjs`(서버 지연 p95) |
| `http_server_requests_seconds_bucket{method,uri,…}` | 히스토그램 | 요청 시간 — p50·p95·p99 는 `histogram_quantile` | Task 1 설정 → 대시보드 |
| `hikaricp_connections_{active,pending,max}`·`jvm_threads_live_threads`·`jvm_memory_{used,max}_bytes`·`process_cpu_time_ns_total`·`system_cpu_count` | Boot 기본 | DB 풀·JVM·CPU | → 대시보드·`sse-clients.mjs` |
| Prometheus job `api` | 수집 대상 | `api:8080/actuator/prometheus`, 5초 | Task 2 |
| Grafana 데이터소스 uid `prom`, 대시보드 uid `bim-api`(제목 BIM API) | 프로비저닝 | 9패널 | Task 2 → 촬영 |
| 표 한 행 | `run.sh` stdout | `\| R (달성) \| M \| PATCH p95 ms \| 실패 % \| 종단 p50 · p95 · p99 ms \| 서버 지연 p95 ms \| 누락 % \| API CPU 코어 \| DB 풀 대기 \|` | Task 3 → README |

## 파일 구조

| 파일 | 책임 |
|---|---|
| `api/build.gradle` | `micrometer-registry-prometheus` |
| `api/src/main/resources/application.yml` | 노출 `health,prometheus`, `http.server.requests` 히스토그램 |
| `api/src/main/resources/db/migration/V10__notify_time.sql` (신규) | 알림 함수 3개 `CREATE OR REPLACE` + `t` |
| `api/src/main/java/com/bim/api/Notifier.java` | 지표 3종(Task 1), 1초 대기 루프·종료 join(Task 4) |
| `api/src/test/java/com/bim/api/NotifyTests.java` | `t`·지표 검증 |
| `compose.yaml` | profile `obs`: `prometheus`·`grafana` |
| `obs/prometheus.yml` (신규) | 수집 설정 |
| `obs/grafana/datasources/prometheus.yml` · `obs/grafana/dashboards/bim.yml` · `obs/grafana/dashboards/bim.json` (신규) | 데이터소스·대시보드 프로비저닝 |
| `load/sse-clients.mjs` · `load/sse-clients.test.mjs` (신규) | SSE 구독자 워커·지연 히스토그램·표 한 행 / `node:test` |
| `load/status-burst.js` (신규) | k6 상태 PATCH(constant-arrival-rate) |
| `load/run.sh` (신규, 실행 권한) | 한 판 조율·스냅숏 되돌리기·구독 정리 대기 |
| `web/src/stream.ts` · `stream.test.ts` | 영구 종료 재시도 지수 백오프 |
| `README.md` · `docs/screen-design.md` · `images/15-grafana.png` · 스펙 | 부하 표·관측성 실행·화면·파일 지도·구현 결정 |
| `$SP/backoff-check.mjs` · `$SP/grafana-shot.mjs` · `$SP/r2-3-*.txt` (저장소 밖) | 404 재시도 확인·대시보드 촬영·측정 기록 |

순서: Task 1 → Task 2(1 의 지표) → Task 3(1 의 `t`·2 의 Prometheus) → Task 4 → Task 5(전부 배포된 상태에서 측정)

---

### Task 1: api — Prometheus 노출·알림 시각 `t`·Notifier 지표

**Files:**
- Create: `api/src/main/resources/db/migration/V10__notify_time.sql`
- Modify: `api/build.gradle`, `api/src/main/resources/application.yml`, `api/src/main/java/com/bim/api/Notifier.java`, `api/src/test/java/com/bim/api/NotifyTests.java`

**Interfaces:**
- Consumes: V8 `notify_op_event()`·`notify_conversion_job()`, V9 `notify_model_status()`(R2-2)
- Produces: 알림 payload `{m,k,g,s,p?,t}` — `t` = `(extract(epoch FROM clock_timestamp()) * 1000)::bigint`
- Produces: `Notifier(DataSource ds, MeterRegistry meters)`, 지표 `bim.sse.subscribers`·`bim.notify.events{kind}`·`bim.notify.lag`(Prometheus 이름은 위 표)
- Produces: `GET /actuator/prometheus` (api:8080·호스트 127.0.0.1:8080, 5173 은 404)

- [ ] **Step 0: 선행 확인·브랜치**

Run:
```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git switch main && git log --oneline -1 && grep -n "FUNCTION notify_model_status\|json_build_object" api/src/main/resources/db/migration/V9__tileset.sql && grep -n "void modelStatusChangeNotifies" api/src/test/java/com/bim/api/NotifyTests.java && git switch -c feat/r2-3-obs
```
Expected: V9 에 `CREATE FUNCTION notify_model_status() RETURNS trigger …` 와 `PERFORM pg_notify('bim', json_build_object('m', NEW.id, 'k', 'job', 's', NEW.status)::text);`, NotifyTests 에 `modelStatusChangeNotifies`. V9 함수 본문이 이와 다르면(R2-2 리뷰에서 바뀜) Step 5 의 세 번째 함수는 **V9 본문을 그대로 옮기고 `json_build_object` 끝에 `'t', …` 만 더한다**

- [ ] **Step 1: 실패하는 테스트** — `NotifyTests.java` 네 곳

① import — 기존:
```java
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
```
교체:
```java
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import io.micrometer.core.instrument.MeterRegistry;
import java.util.Map;
```

② 필드 — 기존:
```java
	@Autowired StreamController stream;
```
교체:
```java
	@Autowired StreamController stream;
	@Autowired MeterRegistry meters;
```

③ 진행률·모델 상태 알림에 `t` — 기존:
```java
		assertThat(((Number) next("job").get("p")).intValue()).isEqualTo(40);
```
교체:
```java
		var e = next("job");
		assertThat(((Number) e.get("p")).intValue()).isEqualTo(40);
		assertThat(e.get("t")).isInstanceOf(Number.class);   // V10 — 진행률 알림도 트리거 시각
```
기존:
```java
		assertThat(next("job").get("s")).isEqualTo("PROCESSING");
```
교체:
```java
		var e = next("job");
		assertThat(e.get("s")).isEqualTo("PROCESSING");
		assertThat(e.get("t")).isInstanceOf(Number.class);   // V10
```

④ 클래스 끝(`unknownModelStreamIs404` 다음, 마지막 `}` 앞)에 추가:
```java

	/** R2-3: payload 에 트리거 시각 t(ms), 알림마다 종류별 카운터·지연 타이머, 구독자 게이지. 다른 테스트의 늦은 알림이 섞일 수 있어 '이상'으로 본다 */
	@Test
	void payloadCarriesTriggerTimeAndMetersRecord() throws InterruptedException {
		var c = meters.find("bim.notify.events").tag("kind", "status").counter();
		double before = c == null ? 0 : c.count();
		long lagBefore = meters.get("bim.notify.lag").timer().count();
		db.sql("INSERT INTO op_event (model_id, kind, global_id, status) VALUES (:m, 'STATUS', 'SD', 'ALARM')").param("m", mid).update();
		var e = next("status");
		assertThat(((Number) e.get("t")).longValue()).isCloseTo(System.currentTimeMillis(), within(5_000L));   // DB 컨테이너 시계 ≈ 호스트
		assertThat(meters.get("bim.notify.events").tag("kind", "status").counter().count()).isGreaterThanOrEqualTo(before + 1);
		assertThat(meters.get("bim.notify.lag").timer().count()).isGreaterThanOrEqualTo(lagBefore + 1);
		assertThat(meters.get("bim.sse.subscribers").gauge().value()).isGreaterThanOrEqualTo(1);   // seed() 의 구독
	}
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test --tests 'com.bim.api.NotifyTests' -q; grep -o '<failure message="[^"]\{0,90\}' build/test-results/test/TEST-com.bim.api.NotifyTests.xml`
Expected: FAIL 3건 — `conversionProgressNotifies`·`modelStatusChangeNotifies` 는 `Expecting actual not to be null`(`t` 없음), `payloadCarriesTriggerTimeAndMetersRecord` 는 `MeterNotFoundException`(계획 작성 중 같은 결과 확인)

- [ ] **Step 3: `build.gradle`** — 기존:
```groovy
	implementation 'org.springframework.boot:spring-boot-starter-actuator'
```
교체:
```groovy
	implementation 'org.springframework.boot:spring-boot-starter-actuator'
	implementation 'io.micrometer:micrometer-registry-prometheus'   // GET /actuator/prometheus (R2-3) — compose 내부망에서만 수집
```

- [ ] **Step 4: `application.yml`** — 기존:
```yaml
management.endpoints.web.exposure.include: health
```
교체:
```yaml
management.endpoints.web.exposure.include: health,prometheus   # 외부에선 nginx 가 /actuator/ 를 404 — Prometheus 는 compose 내부망 api:8080 에서 수집
"management.metrics.distribution.percentiles-histogram[http.server.requests]": true   # p50·p95·p99 는 Prometheus histogram_quantile 로(엔드포인트별·구간별 합산 가능)
```

- [ ] **Step 5: V10 마이그레이션** — `V10__notify_time.sql`

```sql
-- 관측성(R2-3): 알림 payload 에 발생 시각 t(ms epoch). clock_timestamp() = 트랜잭션 시작(now())이 아닌 실제 트리거 시각.
-- Notifier 가 dispatch 시각과의 차이를 bim_notify_lag_seconds 로, 부하 스크립트(load/sse-clients.mjs)가 수신 시각과의 차이를 종단 지연으로 잰다.
-- V8·V9 는 체크섬 때문에 수정 금지 → 같은 이름으로 CREATE OR REPLACE (트리거는 이름으로 함수를 부르므로 그대로). 웹은 t 를 쓰지 않는다(재조회 신호 규약 불변)
CREATE OR REPLACE FUNCTION notify_op_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', lower(NEW.kind), 'g', NEW.global_id, 's', NEW.status,
    't', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION notify_conversion_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', 'job', 's', NEW.status, 'p', NEW.progress,
    't', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION notify_model_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.id, 'k', 'job', 's', NEW.status,
    't', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text);
  RETURN NULL;
END $$;
```

- [ ] **Step 6: `Notifier.java`** — 전체 교체 (Task 4 가 대기 시간·`stop()` 두 곳을 더 바꾼다)

```java
package com.bim.api;

import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import java.sql.Connection;
import java.sql.SQLException;
import java.time.Duration;
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

/** 실시간 푸시: DB 트리거의 pg_notify('bim', {m,k,g,s,p,t}) 를 풀 연결 하나로 LISTEN → 그 모델 구독자에게 (kind, json) 팬아웃.
 *  구독자 = SSE 어댑터(StreamController)·변환 진행률(ModelController.events)·테스트. sink 가 예외를 던지면(끊긴 SSE) 그 구독은 해제.
 *  연결이 끊기면 1→2→4…30초 백오프 재연결, 재연결 뒤 전원에게 resync(놓친 알림 — 화면이 전체 재조회). HEARTBEAT_MS 마다 hb(죽은 SSE 정리·프록시 유휴 타임아웃 방지)
 *  지표(R2-3): bim_sse_subscribers(구독자 수)·bim_notify_events_total{kind}(알림 수)·bim_notify_lag_seconds(트리거 t → dispatch) */
@Component
class Notifier implements SmartLifecycle {
	private static final Logger log = LoggerFactory.getLogger(Notifier.class);
	static final int HEARTBEAT_MS = 20_000;
	private final DataSource ds;
	private final MeterRegistry meters;
	private final Timer lag;
	private final Map<UUID, Set<BiConsumer<String, String>>> subs = new ConcurrentHashMap<>();
	private volatile boolean running;
	private volatile Thread thread;
	private final CountDownLatch listening = new CountDownLatch(1);

	Notifier(DataSource ds, MeterRegistry meters) {
		this.ds = ds;
		this.meters = meters;
		Gauge.builder("bim.sse.subscribers", this, Notifier::subscribers).description("Notifier 구독자 수 (SSE 스트림 + 변환 진행률)").register(meters);
		lag = Timer.builder("bim.notify.lag").description("트리거 발생(payload t) → Notifier dispatch")
			.publishPercentileHistogram().maximumExpectedValue(Duration.ofSeconds(10)).register(meters);
	}

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
		var k = (String) p.get("k");
		meters.counter("bim.notify.events", "kind", k).increment();   // k 가 없으면 여기서 예외 → 위에서 격리(로그만)
		if (p.get("t") instanceof Number t) lag.record(Math.max(0, System.currentTimeMillis() - t.longValue()), TimeUnit.MILLISECONDS);
		var s = subs.get(m);
		if (s != null) send(m, s, k, json);
	}

	private void toAll(String kind, String data) { subs.forEach((m, s) -> send(m, s, kind, data)); }

	private void send(UUID m, Set<BiConsumer<String, String>> s, String kind, String data) {
		for (var sink : s) try { sink.accept(kind, data); } catch (RuntimeException e) { remove(m, sink); }
	}
}
```

- [ ] **Step 7: 테스트 통과 + 전체 회귀**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test -q; for f in build/test-results/test/*.xml; do grep -o 'testsuite name="[^"]*" tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' $f; done`
Expected: 전부 `failures="0" errors="0"`, `NotifyTests` tests="7" (현재 개수 + 1 — 계획 작성 중 R2-2 Task 2 반영본 복사로 26개 통과 확인)

- [ ] **Step 8: 배포(jar 교체) + 라이브 확인**

Run:
```bash
SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew bootJar -x test -q && cp build/libs/api-0.0.1-SNAPSHOT.jar $SP/apijar/app.jar && docker build -q -t bim-platform-api $SP/apijar && cd .. && docker compose up -d --no-build --force-recreate api && for i in $(seq 1 60); do curl -sf localhost:8080/api/projects >/dev/null && break; sleep 2; done
docker compose exec -T postgis psql -U bim -d bim -tAc "SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1"
curl -s -o /dev/null -w 'nginx /actuator/prometheus %{http_code}\n' localhost:5173/actuator/prometheus
(curl -sN --max-time 6 localhost:8080/api/models/32d1ef4f-d6b0-439d-9649-645e47e196b2/stream > $SP/r2-3-t.txt &) ; sleep 1
docker compose exec -T postgis psql -U bim -d bim -qc "UPDATE conversion_job SET progress = progress WHERE id = (SELECT max(id) FROM conversion_job WHERE model_id = '32d1ef4f-d6b0-439d-9649-645e47e196b2')"
sleep 6; cat $SP/r2-3-t.txt; curl -s localhost:8080/actuator/prometheus | grep -E '^(bim_sse_subscribers|bim_notify_events_total|bim_notify_lag_seconds_count|http_server_requests_seconds_bucket.*uri="/api/projects".*le="\+Inf")'
```
Expected:
- `10|t`, `nginx /actuator/prometheus 404`
- 스트림: `:ready`, `event:job`, `data:{"m" : "32d1ef4f-…", "k" : "job", "s" : "DONE", "p" : 100, "t" : 17…}` (값이 그대로인 UPDATE 도 `UPDATE OF progress` 트리거가 돈다 — 데이터 변화 없음)
- `bim_sse_subscribers` = 열린 브라우저 탭 수(없으면 0), `bim_notify_events_total{kind="job"}` ≥ 1.0, `bim_notify_lag_seconds_count` ≥ 1.0, `http_server_requests_seconds_bucket{…uri="/api/projects",le="+Inf"}` 한 줄 이상

- [ ] **Step 9: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add api/build.gradle api/src/main/resources/application.yml api/src/main/resources/db/migration/V10__notify_time.sql api/src/main/java/com/bim/api/Notifier.java api/src/test/java/com/bim/api/NotifyTests.java && git commit -m "api: 관측성 — /actuator/prometheus 노출·요청 히스토그램, 알림 payload 트리거 시각 t(V10), Notifier 지표(SSE 구독자·종류별 알림·이벤트 지연)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: compose profile `obs` — Prometheus·Grafana 프로비저닝

**Files:**
- Create: `obs/prometheus.yml`, `obs/grafana/datasources/prometheus.yml`, `obs/grafana/dashboards/bim.yml`, `obs/grafana/dashboards/bim.json`
- Modify: `compose.yaml` (tunnel 서비스 뒤, 최상위 `volumes:` 앞)

**Interfaces:**
- Consumes: Task 1 지표 이름(위 표)
- Produces: Prometheus `http://localhost:9090`(`/api/v1/query`·`/api/v1/targets`, job `api`), Grafana `http://localhost:3001`(호스트 3001 → 컨테이너 3000) 익명 Viewer, 대시보드 `/d/bim-api`(uid `bim-api`, 9패널), 데이터소스 uid `prom`

- [ ] **Step 1: 이미지 pull**

Run: `for i in prom/prometheus:v3.15.0 grafana/grafana:13.2.3 grafana/k6:2.3.0; do docker pull -q $i; done`
Expected: `docker.io/prom/prometheus:v3.15.0`, `docker.io/grafana/grafana:13.2.3`, `docker.io/grafana/k6:2.3.0` (계획 작성 중 pull 됨). 실패하면 이 태스크를 멈추고 오류를 보고(스펙 7절)

- [ ] **Step 2: `obs/prometheus.yml`**

```yaml
# compose profile obs — api 의 /actuator/prometheus 를 compose 내부망에서 5초마다 (외부에선 nginx 가 /actuator/ 를 404)
global:
  scrape_interval: 5s
scrape_configs:
  - job_name: api
    metrics_path: /actuator/prometheus
    static_configs:
      - targets: ['api:8080']
```

- [ ] **Step 3: Grafana 데이터소스·대시보드 공급자**

`obs/grafana/datasources/prometheus.yml`:
```yaml
apiVersion: 1
datasources:
  - name: Prometheus
    uid: prom
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    jsonData:
      timeInterval: 5s   # 스크레이프 주기 — 대시보드의 $__rate_interval 계산용
```

`obs/grafana/dashboards/bim.yml`:
```yaml
apiVersion: 1
providers:
  - name: bim
    type: file
    options:
      path: /etc/grafana/provisioning/dashboards   # 이 디렉터리의 *.json. 디렉터리째 마운트 — 파일 하나만 마운트하면 편집기가 파일을 바꿔 쓸 때 컨테이너 쪽이 끊긴다
```

- [ ] **Step 4: 대시보드** — `obs/grafana/dashboards/bim.json` (3열 × 3행, 스펙 3절 패널 — JVM 은 단위가 달라 스레드·힙 둘)

```json
{
  "uid": "bim-api",
  "title": "BIM API",
  "description": "R2-3 관측성 — 요청·실시간 푸시(Notifier)·DB 풀·JVM. SSE(/stream·/events)는 연결 수명이라 요청률·p95 에서 뺀다",
  "timezone": "browser",
  "refresh": "5s",
  "time": { "from": "now-15m", "to": "now" },
  "schemaVersion": 39,
  "panels": [
    {
      "id": 1, "type": "timeseries", "title": "엔드포인트별 요청률",
      "gridPos": { "x": 0, "y": 0, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "reqps" }, "overrides": [] },
      "options": { "legend": { "displayMode": "table", "placement": "bottom", "calcs": ["max"], "sortBy": "Max", "sortDesc": true, "showLegend": true } },
      "targets": [
        { "refId": "A", "expr": "sum by (method, uri) (rate(http_server_requests_seconds_count{uri!~\"/actuator.*|/api/models/[^/]+/(stream|events)\"}[$__rate_interval]))", "legendFormat": "{{method}} {{uri}}" }
      ]
    },
    {
      "id": 2, "type": "timeseries", "title": "엔드포인트별 p95",
      "gridPos": { "x": 8, "y": 0, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "options": { "legend": { "displayMode": "table", "placement": "bottom", "calcs": ["max"], "sortBy": "Max", "sortDesc": true, "showLegend": true } },
      "targets": [
        { "refId": "A", "expr": "histogram_quantile(0.95, sum by (le, method, uri) (rate(http_server_requests_seconds_bucket{uri!~\"/actuator.*|/api/models/[^/]+/(stream|events)\"}[$__rate_interval])))", "legendFormat": "{{method}} {{uri}}" }
      ]
    },
    {
      "id": 3, "type": "timeseries", "title": "이벤트 지연 (트리거 → dispatch)",
      "gridPos": { "x": 16, "y": 0, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "s" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "histogram_quantile(0.5, sum by (le) (rate(bim_notify_lag_seconds_bucket[$__rate_interval])))", "legendFormat": "p50" },
        { "refId": "B", "expr": "histogram_quantile(0.95, sum by (le) (rate(bim_notify_lag_seconds_bucket[$__rate_interval])))", "legendFormat": "p95" },
        { "refId": "C", "expr": "histogram_quantile(0.99, sum by (le) (rate(bim_notify_lag_seconds_bucket[$__rate_interval])))", "legendFormat": "p99" }
      ]
    },
    {
      "id": 4, "type": "timeseries", "title": "SSE 구독자",
      "gridPos": { "x": 0, "y": 7, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "bim_sse_subscribers", "legendFormat": "구독자" }
      ]
    },
    {
      "id": 5, "type": "timeseries", "title": "종류별 알림률",
      "gridPos": { "x": 8, "y": 7, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "ops" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "sum by (kind) (rate(bim_notify_events_total[$__rate_interval]))", "legendFormat": "{{kind}}" }
      ]
    },
    {
      "id": 6, "type": "timeseries", "title": "DB 풀 (Hikari)",
      "gridPos": { "x": 16, "y": 7, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "hikaricp_connections_active", "legendFormat": "active" },
        { "refId": "B", "expr": "hikaricp_connections_pending", "legendFormat": "pending" },
        { "refId": "C", "expr": "hikaricp_connections_max", "legendFormat": "max" }
      ]
    },
    {
      "id": 7, "type": "timeseries", "title": "JVM 스레드 (플랫폼)",
      "gridPos": { "x": 0, "y": 14, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "short" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "jvm_threads_live_threads", "legendFormat": "live" }
      ]
    },
    {
      "id": 8, "type": "timeseries", "title": "JVM 힙",
      "gridPos": { "x": 8, "y": 14, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "bytes" }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "sum(jvm_memory_used_bytes{area=\"heap\"})", "legendFormat": "used" },
        { "refId": "B", "expr": "sum(jvm_memory_max_bytes{area=\"heap\"} > 0)", "legendFormat": "max" }
      ]
    },
    {
      "id": 9, "type": "timeseries", "title": "프로세스 CPU (코어)",
      "gridPos": { "x": 16, "y": 14, "w": 8, "h": 7 },
      "datasource": { "type": "prometheus", "uid": "prom" },
      "fieldConfig": { "defaults": { "unit": "short", "decimals": 1 }, "overrides": [] },
      "targets": [
        { "refId": "A", "expr": "rate(process_cpu_time_ns_total[$__rate_interval]) / 1e9", "legendFormat": "api" },
        { "refId": "B", "expr": "system_cpu_count", "legendFormat": "가용 코어" }
      ]
    }
  ]
}
```

- [ ] **Step 5: `compose.yaml`** — tunnel 서비스 끝 다음 — 기존:
```yaml
    command: ["tunnel", "--no-autoupdate", "--url", "http://web:80"]
    depends_on: [web]
    restart: unless-stopped

volumes:
```
교체:
```yaml
    command: ["tunnel", "--no-autoupdate", "--url", "http://web:80"]
    depends_on: [web]
    restart: unless-stopped

  # ── 관측성 (docker compose --profile obs up -d) ───────────────────────────
  # Prometheus 가 api:8080/actuator/prometheus 를 compose 내부망에서 5초마다 — 외부 nginx 는 /actuator/ 404. 둘 다 호스트 127.0.0.1 만
  prometheus:
    profiles: [obs]
    image: prom/prometheus:v3.15.0
    volumes: ["./obs/prometheus.yml:/etc/prometheus/prometheus.yml:ro"]
    ports: ["127.0.0.1:9090:9090"]

  # 익명 Viewer, 데이터소스·대시보드(obs/grafana/)는 프로비저닝 — 디렉터리째 마운트(파일 하나 마운트는 편집기가 바꿔 쓰면 끊긴다). 편집은 admin/admin 로그인
  grafana:
    profiles: [obs]
    image: grafana/grafana:13.2.3
    environment:
      GF_AUTH_ANONYMOUS_ENABLED: "true"
      GF_AUTH_ANONYMOUS_ORG_ROLE: Viewer
      GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH: /etc/grafana/provisioning/dashboards/bim.json
      GF_PLUGINS_PREINSTALL_DISABLED: "true"   # 기동 시 플러그인 다운로드 안 함(사내망 TLS 가로채기·오프라인)
      GF_ANALYTICS_REPORTING_ENABLED: "false"
      GF_ANALYTICS_CHECK_FOR_UPDATES: "false"
    volumes:
      - ./obs/grafana/datasources:/etc/grafana/provisioning/datasources:ro
      - ./obs/grafana/dashboards:/etc/grafana/provisioning/dashboards:ro
    ports: ["127.0.0.1:3001:3000"]

volumes:
```

- [ ] **Step 6: 기동·확인**

Run:
```bash
cd /Users/hubilon_map/orca/projects/bim-platform && docker compose --profile obs config --services | sort | tr '\n' ' '; echo && docker compose --profile obs up -d --no-build prometheus grafana && sleep 15
curl -s localhost:9090/api/v1/targets | jq -r '.data.activeTargets[] | "\(.labels.job) \(.health) \(.lastError)"'
curl -s localhost:3001/api/dashboards/uid/bim-api | jq -r '.dashboard.title, (.dashboard.panels | length), .meta.provisioned'
curl -s localhost:3001/api/datasources/uid/prom | jq -r '"\(.name) \(.url)"'
jq -r '.panels[].targets[].expr' obs/grafana/dashboards/bim.json | sed 's/\$__rate_interval/1m/g' | while read -r q; do curl -s localhost:9090/api/v1/query --data-urlencode "query=$q" | jq -r .status; done | sort | uniq -c
docker compose logs grafana | grep -c 'level=error'
docker compose ps --format '{{.Service}} {{.Status}}' | sort
```
Expected:
- `api grafana ifc-worker minio minio-init postgis prometheus web` (+ demo 서비스 없음)
- `api up ` (lastError 빈칸)
- `BIM API`, `9`, `true`
- `Prometheus http://prometheus:9090`
- `     15 success` (패널 쿼리 15개 전부 — 계획 작성 중 임시 스택에서 같은 결과)
- `0` (grafana error 로그 없음 — provisioning 전체 디렉터리를 마운트하면 plugins·alerting 디렉터리 없음 오류가 난다, 그래서 하위 디렉터리만)
- 기존 api·web·worker 는 재생성되지 않음(Up 시간 유지)

- [ ] **Step 7: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add compose.yaml obs/prometheus.yml obs/grafana/datasources/prometheus.yml obs/grafana/dashboards/bim.yml obs/grafana/dashboards/bim.json && git commit -m "obs: compose profile obs — Prometheus(api 내부망 5초 수집)·Grafana(익명 보기, 데이터소스·대시보드 9패널 프로비저닝)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 부하 도구 — k6 상태 PATCH·SSE 구독자·한 판 실행

**Files:**
- Create: `load/sse-clients.test.mjs`, `load/sse-clients.mjs`, `load/status-burst.js`, `load/run.sh`

**Interfaces:**
- Consumes: Task 1 payload `t`·`bim_sse_subscribers`, Task 2 Prometheus(`localhost:9090`, 없으면 표에 `-`)
- Produces: `sse-clients.mjs` export `hist(): Uint32Array`, `add(h, ms)`, `stats(h): {n, p50, p95, p99, max}`, `row(rate, k6Summary, sse, prom): string`
- Produces: `RATE=<R> K6=<k6 요약 JSON> node load/sse-clients.mjs <모델 id> <M>` — stderr `ready n/M (… ms, 워커 k)` → SIGTERM → stderr JSON `{window, sse:{clients, connected, dropped, events, lat, elu}, prom:{cpu, pending, lag95}}`, stdout 표 한 행
- Produces: `load/run.sh <R> <M> [모델 이름=mep-building.ifc]` (env `DURATION`, 기본 60s) — stderr `ready …`·JSON·`끊긴 구독 정리 N s — …`·`되돌림: …`, stdout 표 한 행(위 "지표·계약" 표)
- Produces: k6 `status-burst.js` env `MODEL`·`RATE`·`DURATION`·`API`(기본 `http://api:8080/api`), 태그 `name:patch`

- [ ] **Step 1: 실패하는 테스트** — `load/sse-clients.test.mjs`

```js
// node --test load/sse-clients.test.mjs   — sse-clients.mjs 의 순수 집계(분위수·표 한 행)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { add, hist, row, stats } from './sse-clients.mjs'

test('분위수 = 누적 개수가 ceil(p·n) 에 처음 닿는 ms', () => {
  const h = hist()
  for (let ms = 1; ms <= 100; ms++) add(h, ms)
  assert.deepEqual(stats(h), { n: 100, p50: 50, p95: 95, p99: 99, max: 100 })
})

test('빈 히스토그램은 null, 음수는 0 칸, 60초 초과는 마지막 칸', () => {
  assert.deepEqual(stats(hist()), { n: 0, p50: null, p95: null, p99: null, max: null })
  const h = hist(); add(h, -3); add(h, 90_000)
  assert.equal(stats(h).p50, 0); assert.equal(stats(h).max, 60_000)
})

test('표 한 행 — 누락 = 1 − 받은 수 / (성공 PATCH × 연결 구독자), Prometheus 없으면 -', () => {
  const k6 = { metrics: { checks: { passes: 1200 }, iterations: { rate: 19.8 }, 'http_req_duration{name:patch}': { 'p(95)': 41.6 }, 'http_req_failed{name:patch}': { value: 0 } } }
  const sse = { clients: 100, connected: 100, events: 119_880, lat: { p50: 12, p95: 30, p99: 55 } }
  assert.equal(row(20, k6, sse, { cpu: 1.26, pending: 0, lag95: 4.9 }), '| 20 (19.8) | 100 | 42 ms | 0.0 % | 12 · 30 · 55 ms | 5 ms | 0.10 % | 1.3 | 0 |')
  assert.equal(row(20, k6, sse, { cpu: null, pending: null, lag95: null }), '| 20 (19.8) | 100 | 42 ms | 0.0 % | 12 · 30 · 55 ms | - ms | 0.10 % | - | - |')
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform && node --test load/sse-clients.test.mjs 2>&1 | grep -E 'ERR_MODULE_NOT_FOUND|^# (pass|fail)'`
Expected: `ERR_MODULE_NOT_FOUND`(sse-clients.mjs 없음), `# fail 1`. (`node --test load/` 처럼 디렉터리를 주면 Node 22 는 파일로 취급해 실패 — 파일을 명시)

- [ ] **Step 3: `load/sse-clients.mjs`**

```js
// SSE 구독자 M 개(R2-3 부하 측정) — Node 22 표준 fetch 스트림·worker_threads, 의존성 없음
//   RATE=<R> K6=<k6 --summary-export JSON> node load/sse-clients.mjs <모델 id> <M>      (보통 load/run.sh 가 부른다)
// - GET localhost:8080/api/models/{id}/stream 을 워커(스레드)당 200개씩 열고, 전부 :ready 를 받으면 stderr 에 'ready M'
//   (계획 작성 중 측정: 한 스레드에 1,000개 × 초당 200건이면 CPU 0.9 코어로 포화, 250개씩이면 이벤트 루프 0.69 — 클라이언트 적체가 지연에 섞이지 않게 200)
// - status 이벤트마다 수신 시각 − payload t(트리거 시각, DB clock_timestamp ms) = 종단 지연. 호스트 시계 ≈ Docker VM 시계(계획 작성 중 psql 로 ±1ms 확인)
// - SIGTERM 을 받으면 조용해질 때까지(3초, 최대 30초) 더 받은 뒤 stdout 에 README 표 한 행, stderr 에 상세 JSON
// - Prometheus(localhost:9090, compose profile obs)가 떠 있으면 같은 구간의 API CPU·Hikari 대기·서버 지연(트리거 → dispatch)도 함께
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

const MAX_MS = 60_000, PER_WORKER = 200

/** ms 단위 지연 히스토그램(0~60초, 넘으면 마지막 칸) — 구독자 1,000 × 이벤트 1만 개도 메모리 일정 */
export const hist = () => new Uint32Array(MAX_MS + 1)
export const add = (h, ms) => { h[Math.min(MAX_MS, Math.max(0, Math.round(ms)))]++ }

/** {n, p50, p95, p99, max} (ms). 분위수 = 누적 개수가 ceil(p·n) 에 처음 닿는 칸 */
export function stats(h) {
  let n = 0, max = null
  for (let i = 0; i < h.length; i++) if (h[i]) { n += h[i]; max = i }
  const q = p => { const want = Math.ceil(p * n); let acc = 0; for (let i = 0; i < h.length; i++) if ((acc += h[i]) >= want) return i }
  return n ? { n, p50: q(0.5), p95: q(0.95), p99: q(0.99), max } : { n: 0, p50: null, p95: null, p99: null, max: null }
}

/** README 표 한 행. k6 = --summary-export JSON, sse = {clients, connected, events, lat}, prom = {cpu, pending, lag95} (없으면 null)
 *  누락 = 1 − 받은 이벤트 / (성공 PATCH × 연결된 구독자) — PATCH 1건이 op_event 1행 = 구독자마다 알림 1개 */
export function row(rate, k6, sse, prom) {
  const m = k6.metrics, ok = m.checks?.passes ?? 0, f = (x, d = 0) => (x == null ? '-' : x.toFixed(d))
  const missing = ok && sse.connected ? Math.max(0, 1 - sse.events / (ok * sse.connected)) * 100 : null
  return `| ${rate} (${f(m.iterations?.rate, 1)}) | ${sse.clients} | ${f(m['http_req_duration{name:patch}']?.['p(95)'])} ms | ${f((m['http_req_failed{name:patch}']?.value ?? 0) * 100, 1)} % | ` +
    `${sse.lat.p50 ?? '-'} · ${sse.lat.p95 ?? '-'} · ${sse.lat.p99 ?? '-'} ms | ${f(prom.lag95)} ms | ${f(missing, 2)} % | ${f(prom.cpu, 1)} | ${f(prom.pending)} |`
}

/** 워커 스레드: 구독자 n 개를 열고 {ready} → 'stop' 을 받으면 조용해질 때까지 더 받고 {events, failed, dropped, h, elu} */
async function subscribers({ url, n }) {
  const h = hist(), ac = new AbortController(), sleep = ms => new Promise(r => setTimeout(r, ms))
  let events = 0, failed = 0, dropped = 0, last = Date.now()
  async function open() {   // :ready 를 받으면 resolve, 이후 status 이벤트를 세고 지연을 쌓는다
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`stream ${res.status}`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = '', ready
    const isReady = new Promise(r => { ready = r })
    ;(async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
            const msg = buf.slice(0, i)
            if (msg.startsWith(':ready')) ready()
            else if (/^event:\s?status$/m.test(msg)) {
              const now = Date.now(), t = JSON.parse(msg.match(/^data:(.*)$/m)[1]).t
              events++; last = now
              if (t) add(h, now - t)
            }
          }
        }
      } catch { /* abort — 정상 종료 */ }
      if (!ac.signal.aborted) dropped++   // 측정 중 서버가 끊음
    })()
    return isReady
  }
  for (let i = 0; i < n; i += 50) await Promise.all(Array.from({ length: Math.min(50, n - i) }, () => open().catch(e => { failed++; console.error('연결 실패:', e.message) })))
  const elu0 = performance.eventLoopUtilization()
  parentPort.postMessage({ ready: n - failed })
  parentPort.once('message', async () => {
    const stop = Date.now()
    while (Date.now() - last < 3000 && Date.now() - stop < 30_000) await sleep(250)
    ac.abort()
    parentPort.postMessage({ events, failed, dropped, h, elu: performance.eventLoopUtilization(elu0).utilization }, [h.buffer])
  })
}

async function main() {
  const [id, m] = process.argv.slice(2), M = Number(m)
  if (!id || !M) { console.error('사용: RATE=<R> K6=<k6 요약 JSON> node load/sse-clients.mjs <모델 id> <M>'); process.exit(2) }
  const url = `http://localhost:8080/api/models/${id}/stream`, PROM = 'http://localhost:9090/api/v1/query', t0 = Date.now()
  const ws = Array.from({ length: Math.ceil(M / PER_WORKER) }, (_, i) =>
    new Worker(fileURLToPath(import.meta.url), { workerData: { url, n: Math.min(PER_WORKER, M - i * PER_WORKER) } }))
  const next = w => new Promise(r => w.once('message', r))
  const ready = (await Promise.all(ws.map(next))).reduce((a, x) => a + x.ready, 0), readyAt = Date.now()
  console.error(`ready ${ready}/${M} (${readyAt - t0} ms, 워커 ${ws.length})`)

  process.once('SIGTERM', async () => {
    const rs = await Promise.all(ws.map(w => { const r = next(w); w.postMessage('stop'); return r }))
    const h = hist()
    for (const r of rs) for (let i = 0; i < h.length; i++) h[i] += r.h[i]
    const sum = k => rs.reduce((a, r) => a + r[k], 0), w = `${Math.ceil((Date.now() - readyAt) / 1000)}s`
    const prom = async q => {
      try { const v = (await (await fetch(`${PROM}?query=${encodeURIComponent(q)}`)).json()).data.result[0]?.value[1]; return v == null || v === 'NaN' ? null : Number(v) }
      catch { return null }   // obs 프로필이 꺼져 있음
    }
    const p = {
      cpu: await prom(`max_over_time(rate(process_cpu_time_ns_total[15s])[${w}:5s]) / 1e9`),   // API 코어 수(15초 평균의 최대)
      pending: await prom(`max_over_time(hikaricp_connections_pending[${w}])`),
      lag95: await prom(`histogram_quantile(0.95, sum by (le) (increase(bim_notify_lag_seconds_bucket[${w}]))) * 1000`),
    }
    const sse = { clients: M, connected: M - sum('failed'), dropped: sum('dropped'), events: sum('events'), lat: stats(h), elu: +Math.max(...rs.map(r => r.elu)).toFixed(2) }
    console.error(JSON.stringify({ window: w, sse, prom: p }))   // elu = 가장 바쁜 워커의 이벤트 루프 사용률 — 0.8 을 넘으면 PER_WORKER 를 줄여 다시
    const k6 = process.env.K6
    if (k6 && existsSync(k6)) console.log(row(process.env.RATE ?? '-', JSON.parse(readFileSync(k6, 'utf8')), sse, p))
    process.exit(0)
  })
}

if (!isMainThread) await subscribers(workerData)
else if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
```

- [ ] **Step 4: 테스트 통과**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform && node --test load/sse-clients.test.mjs 2>&1 | grep -E '^# (tests|pass|fail)'`
Expected: `# tests 3`, `# pass 3`, `# fail 0`

- [ ] **Step 5: `load/status-burst.js`**

```js
// 상태 이벤트 부하(R2-3) — k6. 열린 작업지시가 있는 감지기에 PATCH …/status 를 초당 RATE 건, DURATION 동안(constant-arrival-rate)
// load/run.sh 가 compose 망에서 실행(api:8080 직접 — nginx 레이트 리밋 20r/s·IP 를 거치지 않음):
//   docker run --rm --network <compose 망> -v "$PWD/load:/load:ro" grafana/k6:2.3.0 run -e MODEL=<모델 id> -e RATE=20 /load/status-burst.js
// 대상 한정: 경보(ALARM)가 새 작업지시를 만들지 않고 열린 것을 재사용 — 데이터 영향 최소. 원상복구는 run.sh
import http from 'k6/http'
import exec from 'k6/execution'
import { check } from 'k6'

const API = __ENV.API || 'http://api:8080/api', MODEL = __ENV.MODEL, RATE = Number(__ENV.RATE || 20)

export const options = {
  scenarios: {
    burst: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '60s', preAllocatedVUs: Math.max(10, RATE), maxVUs: Math.max(50, RATE * 5) },
  },
  thresholds: { 'http_req_duration{name:patch}': ['p(95)<500'], 'http_req_failed{name:patch}': ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
}

export function setup() {
  const wo = http.get(`${API}/models/${MODEL}/work-orders`).json()
  const targets = [...new Set(wo.filter(w => w.status !== 'DONE' && w.ifcClass === 'IfcSensor' && /감지기/.test(w.elementName || '')).map(w => w.globalId))]
  if (!targets.length) throw new Error('열린 작업지시가 있는 감지기가 없다')
  return { targets }
}

export default function ({ targets }) {
  const i = exec.scenario.iterationInTest, gid = targets[i % targets.length]
  const Status = Math.floor(i / targets.length) % 2 ? 'NORMAL' : 'ALARM'   // 한 바퀴마다 대상 전원 경보 ↔ 정상
  const r = http.patch(`${API}/models/${MODEL}/elements/${encodeURIComponent(gid)}/status`, JSON.stringify({ Status }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'patch' } })
  check(r, { patch: x => x.status === 200 })   // 성공 수 = 구독자마다 기대 이벤트 수(PATCH 1건 = op_event 1행 = 알림 1개)
}
```

- [ ] **Step 6: `load/run.sh`** (+ `chmod +x load/run.sh`)

```bash
#!/usr/bin/env bash
# 부하 한 판(R2-3): SSE 구독자 M 개 → k6 상태 PATCH 초당 R 건 60초 → README 표 한 행. 끝나면(중단돼도) 모델 상태·이벤트를 시작 시점으로 되돌린다
#   load/run.sh <R> <M> [모델 이름=mep-building.ifc]      compose 기동 중, 호스트에 node 22·jq. DURATION=10s 로 짧게
# - PATCH: k6 컨테이너 → compose 망 api:8080 직접(nginx 레이트 리밋 20r/s·IP 우회). SSE: 호스트 → localhost:8080 직접
# - 대상: 열린 작업지시가 있는 감지기(status-burst.js) — 경보가 새 작업지시를 만들지 않고 열린 것을 재사용
# - 되돌리기: 시작 전 요소 상태(Pset_BimStatus)를 파일로 떠 두고 끝나면 그대로 복원 + 그 사이 STATUS 이벤트 삭제(모니터링 타임라인·통계 오염 방지)
set -euo pipefail
cd "$(dirname "$0")/.."
R=${1:?사용: load/run.sh <R 초당 PATCH> <M SSE 구독자> [모델 이름]} M=${2:?M} NAME=${3:-mep-building.ifc}
API=http://localhost:8080/api
psql() { docker compose exec -T postgis psql -U bim -d bim -v ON_ERROR_STOP=1 -qtA "$@"; }
subs() { curl -sf localhost:8080/actuator/prometheus | awk '/^bim_sse_subscribers/ {print int($2)}'; }   # api 포트는 호스트 127.0.0.1 — nginx(/actuator/ 404)를 거치지 않는다

PROJ=$(curl -sf $API/projects | jq -r '.[0].id')
MID=$(curl -sf "$API/projects/$PROJ/models" | jq -r --arg n "$NAME" 'first(.[] | select(.name == $n and .status == "READY") | .id) // empty')
[ -n "$MID" ] || { echo "READY 모델 '$NAME' 없음" >&2; exit 1; }
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q api)")
OUT=$(mktemp -d) BASE=$(subs)   # 시작 전 구독자(열린 브라우저 탭)

T0=$(psql -c 'SELECT now()')
psql -c "COPY (SELECT id, properties->'Pset_BimStatus' FROM element WHERE model_id = '$MID' AND jsonb_exists(properties, 'Pset_BimStatus')) TO STDOUT" > "$OUT/snapshot.tsv"
restore() {
  { echo 'CREATE TEMP TABLE snap (id bigint, s jsonb); COPY snap FROM STDIN;'; cat "$OUT/snapshot.tsv"; echo '\.'
    echo "UPDATE element e SET properties = jsonb_set(e.properties, '{Pset_BimStatus}', snap.s) FROM snap WHERE e.id = snap.id AND e.properties->'Pset_BimStatus' IS DISTINCT FROM snap.s;"
    echo "DELETE FROM op_event WHERE model_id = '$MID' AND kind = 'STATUS' AND at >= '$T0';"; } | psql
  echo "되돌림: 요소 상태(스냅숏 $(wc -l < "$OUT/snapshot.tsv" | tr -d ' ')행)·$T0 이후 STATUS 이벤트 삭제 (기록 $OUT)" >&2
}
trap restore EXIT

RATE=$R K6="$OUT/k6.json" node load/sse-clients.mjs "$MID" "$M" > "$OUT/row.md" 2> "$OUT/sse.log" & SSE=$!
until grep -q '^ready' "$OUT/sse.log" 2>/dev/null; do kill -0 $SSE 2>/dev/null || { cat "$OUT/sse.log" >&2; exit 1; }; sleep 1; done
grep "^ready" "$OUT/sse.log" >&2
docker run --rm --network "$NET" -v "$PWD/load:/load:ro" -v "$OUT:/out" grafana/k6:2.3.0 run -q -e MODEL="$MID" -e RATE="$R" -e DURATION="${DURATION:-60s}" \
  --summary-export /out/k6.json /load/status-burst.js > "$OUT/k6.log" 2>&1 || echo "k6 종료 코드 $? (99 = 임계값 초과) — $OUT/k6.log" >&2
kill -TERM $SSE; wait $SSE || true; GONE=$SECONDS
tail -1 "$OUT/sse.log" >&2
# 끊긴 SSE 는 서버가 하트비트(20초) 몇 번 뒤에야 정리한다 — 다음 판의 팬아웃에 섞이지 않게 시작 전 수로 돌아올 때까지(최대 3분)
for _ in $(seq 36); do [ "$(subs)" -le "$BASE" ] && break; sleep 5; done
echo "끊긴 구독 정리 $((SECONDS - GONE)) s — 구독자 $(subs) (시작 전 $BASE)" >&2
cat "$OUT/row.md"
```

Run: `chmod +x /Users/hubilon_map/orca/projects/bim-platform/load/run.sh && bash -n /Users/hubilon_map/orca/projects/bim-platform/load/run.sh && echo ok`
Expected: `ok`

- [ ] **Step 7: 데이터 위생 기준선** (시뮬레이터 정지 확인 + 모델 상태 해시·이벤트 수·작업지시 수)

Run:
```bash
SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform && docker compose ps --services --status running | grep -x sim && docker compose --profile demo stop sim; docker compose exec -T postgis psql -U bim -d bim -tAc "SELECT (SELECT md5(string_agg(e.id || ':' || (e.properties->'Pset_BimStatus')::text, ',' ORDER BY e.id)) FROM element e WHERE e.model_id = '32d1ef4f-d6b0-439d-9649-645e47e196b2'), (SELECT count(*) FROM op_event WHERE model_id = '32d1ef4f-d6b0-439d-9649-645e47e196b2'), (SELECT count(*) FROM work_order w JOIN asset a ON a.id = w.asset_id WHERE a.model_id = '32d1ef4f-d6b0-439d-9649-645e47e196b2')" | tee $SP/r2-3-hygiene-before.txt
```
Expected: `<md5>|<이벤트 수>|<작업지시 수>` 한 줄 (계획 작성 시점 이벤트 약 1,450·작업지시 21). sim 은 보통 꺼져 있음(출력 없음)

- [ ] **Step 8: 스모크 한 판** (작게 — 초당 5건 × 구독자 20 × 10초)

Run: `SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform && DURATION=10s load/run.sh 5 20 2>&1 | tee $SP/r2-3-smoke.txt`
Expected (계획 작성 중 V10 적용 임시 스택에서 같은 스크립트 — 감지기 4개 시드):
```text
ready 20/20 (47 ms, 워커 1)
{"window":"15s","sse":{"clients":20,"connected":20,"dropped":0,"events":1000,"lat":{"n":1000,"p50":10,"p95":13,"p99":14,"max":15},"elu":0.02},"prom":{…}}
끊긴 구독 정리 76 s — 구독자 0 (시작 전 0)
| 5 (5.0) | 20 | 11 ms | 0.0 % | 10 · 13 · 14 ms | 8 ms | 0.00 % | 0.0 | 0 |
되돌림: 요소 상태(스냅숏 7행)·… 이후 STATUS 이벤트 삭제 (기록 /var/folders/…)
```
라이브에서는 `events` = 성공 PATCH(≈50) × 20, 누락 `0.00 %`, 스냅숏 약 899행, `끊긴 구독 정리` 60~90 s. 그 다음 Step 7 의 SQL 을 다시 실행해 `$SP/r2-3-hygiene-after.txt` 로 저장하고 `diff $SP/r2-3-hygiene-before.txt $SP/r2-3-hygiene-after.txt` → 출력 없음(상태·이벤트·작업지시 그대로)

- [ ] **Step 9: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add load/sse-clients.mjs load/sse-clients.test.mjs load/status-burst.js load/run.sh && git commit -m "load: 부하 도구 — k6 상태 PATCH(열린 작업지시 감지기)·SSE 구독자 워커(종단 지연·누락)·run.sh 한 판(스냅숏 되돌리기·끊긴 구독 정리 대기)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
확인: `git ls-files -s load/run.sh` 의 모드가 `100755`

---

### Task 4: R2-1 보류 정리 — SSE 재시도 지수 백오프·Notifier 종료

**Files:**
- Modify: `web/src/stream.ts`, `web/src/stream.test.ts`, `api/src/main/java/com/bim/api/Notifier.java`
- Create (저장소 밖): `$SP/backoff-check.mjs`

**Interfaces:**
- Produces: `stream.ts` export `RETRY_MS = 5000`, `RETRY_MAX_MS = 60_000` — n 번째 연속 영구 종료 뒤 대기 `min(RETRY_MS · 2ⁿ, RETRY_MAX_MS)`, open 되면 n = 0
- Produces: `Notifier.POLL_MS = 1_000` — 알림 대기 한 번의 상한, `stop()` 이 최대 2초 join

- [ ] **Step 1: 실패하는 테스트** — `web/src/stream.test.ts` 의 `describe('subscribe — 영구 종료·숨은 탭 복구'` 안, `it('마지막 해제는 대기 중인 재연결을 취소한다'` 바로 앞에 추가:

```ts
  it('연속 영구 종료는 5·10·20·40·60·60초 간격으로 다시 열고, open 되면 5초로 돌아간다', () => {
    vi.useFakeTimers(); FakeES.made = []
    const off = subscribe('m6', () => {}, make)
    const fail = () => { const es = FakeES.made[FakeES.made.length - 1]; es.readyState = 2; es.emit('error') }
    const gaps: number[] = []
    for (let i = 0; i < 6; i++) {
      fail()
      const n = FakeES.made.length
      let ms = 0
      while (FakeES.made.length === n) { vi.advanceTimersByTime(1000); ms += 1000 }
      gaps.push(ms)
    }
    expect(gaps).toEqual([5000, 10000, 20000, 40000, 60000, 60000])
    FakeES.made[FakeES.made.length - 1].onopen?.(); fail()
    vi.advanceTimersByTime(RETRY_MS); expect(FakeES.made).toHaveLength(8)
    off(); vi.useRealTimers()
  })
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npx vitest run src/stream.test.ts 2>&1 | grep -E 'Tests|expected|toEqual' | head -5`
Expected: FAIL 1 — `gaps` 가 `[5000, 5000, 5000, 5000, 5000, 5000]`

- [ ] **Step 3: `web/src/stream.ts`** — 네 곳

기존:
```ts
export const RETRY_MS = 5000
```
교체:
```ts
export const RETRY_MS = 5000, RETRY_MAX_MS = 60_000
```
기존:
```ts
 *  - 영구 종료(재연결 응답이 502·429 등 → readyState 2): RETRY_MS 뒤 새로 만들고 첫 open 을 resync 로
```
교체:
```ts
 *  - 영구 종료(재연결 응답이 502·429·404 등 → readyState 2): 5·10·20·40·60초(상한) 지수 백오프로 새로 만들고 첫 open 을 resync 로. open 되면 5초로 초기화
```
기존:
```ts
    let es: EventSourceLike | undefined, timer: ReturnType<typeof setTimeout> | undefined
```
교체:
```ts
    let es: EventSourceLike | undefined, timer: ReturnType<typeof setTimeout> | undefined, fails = 0
```
기존:
```ts
        timer = setTimeout(() => { timer = undefined; open(true) }, RETRY_MS)
      })
      cur.onopen = () => { if (resync) fns.forEach(f => f('resync')); resync = true }
```
교체:
```ts
        timer = setTimeout(() => { timer = undefined; open(true) }, Math.min(RETRY_MS * 2 ** fails++, RETRY_MAX_MS))   // 삭제된 모델(404) 탭이 5초마다 치던 것 완화
      })
      cur.onopen = () => { fails = 0; if (resync) fns.forEach(f => f('resync')); resync = true }
```

- [ ] **Step 4: 통과·빌드·린트**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npx vitest run src/stream.test.ts 2>&1 | grep Tests && npm run build 2>&1 | tail -2 && npm test 2>&1 | grep -E 'Tests' && npm run lint`
Expected: `stream.test.ts` 8 passed, 빌드 0오류, 전체 = 현재 개수 + 1 passed, lint 0경고 (계획 작성 중 복사본: tsc·oxlint 0, vitest 55)

- [ ] **Step 5: web 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add web/src/stream.ts web/src/stream.test.ts && git commit -m "web: SSE 영구 종료 재시도 5·10·20·40·60초 지수 백오프(연결되면 초기화) — 삭제된 모델 탭의 5초 고정 404 반복 완화

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 종료 WARN 기준선**

Run: `SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test --tests 'com.bim.api.NotifyTests' -q --rerun-tasks > $SP/r2-3-notify-before.log 2>&1; grep -c 'marked as broken' $SP/r2-3-notify-before.log`
Expected: `1` — 컨텍스트 종료 때 풀이 `getNotifications(10s)` 로 대기 중인 LISTEN 연결을 닫아 `HikariPool-1 - Connection … marked as broken because of SQLSTATE(08003)` (계획 작성 중 Task 1 상태에서 재현)

- [ ] **Step 7: `Notifier.java`** — 세 곳

기존:
```java
	static final int HEARTBEAT_MS = 20_000;
```
교체:
```java
	static final int HEARTBEAT_MS = 20_000;
	static final int POLL_MS = 1_000;   // 알림 대기 한 번의 상한 — 종료 시 이 안에 running 을 보고 연결을 정상 반납(stop 의 join)
```
기존:
```java
	@Override public void stop() { running = false; if (thread != null) thread.interrupt(); }
```
교체:
```java
	// 루프가 POLL_MS 안에 스스로 빠져 연결을 풀에 정상 반납하도록 기다린다 — 예전엔 풀 종료가 대기 중인 연결을 닫아 Hikari 'marked as broken' WARN
	@Override public void stop() {
		running = false;
		var t = thread;
		if (t == null) return;
		try { if (!t.join(Duration.ofSeconds(2))) t.interrupt(); }   // 재연결 백오프 대기(최대 30초) 중이면 깨운다
		catch (InterruptedException e) { Thread.currentThread().interrupt(); }
	}
```
기존:
```java
					PGNotification[] ns = pg.getNotifications(HEARTBEAT_MS / 2);
```
교체:
```java
					PGNotification[] ns = pg.getNotifications(POLL_MS);
```

- [ ] **Step 8: 테스트·WARN 확인**

Run: `SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test -q > $SP/r2-3-apitest.log 2>&1; echo exit=$?; grep -c 'marked as broken' $SP/r2-3-apitest.log; for f in build/test-results/test/*.xml; do grep -o 'tests="[0-9]*" skipped="[0-9]*" failures="[0-9]*" errors="[0-9]*"' $f; done | sort | uniq -c`
Expected: `exit=0`, `0`, 전부 `failures="0" errors="0"` (계획 작성 중 복사본 26개·WARN 0 확인)

- [ ] **Step 9: 배포(api jar + web) + 404 재시도 확인**

`$SP/backoff-check.mjs`:
```js
// R2-3 Task 4: 없는 모델 화면의 /stream 재시도 시각 — node backoff-check.mjs [초=70]   (컨테이너 web 5173)
import puppeteer from '/Users/hubilon_map/orca/projects/bim-platform/web/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const secs = Number(process.argv[2] ?? 70)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'] })
const p = await b.newPage(), t0 = Date.now(), at = []
p.on('request', r => { if (r.url().endsWith('/stream')) at.push(Math.round((Date.now() - t0) / 1000)) })
await p.goto('http://localhost:5173/#/models/00000000-0000-0000-0000-000000000000/monitor')
await new Promise(r => setTimeout(r, secs * 1000))
console.log(`/stream 요청 ${at.length}회 — ${at.join(', ')} 초`)
await b.close()
```

Run:
```bash
SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew bootJar -x test -q && cp build/libs/api-0.0.1-SNAPSHOT.jar $SP/apijar/app.jar && docker build -q -t bim-platform-api $SP/apijar && cd .. && docker compose up -d --no-build --force-recreate api && for i in $(seq 1 60); do curl -sf localhost:8080/api/projects >/dev/null && break; sleep 2; done
docker compose build web && docker compose up -d --no-build --force-recreate web && sleep 3
node $SP/backoff-check.mjs 70
docker compose restart api && for i in $(seq 1 60); do curl -sf localhost:8080/api/projects >/dev/null && break; sleep 2; done && docker compose logs api --since 2m | grep -c 'marked as broken'
```
Expected: `/stream 요청 4회 — 0, 5, 15, 35 초`(±1~2초. 계획 작성 중 변경 전 컨테이너로 30초 측정: `6회 — 0, 5, 10, 15, 20, 25 초`), 재시작(정상 종료) 로그 WARN `0`

- [ ] **Step 10: api 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git add api/src/main/java/com/bim/api/Notifier.java && git commit -m "api: Notifier 알림 대기 1초 + 종료 시 join(2초) — 풀 종료가 LISTEN 연결을 끊어 나던 Hikari WARN 제거

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 부하 시나리오 측정·대시보드 촬영·문서

**Files:**
- Modify: `README.md`, `docs/screen-design.md`, `docs/superpowers/specs/2026-09-30-r2-3-observability-design.md`
- Create: `images/15-grafana.png`; 저장소 밖 `$SP/grafana-shot.mjs`, `$SP/r2-3-{a,b,c}.txt`, `$SP/r2-3-waits-{a,b,c}.txt`, `$SP/r2-3-limit.txt`

**Interfaces:**
- Consumes: Task 1~4 전부 배포된 상태, `load/run.sh` 표 한 행, Grafana `bim-api`

- [ ] **Step 1: 사전 점검** — obs 기동·sim 정지·열린 탭·시계·대상 수·위생 기준선

Run:
```bash
SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform
docker compose ps --format '{{.Service}} {{.Status}}' | sort
curl -s localhost:8080/actuator/prometheus | grep -E '^(bim_sse_subscribers|system_cpu_count)'
for i in 1 2 3; do PGPASSWORD=bim psql -h 127.0.0.1 -U bim -d bim -qtA <<'EOF'
\! perl -MTime::HiRes -e 'printf "%.1f\n", Time::HiRes::time()*1000'
select round(extract(epoch from clock_timestamp())*1000, 1);
\! perl -MTime::HiRes -e 'printf "%.1f\n", Time::HiRes::time()*1000'
EOF
done | paste - - - | awk '{printf "시계 차(db-host) %.1f ms ±%.1f\n", $2-($1+$3)/2, ($3-$1)/2}'
curl -s localhost:8080/api/models/32d1ef4f-d6b0-439d-9649-645e47e196b2/work-orders | jq '[.[] | select(.status != "DONE" and .ifcClass == "IfcSensor" and ((.elementName // "") | test("감지기"))) | .globalId] | unique | length'
```
그 다음 Task 3 Step 7 의 위생 SQL 을 실행해 `$SP/r2-3-hygiene-before.txt` 로 다시 저장.
Expected: `prometheus`·`grafana` Up, `sim`·`tunnel` 없음, `bim_sse_subscribers 0.0`(브라우저 탭은 닫아 둔다 — 탭의 재조회가 부하에 섞임), `system_cpu_count 10.0`, 시계 차 세 줄 모두 |차| < 5 ms(계획 작성 중 0.0·0.4·0.1 ms), 대상 감지기 `14`. 시계 차가 5 ms 를 넘으면 종단 지연이 그만큼 치우친다 — README 환경 줄에 적는다

- [ ] **Step 2: 예열** (재배포 직후 JIT — 계획 작성 중 첫 판만 PATCH p95 2.2 s·DB 풀 대기 377, 둘째 판 36 ms·0)

Run: `cd /Users/hubilon_map/orca/projects/bim-platform && DURATION=20s load/run.sh 20 10 2>&1 | tail -3`
Expected: 표 한 행·되돌림 줄. 결과는 버린다

- [ ] **Step 3: 시나리오 (a) M=100·R=20** — DB 대기·CPU 표본을 함께

Run:
```bash
SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; cd /Users/hubilon_map/orca/projects/bim-platform
sample() { sleep 15; for i in $(seq 8); do date +%T; docker stats --no-stream --format '{{.Name}} {{.CPUPerc}}' bim-platform-api-1 bim-platform-postgis-1; docker compose exec -T postgis psql -U bim -d bim -tAc "SELECT coalesce(wait_event_type, 'CPU') || ':' || coalesce(wait_event, '-'), count(*) FROM pg_stat_activity WHERE datname = 'bim' AND state = 'active' AND pid <> pg_backend_pid() GROUP BY 1 ORDER BY 2 DESC"; sleep 3; done; }
sample > $SP/r2-3-waits-a.txt 2>&1 & load/run.sh 20 100 2>&1 | tee $SP/r2-3-a.txt; wait
```
Expected: `ready 100/100 (… ms, 워커 1)`, JSON 의 `elu` < 0.8, `끊긴 구독 정리 … s`, 표 한 행 `| 20 (≈20) | 100 | … |`, 되돌림 줄

한계 신호(하나라도 있으면 다음 시나리오를 돌리지 않고 Step 6 으로): PATCH p95 ≥ 500 ms(k6 종료 코드 99) · 달성 < 0.95R · 누락 > 0.00 % · 종단 p95 ≥ 1,000 ms · 서버 지연 p95 ≥ 500 ms. `elu` ≥ 0.8 이면 한계가 아니라 부하기 포화 — `sse-clients.mjs` 의 `PER_WORKER` 를 100 으로 줄여 그 시나리오를 다시 돌리고 그 변경을 `load:` 커밋으로 남긴다

- [ ] **Step 4: 시나리오 (b) M=500·R=100** — (a) 에 한계 신호가 없을 때만

Run: Step 3 의 명령 블록 전체(`SP=…; cd …`·`sample()` 정의 포함 — 셸 상태가 이어지지 않는다)에서 `waits-a`→`waits-b`, `load/run.sh 20 100`→`load/run.sh 100 500`, `r2-3-a.txt`→`r2-3-b.txt`
Expected: `ready 500/500 (… ms, 워커 3)`, 판정은 Step 3 과 같다

- [ ] **Step 5: 시나리오 (c) M=1000·R=200** — (b) 에 한계 신호가 없을 때만

Run: Step 3 의 명령 블록 전체에서 `waits-a`→`waits-c`, `load/run.sh 20 100`→`load/run.sh 200 1000`, `r2-3-a.txt`→`r2-3-c.txt`
Expected: `ready 1000/1000 (… ms, 워커 5)`. 계획 작성 중 임시 스택(요소 7개 — 파생값 집계가 가벼움, 예열 후)은 `| 200 (199.9) | 1000 | 36 ms | 0.0 % | 21 · 41 · 60 ms | 26 ms | 0.00 % | 2.9 | 0 |`(워커 4개일 때), 라이브(요소 1,613·감지기 160여 개 집계)는 더 무겁다

- [ ] **Step 6: 한계·병목 정리** — `$SP/r2-3-limit.txt` 에 세 줄

1. 멈춘 시나리오(또는 "(c) 까지 한계 신호 없음")와 그 판의 신호 값
2. 근거: 그 판 표 행의 `API CPU 최대`(가용 `system_cpu_count` 대비)·`DB 풀 대기 최대`, `$SP/r2-3-waits-*.txt` 에서 가장 많은 대기(`Lock:transactionid`·`Lock:tuple` = 행 잠금 경합, `CPU:-` = DB 연산, `Client:ClientRead` = 앱 쪽 대기)와 api·postgis 컨테이너 CPU %
3. 병목 한 구절 — 판단 규칙: DB 행 잠금 대기가 가장 많으면 "PATCH 마다 가상 건물 파생값(`StatusService.demoAggregates` — FACP·주차 집계 행 UPDATE)이 같은 행을 잠가 직렬화", DB 풀 대기 > 0 이고 DB 대기가 적으면 "DB 풀(10 + LISTEN 1)", API CPU ≈ 가용 코어면 "API CPU(구독자 × 이벤트 팬아웃 전송)", postgis CPU 가 가장 높으면 "DB CPU". nginx 는 우회했으므로 후보가 아니다
대시보드에서 같은 구간을 열어(`http://localhost:3001`, 시간 범위 now-20m) DB 풀·CPU·이벤트 지연 패널이 위 판단과 맞는지 확인

- [ ] **Step 7: 대시보드 촬영** — `$SP/grafana-shot.mjs`

```js
// Grafana 대시보드 촬영(R2-3) — node grafana-shot.mjs <출력 png> [base=http://localhost:3001] [from=now-15m]
import puppeteer from '/Users/hubilon_map/orca/projects/bim-platform/web/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js'
const [out, base = 'http://localhost:3001', from = 'now-15m'] = process.argv.slice(2)
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal'], defaultViewport: { width: 1500, height: 950 } })
const p = await b.newPage()
p.on('pageerror', e => console.log('pageerror:', e.message))
await p.goto(`${base}/d/bim-api/bim-api?orgId=1&kiosk&theme=dark&from=${from}&to=now`, { waitUntil: 'networkidle0', timeout: 60000 })
await p.waitForFunction(() => document.querySelectorAll('[data-viz-panel-key], .react-grid-item').length >= 9, { timeout: 30000 })
await new Promise(r => setTimeout(r, 3000))   // 패널 쿼리·렌더 마무리
const noData = await p.evaluate(() => [...document.querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.textContent?.trim() === 'No data').length)
await p.screenshot({ path: out })
console.log(`${out} · 'No data' 패널 ${noData}`)
await b.close()
```

Run: `SP=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/0572893b-aebc-47eb-af74-6b5e7bd4be77/scratchpad; node $SP/grafana-shot.mjs /Users/hubilon_map/orca/projects/bim-platform/images/15-grafana.png http://localhost:3001 now-20m`
Expected: `… 'No data' 패널 0`. Read 로 이미지를 열어 9패널 3×3 이 잘림 없이 보이고, 시나리오마다 요청률·알림률·구독자 봉우리가 있는지 확인(계획 작성 중 임시 스택 촬영본 `$SP/r23/grafana-test3.png` 와 같은 배치). 봉우리가 범위 밖이면 `now-30m` 으로 다시

- [ ] **Step 8: 위생 확인**

Run: Task 3 Step 7 의 위생 SQL → `$SP/r2-3-hygiene-after.txt`, `diff $SP/r2-3-hygiene-before.txt $SP/r2-3-hygiene-after.txt`
Expected: 출력 없음. 차이가 있으면 `run.sh` 기록 디렉터리(`되돌림` 줄의 경로)의 `snapshot.tsv` 로 원인을 찾아 되돌린 뒤 진행

- [ ] **Step 9: README** — 줄 단위(기존 → 교체). `{…}` 는 `$SP/r2-3-{a,b,c}.txt`·`r2-3-limit.txt`·Step 1 출력 실측값으로 전부 치환(남기지 않는다). 기존 문장은 R2-2 병합 후 README 기준

① 빠른 실행 — 기존:
```markdown
- 웹 화면: [http://localhost:5173](http://localhost:5173)
```
교체:
```markdown
- 웹 화면: [http://localhost:5173](http://localhost:5173)
- 관측성: `docker compose --profile obs up -d` → Grafana [http://localhost:3001](http://localhost:3001)(익명 보기, 대시보드 BIM API)·Prometheus 127.0.0.1:9090. 부하 한 판 `load/run.sh <초당 PATCH> <SSE 구독자>`
```

② 규모 측정 절 끝(= `## 빠른 실행` 제목 바로 앞) — 기존:
```markdown
## 빠른 실행
```
교체:
```markdown
| 부하 (R2-3) — 초당 PATCH (달성) | SSE 구독자 | PATCH p95 | PATCH 실패 | 이벤트 지연 p50 · p95 · p99 (종단) | 서버 지연 p95 | 누락 | API CPU 최대 (코어) | DB 풀 대기 최대 |
|---|---|---|---|---|---|---|---|---|
{r2-3-a.txt 의 표 행}
{r2-3-b.txt 의 표 행 — 돌리지 않았으면 이 줄 삭제}
{r2-3-c.txt 의 표 행 — 돌리지 않았으면 이 줄 삭제}

- 부하: `load/run.sh R M` — k6(compose 망에서 api:8080 직접, nginx 레이트 리밋 우회)가 열린 작업지시가 있는 감지기 {대상 수}개에 `PATCH …/status` 초당 R건 60초, Node 워커 스레드(200개씩)가 SSE 구독자 M개. 끝나면 요소 상태 스냅숏 복원·부하 이벤트 삭제
- 종단 지연 = 구독자 수신 − 트리거 시각 `t`(V10, `clock_timestamp()`). 서버 지연 = `t` → Notifier dispatch(`bim_notify_lag_seconds`). 누락 = 1 − 받은 이벤트 / (성공 PATCH × 구독자)
- 한계: {r2-3-limit.txt 1·3줄을 한 줄로 — 멈춘 시나리오·신호 값 → 병목, 근거 지표 2~3개}
- 끊긴 SSE 정리 {세 판의 '끊긴 구독 정리' 값 범위} s — 서버는 하트비트(20초) 전송이 실패해야 구독을 뺀다. SSE 구독자 게이지로 처음 드러남
- 환경: 부하기(k6·Node)와 API 가 같은 MacBook(Docker VM {system_cpu_count}코어) — 절대값보다 시나리오 간 추세

![Grafana — 부하 시나리오 동안 요청률·p95·이벤트 지연·SSE 구독자·DB 풀·CPU](images/15-grafana.png)

## 빠른 실행
```

③ 아키텍처 — 기존:
```markdown
- Docker Compose: `web`, `api`, `ifc-worker`, `postgis`, `minio`
```
교체:
```markdown
- Docker Compose: `web`, `api`, `ifc-worker`, `postgis`, `minio` (+ profile `demo`: `sim`·`tunnel`, `obs`: `prometheus`·`grafana`)
```
기존:
```markdown
- 탭 여러 개 운영 시 앞단 프록시는 HTTP/2 권장 — HTTP/1.1 은 호스트당 6연결, 열린 탭마다 SSE 1개 점유. 숨은 탭은 스트림 닫음, 다시 보이면 재연결·재조회
```
교체:
```markdown
- 탭 여러 개 운영 시 앞단 프록시는 HTTP/2 권장 — HTTP/1.1 은 호스트당 6연결, 열린 탭마다 SSE 1개 점유. 숨은 탭은 스트림 닫음, 다시 보이면 재연결·재조회. 삭제된 모델의 스트림(404) 재시도는 5·10·20·40·60초
- 관측성: Micrometer → `/actuator/prometheus`(compose 내부망·호스트 127.0.0.1 만, nginx 404) → Prometheus 5초 → Grafana 대시보드(요청률·p95·이벤트 지연·SSE 구독자·알림률·DB 풀·JVM·CPU). 알림 payload 의 트리거 시각 `t` 가 지연 기준
```

④ 기술 스택 — 기존:
```markdown
- **Quality / Ops:** JUnit 5, Testcontainers, Python unittest, Vitest, oxlint, GitHub Actions, Docker Compose, nginx
```
교체:
```markdown
- **Quality / Ops:** JUnit 5, Testcontainers, Python unittest, Vitest, oxlint, GitHub Actions, Docker Compose, nginx, Micrometer·Prometheus·Grafana, k6
```

⑤ 개발·테스트 명령 — 기존:
```bash
(cd samples/gen && python3 -m unittest test_mep_plan)
```
교체:
```bash
(cd samples/gen && python3 -m unittest test_mep_plan)
node --test load/sse-clients.test.mjs   # 부하 집계(분위수·표 한 행)
```

⑥ 저장소 구조 — 기존:
```text
samples/      IFC 안내, 가상 건물 생성기(gen_mep.py·mep_plan.py), BMS 시뮬레이터
```
교체:
```text
samples/      IFC 안내, 가상 건물 생성기(gen_mep.py·mep_plan.py), BMS 시뮬레이터
obs/          Prometheus 수집·Grafana 데이터소스·대시보드 (compose profile obs)
load/         부하 측정 — k6 상태 PATCH·SSE 구독자·한 판 실행과 되돌리기
```

⑦ 현재 범위 — 기존(R2-2 가 넣은 줄):
```markdown
- **기술 심화(09-29~30)** — 실시간 푸시(LISTEN/NOTIFY → SSE), 초대형 모델 3D Tiles(층 타일 스트리밍)
```
교체:
```markdown
- **기술 심화(09-29~30)** — 실시간 푸시(LISTEN/NOTIFY → SSE), 초대형 모델 3D Tiles(층 타일 스트리밍), 관측성(Prometheus·Grafana)·부하 측정(k6·SSE 구독자 최대 {돌린 최대 M}개)
```

⑧ 다음 단계 — 기존(R2-2 가 바꾼 줄):
```markdown
- **다음** — 타일 압축(meshopt)·층 안 LOD, COBie 정식 xlsx, 계정별 권한 관리(지금은 nginx Basic 단일 계정), 외부 공개 배포 구성(TLS·도메인)
```
교체:
```markdown
- **다음** — {r2-3-limit.txt 3줄 병목의 조치 한 구절}, 끊긴 SSE 즉시 정리, 타일 압축(meshopt)·층 안 LOD, COBie 정식 xlsx, 계정별 권한 관리(지금은 nginx Basic 단일 계정), 외부 공개 배포 구성(TLS·도메인)
```
(⑦⑧ 의 기존 줄이 R2-2 결과와 다르면 `grep -n '기술 심화\|\*\*다음\*\*' README.md` 로 찾은 그 줄 끝에 같은 구절을 붙인다)

- [ ] **Step 10: `docs/screen-design.md`** — 9절 표의 마지막 행 뒤 — 기존(R2-2 가 넣은 행):
```markdown
| 3D Tiles 분할·백필 | `ifc-worker/worker/tiles.py` · `backfill.py` → 뷰어 `web/src/viewer/tiles.ts` | `tests/test_tiles.py` · `tiles.test.ts` — tileset 상자 Z-up, 뷰어 Y-up |
```
교체:
```markdown
| 3D Tiles 분할·백필 | `ifc-worker/worker/tiles.py` · `backfill.py` → 뷰어 `web/src/viewer/tiles.ts` | `tests/test_tiles.py` · `tiles.test.ts` — tileset 상자 Z-up, 뷰어 Y-up |
| 관측성 지표·대시보드 | `api/…/Notifier.java`(구독자·알림 수·이벤트 지연) · `V10__notify_time.sql`(payload `t`) · `obs/prometheus.yml` · `obs/grafana/`(데이터소스·`dashboards/bim.json`) | `docker compose --profile obs up -d` → Grafana 127.0.0.1:3000. `/actuator/prometheus` 는 내부망만(nginx 404) |
| 부하 측정 | `load/run.sh`(한 판·되돌리기) · `status-burst.js`(k6) · `sse-clients.mjs`(SSE 구독자·집계) | `sse-clients.test.mjs` — 분위수·표 한 행 |
```
(기존 행 문구가 다르면 `grep -n '3D Tiles 분할' docs/screen-design.md` 의 그 행 뒤에)

- [ ] **Step 11: 스펙 — 구현 결정** — `docs/superpowers/specs/2026-09-30-r2-3-observability-design.md` 끝에 추가

```markdown

## 9. 구현 결정 (계획·실측)

- 요청 퍼센타일: 앱 계산 분위수 대신 `percentiles-histogram` 버킷 → `histogram_quantile` — 엔드포인트·구간 합산 가능
- API CPU: `process_cpu_time_ns_total` 변화율(코어 수) — `process_cpu_usage` 는 순간값
- 대시보드 JVM 패널 둘(스레드·힙) — 단위가 다름. 요청률·p95 에서 SSE(`/stream`·`/events`) 제외 — 연결 수명이라 지연 왜곡
- SSE 구독자 스크립트: 워커 스레드당 200개 — 한 스레드 1,000개·초당 200건이면 부하기가 먼저 포화(CPU 0.9)
- 되돌리기: 상태 PATCH 대신 요소 `Pset_BimStatus` 스냅숏 SQL 복원 + 구간 STATUS 이벤트 삭제 — 파생값(FACP·주차 집계)·UpdatedAt 까지 그대로, 작업지시 규칙 재실행 없음
- 끊긴 SSE 구독 정리가 하트비트 몇 회 뒤(약 {…} s) — 구독자 게이지로 발견. `run.sh` 가 판 사이에 대기, 즉시 정리는 다음 단계
- Grafana 프로비저닝은 하위 디렉터리째 마운트 — 파일 하나 마운트는 편집기가 바꿔 쓰면 끊기고, provisioning 전체 마운트는 plugins·alerting 없음 오류
```

- [ ] **Step 12: 커밋**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform && git status --short && git add README.md docs/screen-design.md docs/superpowers/specs/2026-09-30-r2-3-observability-design.md images/15-grafana.png && git commit -m "docs: 부하 측정(초당 PATCH × SSE 구독자 — PATCH p95·이벤트 지연·누락·CPU·한계)·관측성 실행·Grafana 화면·구현 결정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
먼저 치환 누락 확인 — Run: `cd /Users/hubilon_map/orca/projects/bim-platform && grep -n '{r2-3\|{대상 수}\|{세 판\|{돌린 최대\|{system_cpu_count}\|{…}' README.md docs/superpowers/specs/2026-09-30-r2-3-observability-design.md` → 출력 없음
Expected(`git status`): `docs/learning/`·`…-review.md` 는 `??` 로 남고 스테이징되지 않음

---

## 자기 검토

- 스펙 대조
  - 1절 현재 상태(노출 health 만·nginx 404·지표 없음·V8 수정 금지·레이트 리밋·404 고정 재시도) → Task 1(노출·V10)·Task 3(api:8080 직접)·Task 4
  - 2절 의존성·노출·히스토그램·커스텀 지표 3종·V10(`notify_model_status` 포함)·웹 `t` 무시 → Task 1 (Step 0 에서 V9 함수 이름·본문 확인 — 계획 작성 중 `feat/r2-2-tiles` 커밋 16ea6d7 의 V9 가 `notify_model_status()` + `{m,k:'job',s}` 임을 확인, 웹은 변경 없음)
  - 3절 profile `obs`·5초·127.0.0.1:9090/3000·익명 Viewer·프로비저닝·패널 목록·한 줄 실행 → Task 2 (JVM 을 두 패널로 — 스펙 9절 결정)
  - 4절 `status-burst.js`(셋업 대상 조회·constant-arrival-rate·60초·p95 임계값)·`sse-clients.mjs`(이벤트 수·`t` 기준 p50/p95/p99·누락)·`run.sh R M` 한 줄 표·시나리오 (a)(b)(c)·한계 시 멈춤·데이터 영향(대상 한정·되돌리기) → Task 3·5
  - 5절 백오프 5·10·20·40·60 + 연결 시 초기화, `getNotifications(1_000)` + `join(2s)` → Task 4
  - 6절 README 부하 표·관측성 한 줄·`images/15-grafana.png`·screen-design 파일 지도 → Task 5
  - 7절 jar 교체·이미지 pull(실패 시 보고) → Global Constraints·Task 1·2. 8절 제외 항목(OTel·Loki·워커 지표·Alertmanager)은 손대지 않음
- 자리표시자: 코드 단계에 TBD·생략 없음. 중괄호 `{…}` 는 Task 5 README·스펙의 실측 치환 지시뿐(R2-1·R2-2 와 같은 방식), 치환 누락 grep 을 커밋 전에 둠
- 이름·형식 일치: Micrometer `bim.sse.subscribers`/`bim.notify.events`/`bim.notify.lag` ↔ Prometheus `bim_sse_subscribers`/`bim_notify_events_total`/`bim_notify_lag_seconds_*` ↔ 대시보드 쿼리·`sse-clients.mjs` 쿼리·`run.sh subs()`·NotifyTests. k6 태그 `name:patch` ↔ 요약 키 `http_req_duration{name:patch}`·`http_req_failed{name:patch}`·`checks.passes`·`iterations.rate` ↔ `row()`(k6 2.3.0 `--summary-export` 실제 출력으로 확인). 데이터소스 uid `prom` ↔ 패널 datasource, 대시보드 uid `bim-api` ↔ 촬영 URL·`GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH`. `RETRY_MS`·`RETRY_MAX_MS` ↔ stream.test.ts. `POLL_MS` 는 Task 4 에서만 추가, Task 1 판은 `HEARTBEAT_MS / 2`
- 계획 검증(저장소 밖 복사본 `$SP/r23`, 저장소·git 무변경):
  - api: `micrometer-registry-prometheus` 호스트 해석, V9(실제 R2-2 본)+V10 으로 Testcontainers 전체 26개 통과. Task 1 상태(구 `stop`) 26개 통과 + 종료 WARN 1, Task 4 상태 26개 + WARN 0. 새 테스트는 구현 전 3건 실패(`t` null ×2, `MeterNotFoundException`)
  - 임시 스택(postgis·jar·prometheus·grafana 컨테이너, 시드 감지기 4개): `/actuator/prometheus` 에 커스텀 3종·`http_server_requests_seconds_bucket`·Hikari·`process_cpu_time_ns_total`·`system_cpu_count` 노출, 대시보드 쿼리 15개 success, 프로비저닝 오류 로그 0, 촬영 9패널 'No data' 0
  - 부하 도구: `node:test` 3개 통과, run.sh 스모크(5/s × 20)·(20/s × 1,000)·(200/s × 1,000) 완주 — 누락 0 %, 스냅숏 되돌림 후 상태·이벤트·작업지시 동일, ulimit 256 셸에서도 1,000 연결(노드가 한도 상향)
  - 발견: 끊긴 SSE 구독이 서버에서 76~91초 남음(구독자 게이지) → run.sh 판 사이 대기, README·스펙에 기록. 재배포 직후 첫 판은 JIT 로 PATCH p95 2.2 s → 예열 단계. 한 스레드 1,000 구독은 부하기 포화 → 워커 분할
  - 이미지 pull·버전 확인(prometheus 3.15.0·grafana 13.2.3·k6 2.3.0), 호스트↔Docker VM 시계 차 ±1 ms, 404 재시도 확인 스크립트는 현 컨테이너(변경 전)에서 5초 간격 재현
