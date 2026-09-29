# 2라운드 기술 깊이 로드맵 + R2-1 실시간 푸시 — 설계

- 날짜: 2026-09-29
- 목적: 기술 깊이 — 측정 가능한 개선(지연·요청 수·첫 화면 시간·p95)을 README 수치로 남긴다
- 1라운드: `2026-09-28-visual-overhaul-design.md` (첫인상, S1~S5 완료)

## 1. 로드맵

| # | 하위 프로젝트 | 핵심 | 주 무대 |
|---|---|---|---|
| R2-1 | 실시간 푸시 | DB 트리거 `pg_notify` → API 리스너 1개 → 모델별 SSE 팬아웃, 웹 폴링 제거 | api·web·DB |
| R2-2 | 3D Tiles 대용량 | 동별 건축 외피(LOD0) → 층 타일 `REPLACE`, GLB 분할기(워커), 뷰어 자체 순회기 | worker·web |
| R2-3 | 관측성·부하 측정 | Micrometer·Prometheus·Grafana(profile `obs`), k6 + SSE 구독 스크립트, README 수치 | api·compose·`load/` |

- 순서: R2-1 → R2-2 → R2-3 (효과 큰 것 먼저, 사용자 결정)
- 기준선 보존: R2-1·R2-2 는 착수 직전에 간이 스크립트로 "전" 수치를 먼저 잰다. R2-3 가 같은 항목을 공식 도구로 다시 잰다
- 제외: 계정·역할 권한, 운영 실사용 항목(2D 평면도·모바일·구역 차단), 실무 BIM 연동(COBie xlsx·BCF 가져오기·IFC 비교)

## 2. R2-1 현재 상태

- 뷰어·시설관리: `useAlerts` 가 5초마다 `GET /status`
- 모니터링: 5초마다 4개 요청(`/monitor`·`/power`·`/monitor/events`·`/monitor/timeline`)
- 변환 진행률: `GET /models/{id}/events` SSE — 구독자마다 가상 스레드가 1초 간격 DB 조회
- 이벤트 적재: 상태 패치·작업지시는 `op_event` INSERT (`OpEvents`). **정전 전환(`power`)은 요소를 직접 UPDATE — 이력도 알림 원천도 없음**
- 경보 반영 지연: 0~5초(폴링 주기). 세 화면을 1분 열어 두면 API 약 70회

## 3. R2-1 설계

### 이벤트 원천 — DB 트리거

- Flyway `V8__notify.sql`
  - `op_event` AFTER INSERT → `pg_notify('bim', json_build_object('m', model_id, 'k', lower(kind), 'g', global_id, 's', status)::text)`
  - `conversion_job` AFTER UPDATE OF status, progress → `pg_notify('bim', {'m', 'k': 'job', 's', 'p': progress})`
- 트리거인 이유: 워커(Python)가 `conversion_job` 을 직접 갱신 — API 발행만으론 진행률이 빠짐. API·워커·수동 SQL 이 같은 경로. NOTIFY 는 커밋 때만 전달(롤백은 안 샘)
- 정전 전환도 `op_event` 로: `StatusService.power` 가 ATS·발전기 상태를 바꾼 뒤 해당 요소들을 `op_event`(STATUS) 로 적재 — 이력 공백 해소 + 알림 원천 확보
- 기존 V1~V7 은 수정 금지(체크섬)

### API — 리스너 1개 + 팬아웃

- `Notifier` (신규)
  - 풀 밖 전용 JDBC 연결 하나(`DriverManager`, 같은 URL·계정) → `LISTEN bim`
  - 가상 스레드 루프: `PGConnection.getNotifications(10s)` → payload 파싱 → 모델별 구독자에게 전송
  - 연결 끊김: 1→2→4…최대 30초 백오프 재연결. 재연결 후 첫 루프에 구독자 전원에게 `resync` 이벤트(놓친 사이 전체 재조회 신호)
  - 구독자: `ConcurrentHashMap<UUID, Set<SseEmitter>>`, 송신 실패·완료·타임아웃 시 제거
  - 하트비트: 20초마다 SSE 주석(`:hb`) — 죽은 연결 정리, nginx `proxy_read_timeout 300s` 안쪽
- `GET /api/models/{id}/stream` (신규) — SSE, 이벤트 이름 = `status`·`work_order`·`job`·`resync`, data = payload JSON
- `GET /api/models/{id}/events`(변환 진행률) 재구현: 첫 스냅샷 1회 조회 후 `job` 알림마다 모델 행 1회 조회·송신, 종료 상태면 닫음 — 구독자 수만큼 1초 폴링하던 것 제거. 응답 형식·Home 코드 불변

### 웹 — 폴링을 구독으로

- `stream.ts` (신규): 모델별 `EventSource` 1개를 모듈 수준에서 공유(참조 카운트) — 한 페이지에서 여러 훅이 구독해도 연결 1개. 브라우저 기본 재연결
- `useStream(modelId, kinds, fn)` 훅: 이벤트 → 300ms 디바운스 → `fn()`. `resync`·재연결(open) 시에도 `fn()`
- 적용
  - `useAlerts`: 5초 `setInterval` → `useStream(['status','work_order','resync'])` + 60초 안전망 폴링
  - `MonitorPage`: 같은 방식으로 `load()`
  - `FmPage`: `work_order` 알림에 `reload()` — 경보가 만든 작업지시가 칸반에 바로 뜬다
  - 변환 진행률(Home)은 서버 쪽 재구현만으로 해결 — 코드 변경 없음
- 기존 화면 로직(새 경보 플래시·알림음·토스트 diff)은 그대로 — 재조회 계기만 바뀜

### 측정

- 스크립트 `scratchpad/latency.mjs`(저장소 밖, 결과는 README 로)
  - 경보 지연: 모니터링을 연 헤드리스 페이지에서 `PATCH Status=ALARM` 직후부터 해당 행의 경보 표시까지 10회 평균·최대
  - 유휴 요청 수: 뷰어·모니터링·시설관리 세 페이지를 60초 열어 둔 동안 `/api` 요청 수
- 착수 전(현재 main) 한 번, 완료 후 한 번. 목표: 경보 지연 평균 < 0.5초, 유휴 요청 < 10회/분

### 테스트

- api `NotifyTests`(Testcontainers): `op_event` INSERT → 구독 중인 SseEmitter 대역이 `status` 이벤트 수신, `conversion_job` UPDATE → `job`, 정전 전환 → ATS `op_event` 행 생성
- web vitest: `stream.ts` 공유·참조 카운트(가짜 EventSource), 디바운스
- 헤드리스: 위 측정 스크립트가 곧 E2E

### 제외 (R2-1)

- WebSocket — 서버→클라이언트 단방향이면 SSE 로 충분, 프록시·재연결이 단순
- 이벤트 내용으로 화면 부분 갱신 — 알림은 "다시 조회" 신호로만 (정합성 단순, 요청은 이벤트당 1회)
- 여러 API 인스턴스 — LISTEN/NOTIFY 는 인스턴스마다 리스너가 있으면 그대로 동작, 지금은 1개

## 4. R2-2 3D Tiles 대용량 — 개요 (착수 시 상세 스펙)

- 기준 모델: `gen_mep.py --floors 40 --annex 2 --density high` 초대형(약 1만 요소 예상)
- 타일링: 3D Tiles 1.1 `tileset.json` — 루트 = 동별 건축 외피(벽·슬래브·지붕, LOD0), 자식 = 층 타일, `REPLACE`
- 워커: 기존 GLB 를 노드(GlobalId)별로 층 GLB 로 나누는 순수 파이썬 분할기(재테셀레이션 없음, 새 의존성 없음), MinIO `tiles/{id}/`, 모델 응답 `tilesetUrl`
- 뷰어: 자체 순회기(화면 공간 오차 → 층 타일 요청·LRU 해제) — 요소 지정 기능(선택·추적·펄스·포커스)은 `ensureLoaded(층)` 로 유지. 병합 모드는 타일 모드에서 끔
- 측정: 첫 화면까지 시간·메모리·fps, 단일 GLB 대 타일

## 5. R2-3 관측성·부하 — 개요 (착수 시 상세 스펙)

- `micrometer-registry-prometheus`, `/actuator/prometheus` 는 내부망만(nginx 가 `/actuator/` 404)
- 커스텀 지표: SSE 구독자(게이지), NOTIFY 이벤트(종류별 카운터), 이벤트 지연(op_event 생성 → SSE 송신), 변환 잡 소요
- compose profile `obs`: Prometheus + Grafana, 데이터소스·대시보드 JSON 프로비저닝
- `load/`: k6(상태 PATCH N/s, 모니터 조회) + Node SSE 구독자 M개 → README "규모 측정" 표
