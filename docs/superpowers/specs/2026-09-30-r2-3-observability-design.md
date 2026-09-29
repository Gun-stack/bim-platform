# R2-3 관측성·부하 측정 — 상세 설계

- 날짜: 2026-09-30
- 로드맵: `2026-09-29-round2-tech-depth-design.md` 5절
- 목적: R2-1(실시간 푸시)·R2-2(3D Tiles)가 만든 구조를 **지표로 보이고 한계를 수치로** — "상태 이벤트 초당 N건 × 관제 화면 M개에서 이벤트 지연 p95 X ms"
- 진행 방식: 사용자 "중지 없이 끝까지" — 세부 결정은 이 문서에 이유와 함께

## 1. 현재 상태

- Actuator 는 있으나 노출은 `health` 만, Prometheus 레지스트리 없음
- nginx 가 외부 `/actuator/` 를 404 로 막음 — 수집은 compose 내부망(api:8080)에서만 가능
- R2-1 Notifier: 구독자 수·알림 수·지연을 볼 방법 없음. 트리거 payload 에 발생 시각 없음(V8 은 수정 금지)
- 부하 도구 없음. nginx 레이트 리밋 20r/s·IP — 부하는 api:8080 에 직접
- R2-1 보류 항목: 삭제·미존재 모델 페이지의 `/stream` 404 → 5초 고정 재시도 무한 반복

## 2. 메트릭

- 의존성: `io.micrometer:micrometer-registry-prometheus`(Boot 관리 버전) — 호스트 Gradle 다운로드 확인됨(컨테이너 빌드만 막힘 → jar 교체 배포 그대로)
- 노출: `management.endpoints.web.exposure.include: health,prometheus`, 히스토그램 `http.server.requests` 퍼센타일(p50·p95·p99)
- 커스텀 지표(Micrometer, `Notifier` 에 `MeterRegistry` 주입)
  - `bim_sse_subscribers` 게이지 — `Notifier.subscribers()`
  - `bim_notify_events_total{kind}` 카운터 — dispatch 마다
  - `bim_notify_lag_seconds` 타이머(히스토그램) — 트리거 발생 시각 → dispatch 시각
- Flyway `V10__notify_time.sql`: `notify_op_event()`·`notify_conversion_job()`(+ R2-2 V9 의 model 트리거 함수)를 `CREATE OR REPLACE` 로 다시 만들어 payload 에 `'t', (extract(epoch FROM clock_timestamp()) * 1000)::bigint` 추가 — V8·V9 는 수정 금지라 새 마이그레이션으로 대체
- 웹 쪽 `t` 무시(재조회 신호 규약 불변)

## 3. 대시보드 — compose profile `obs`

- `prometheus`(prom/prometheus): api:8080/actuator/prometheus 5초 스크레이프, 127.0.0.1:9090
- `grafana`(grafana/grafana): 127.0.0.1:3000, 익명 Viewer, 데이터소스·대시보드 JSON 프로비저닝(`obs/` 디렉터리 — 저장소에 포함)
- 대시보드 패널: 엔드포인트별 요청률·p95, 이벤트 지연 p95, SSE 구독자, 종류별 알림률, Hikari active/pending, JVM 스레드·힙, 프로세스 CPU
- 실행: `docker compose --profile obs up -d` 한 줄

## 4. 부하 시나리오 — `load/`

- `load/status-burst.js`(k6, `grafana/k6` 이미지를 compose 네트워크에서 실행 — nginx 레이트 리밋을 거치지 않고 api:8080 직접): 경보 대상 감지기 목록을 셋업에서 조회, `PATCH …/status` 를 초당 R 건(constant-arrival-rate) 60초, 임계값 p95
- `load/sse-clients.mjs`(Node 22 표준 fetch 스트림): SSE 구독자 M 개를 열어 이벤트 수·payload `t` 기준 종단 지연(p50·p95·p99)·누락(기대 대비) 집계 — 호스트에서 `localhost:8080` 직접
- `load/run.sh R M`: 구독자 M 개 기동 → k6 R/s 60초 → 두 결과를 한 줄 표로
- 시나리오: (a) M=100·R=20, (b) M=500·R=100, (c) M=1000·R=200 — 한계가 보이면 거기서 멈추고 병목(풀·스레드·nginx 아님)을 대시보드로 확인
- 데이터 영향: 부하가 만드는 경보는 자동 작업지시를 부른다 → 대상 감지기를 "이미 열린 작업지시가 있는 감지기" 로 한정하고, 끝나면 시작 상태로 되돌리는 정리 단계(스크립트) 포함

## 5. 보류 항목 정리 (R2-1)

- `stream.ts` 재시도: 5초 고정 → 5·10·20·40·60초 상한 지수 백오프, 연결 성공 시 초기화 — 404 모델 탭이 5초마다 치던 것 완화
- `Notifier` 종료 WARN·join 없음(R2-1 경미): `getNotifications(1_000)` 짧은 대기 + `stop()` 에서 `join(2s)` — 테스트 출력 정리

## 6. 측정·문서

- README "규모 측정" 절에 부하 표: 시나리오별 PATCH p95·이벤트 지연 p95·누락률·API CPU
- README 에 관측성 실행 한 줄 + 대시보드 스크린샷 1장(`images/15-grafana.png`)
- screen-design 파일 지도에 `obs/`·`load/`

## 7. 환경 제약

- api 반영은 호스트 bootJar + jar 교체(TLS). prom/grafana/k6 이미지는 도커 pull(가능 확인 필요 — 실패 시 해당 단계 보고)

## 8. 제외

- 분산 추적(OpenTelemetry)·로그 수집(Loki) — 단일 인스턴스
- 워커 메트릭 — 변환 소요는 conversion_job 시각으로 충분
- 알림 규칙(Alertmanager)
