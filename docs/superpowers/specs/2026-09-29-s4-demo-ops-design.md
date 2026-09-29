# S4 데모 운영 — 설계

- 날짜: 2026-09-29
- 로드맵: `2026-09-28-visual-overhaul-design.md` S4 (호스팅 = 이 Mac + Cloudflare Tunnel, 사용자 결정)
- 목적: 링크 하나로 들어온 사람이 "살아 있는 관제 화면"을 1분 안에 이해
- 진행 방식: 사용자 "무중단" 지시 — 결정은 이 문서에. 단 실제 외부 공개(터널 기동)는 사용자가 실행 — 외부 노출은 되돌리기 어려운 행동

## 1. 공개 모드 `DEMO_PUBLIC=1`

- 차단(403 + 한국어 메시지): 업로드 `POST /api/projects/*/models`, 프로젝트 생성, 모델 삭제·재시도, 썸네일·배치 `PUT`, 자산 삭제
- 허용: 조회 전부 + 체험형 쓰기(경보 확인·상태 편집·작업지시 이동·정전 시나리오·점검 기록) — 데모의 핵심이 상호작용이라서. 상태는 시뮬레이터가 계속 바꾸므로 방문자 흔적이 오래 남지 않음
- 구현: nginx `map "$request_method $uri" $demo_block` (http 레벨 파일을 엔트리포인트가 생성) + `location /api/` 의 `if ($demo_block) { return 403 … }`. `return` 만 쓰는 `if` 라 안전
- 화면 신호: 공개 모드면 nginx 가 `GET /api/config` → `{"demo":true}` 직접 응답(평소엔 api 로 넘어가 404 = 데모 아님). 홈은 업로드·삭제 숨김 + "공개 데모" 안내
- 기존 Basic 인증(`BASIC_AUTH_*`)과 독립 — 둘 다 켤 수 있음

## 2. BMS 시뮬레이터 상시

- `bms_sim.py` 에 `--name`(모델 이름으로 id 조회)·`--pool N`(경보·장애 대상 감지기를 시드 고정 N개로) 추가
  - 풀 이유: 전 센서 무작위면 경보마다 작업지시가 생겨 하루 만에 칸반 수백 장. 풀 8개면 작업지시도 8장 안쪽(열린 작업지시 재사용 규칙)
- compose 서비스 `sim` (profile `demo`): ifc-worker 이미지 재사용(파이썬 표준 라이브러리만), `samples/gen` 읽기 전용 마운트, 10초 간격

## 3. Cloudflare Tunnel

- compose 서비스 `tunnel` (profile `demo`): `cloudflare/cloudflared` quick tunnel → `https://*.trycloudflare.com` 임의 URL, 계정 불필요
- 고정 도메인은 Cloudflare 계정의 named tunnel 토큰으로 — README 에 명령만
- 실행: `.env` 에 `DEMO_PUBLIC=1`(+ 선택 Basic 인증) → `docker compose --profile demo up -d` → `docker compose logs tunnel | grep trycloudflare`

## 4. 1분 둘러보기 `Tour.tsx`

- 홈 머리 줄 `1분 둘러보기` 버튼 → 화면 하단 가운데 떠 있는 안내 카드(단계 · 설명 · 이전/다음/닫기), 단계마다 해시 딥링크로 이동
- 읽기 전용 — 공개 모드에서도 동작. 대상은 런타임에 조회: 대표 모델 = 경보+장애가 가장 많은 READY 모델, 경보 요소 = 그 모델의 첫 ALARM, 분전반 = 이름이 `EMDB`/`MDB` 로 시작하는 요소
- 단계
  1. 모니터링 — 총계·24시간 막대·건물 단면의 빨간 칸
  2. 뷰어 경보 포커스 `?sel=&focus=1` — 구역 강조·비콘, 벽 너머 발광
  3. 계통 추적 `?sel=&trace=down` — 하류 흐름 파동 (뷰어에 `trace` 딥링크 신설)
  4. 시설관리 `?sel=` — 경보가 만든 작업지시
  5. 홈 — 실무 IFC 모델들도 같은 흐름
- 상태: `sessionStorage` 단계 번호. 키오스크에선 숨김. `Esc` 로 닫기

## 검증

- 로컬에서 `DEMO_PUBLIC=1` 로 web 재기동: 업로드 POST 403, 모델 GET 200, 상태 PATCH 200, `/api/config` = demo. 끝나면 원복
- 시뮬레이터: `--pool 8` 로 수 분 구동 → 24시간 막대에 발생, 작업지시 증가가 풀 크기 이내
- 투어: 헤드리스로 5단계 넘기며 화면별 스크린샷
- 터널: 이미지·설정만 확인, 기동은 사용자

## 제외

- 주기적 DB 리셋 — 시뮬레이터가 상태를 계속 덮고, 파괴적 쓰기는 막혀 있어 불필요
- 방문자별 격리 세션
