# 첫인상 개선 로드맵 + S1 3D 렌더 품질 — 설계

- 날짜: 2026-09-28
- 목적: 포트폴리오 첫인상. 노출 경로 3개 — GitHub README(GIF·스크린샷), 라이브 데모 URL(이 Mac + Cloudflare Tunnel), 면접 화면 공유 시연
- 이 문서: 전체 로드맵(S1~S5) + S1 상세. S2~S5 는 착수 시 각자 스펙

## 1. 로드맵

| # | 하위 프로젝트 | 핵심 | 주 무대 |
|---|---|---|---|
| S1 | 3D 렌더 품질 | X-ray 재질·AO·톤매핑·외곽선 + 카메라 전환·경보 펄스·계통 흐름·로드 등장 | `web/src/viewer/` |
| S2 | 앱 셸 + 홈 | 공통 상단 바(화면 탭·경보 뱃지), 홈 = 모델 카드 + 3D 썸네일 + 요약 KPI, 데모 진입 버튼 | `App.tsx`·신규 셸 |
| S3 | 모니터링·시설관리 시각화 | 층 스택 다이어그램, 경보 추세 차트, "이상 없음" 칸 축약, 자산 대장 페이지네이션, 트리 라벨 잘림 | `MonitorPage`·`FmPage`·`LeftPanel` |
| S4 | 데모 운영 | Cloudflare Tunnel, 공개 모드(쓰기 차단 또는 주기 리셋), BMS 시뮬 상시, 원클릭 시연 시나리오 | compose·nginx |
| S5 | README·GIF 재촬영 | 전 화면 다크 테마 재촬영(GIF 4개는 아직 라이트) | `images/`·README |

- 순서: S1 → S2 → S3 → S4 → S5 (안→밖). 3D 렌더가 뷰어·홈 썸네일·GIF 전부의 재료라 먼저, 촬영은 마지막 1회
- 이번 라운드 제외: 3D Tiles, COBie xlsx, 계정·권한, 2D 평면도, 모바일 현장 화면

## 2. S1 현재 상태

- 조명: `HemisphereLight` + `DirectionalLight` 1개 (`scene.ts` 생성자). 톤매핑·환경맵·그림자·AO 없음
- 렌더: rAF 루프·`snapshot()`·`stats()` 가 각각 `renderer.render()` 직접 호출
- 재질: GLB 원본(IfcOpenShell 이 IFC 스타일 변환). `gen_mep.py` 는 벽 알파 0.35·덕트 0.7 — 내부 설비를 보려는 의도. 실무 IFC(Duplex 등)는 불투명
- 오버레이: 선택 마젠타(`HIGHLIGHT` + `EdgesGeometry` 외곽선), 호버 외곽선, 포커스 비콘. 모두 `depthTest: false` 그룹
- 병합 모드: 보이는 메시를 재질별로 합침, `apply()` 마다 재구성
- 카메라 이동: `preset`·`lookFrom`·`fitAll`·`setView` 전부 즉시 이동
- 데이터: `abnormal`(gid → 상태, Viewer 5초 폴링), `route.nodes[].depth`·`route.direction`, 요소별 `ifcClass`(`byGid`)

## 3. 렌더 파이프라인

- `renderer.toneMapping = AgXToneMapping`, `scene.environment = PMREM(RoomEnvironment)` — 설비 재질에 은은한 반사. 기존 조명 2개는 세기만 재조정
- `EffectComposer`(MSAA 4× 렌더 타깃): `RenderPass` → `GTAOPass` → `OutputPass`. 톤매핑·sRGB 는 `OutputPass` 담당
- AO 적응: 카메라 이동 중(포인터 드래그·휠·비행 키·전환) GTAO 끔, 멈춘 뒤 150ms 부터 켬
- 단일 진입점 `draw()`: 루프·`snapshot()`·`stats()` 공용 → 독·홈 썸네일도 같은 화질
- 통계: `renderer.info.autoReset = false`, 프레임 시작에 `info.reset()` — 패스 여러 개 합산
- 섹션 박스: `renderer.clippingPlanes` 전역 → GTAO 법선 패스에도 적용되는지 검증 항목
- 그림자 제외: 반투명 건축과 섞이면 어색, 접지감은 AO 담당

## 4. X-ray 재질 체계

- 기본값: 모든 모델에 IFC 분류 기준 적용 (실무 IFC 도 같은 룩)
- `tier(ifcClass)` → `'horizontal' | 'vertical' | 'equipment'`

| 층위 | 대상 클래스 | 표현 |
|---|---|---|
| horizontal | `IfcSlab`·`IfcRoof`·`IfcCovering` | 어두운 반불투명(불투명도 ≈ 0.5) — 층 구분 |
| vertical | `IfcWall`·`IfcWallStandardCase`·`IfcCurtainWall`·`IfcWindow`·`IfcDoor`·`IfcColumn`·`IfcBeam`·`IfcStair`·`IfcStairFlight`·`IfcRamp`·`IfcRampFlight`·`IfcRailing`·`IfcPlate`·`IfcMember` | 거의 투명(≈ 0.1) + 얇은 밝은 외곽선 |
| equipment | 그 외 전부 | 원본 색·불투명 + AO |
| (space) | `IfcSpace` | 기존 `SPACE` 파랑 22% 유지 |

- 외곽선: horizontal·vertical 만 `EdgesGeometry(30°)`. 배관 원통은 면마다 선이 생겨 제외
  - 일반 모드: 메시 자식 `LineSegments` — 가시성 자동 상속
  - 병합 모드: `setMerged` 재구성 때 보이는 외곽선도 한 덩어리로 합침
- 전환: `X` 키 + 좌측 표시 토글 버튼 1개 = X-ray ↔ 원본 재질. `Opts.xray`(기본 true), 기존 `viewer.opts` localStorage 에 함께 저장
- 덮어쓰기 우선순위(기존 `apply()` 순서 유지): 선택 마젠타 > 격리 고스트 > 포커스 구역 > 공간 > 상태·계통·속성 색 > X-ray/원본
- 계통 색 모드의 "구조체 반투명"(`setColors(m, true)` 의 `GHOST`)은 건축 요소에 한해 X-ray 재질로 통일

## 5. 동적 연출

### 카메라 전환

- `flyTo(pos, target, 500ms)`, easeInOutCubic, rAF 루프에서 진행
- 전환 사용: `preset`(Home·1·3·7)·`lookFrom`(NavCube)·`fitAll`(F·더블클릭·맞춤)·딥링크 hashchange 재적용(`?v=`·`?sel&focus`)
- 즉시 이동 유지: 최초 로드의 `?v=` 복원, `setView` 직접 호출 — 공유 링크·검증 스크립트 정확성
- 중단: 포인터 드래그·휠·비행 키 입력 시 즉시
- 전환 중 `getView()`(`L` 링크 복사·작업지시 뷰포인트) = 목적지

### 경보 펄스

- `setPulse(Map<gid, color>)` — Viewer `abnormal` 의 경보 = `T.crit`, 장애 = `T.warn`. 폴링 변경분만 재구성
- 오버레이 메시: 원본 지오메트리 공유 + 행렬 복사, 가산 블렌딩 공유 재질 2개, `depthTest: false` → 건물 전체 뷰에서도 벽 너머로 보임
- 불투명도 0.15 ↔ 0.6, 1.2초 주기 사인
- 숨김·층 필터 요소는 펄스도 숨김 — 판정은 `m.visible` 이 아니라 `visible(gid, kind)` (병합 모드는 원본 메시가 전부 숨김)
- 선택된 요소는 제외 (마젠타 우선)

### 계통 흐름

- `setFlow(nodes: { gid, depth }[], dir: 'up' | 'down')` — 추적 결과 있을 때만, 해제 시 `setFlow([])`
- 파동 방향 = 항상 상류 → 하류. 하류 추적은 depth 증가 방향, 상류 추적은 depth 감소 방향
- depth 단계별 공유 재질 1개씩, 매 프레임 불투명도만 갱신 — 비용이 요소 수와 무관
- 위상 함수 `flowLevel(t, depth, maxDepth, dir)` 순수 함수
- 정전 시나리오 미적용: 정전 API 는 깊이 없이 무전원 집합만 반환 → 기존 회색 표시 유지

### 로드 등장

- GLB 로드 직후 1.2초: 수평 클리핑 평면이 bounds 바닥 → 지붕으로 상승, 층층이 드러남
- 절단 높이를 따라가는 bounds 사각 테두리 선 1개(`T.accent`)
- 단면 박스와 합성: `clippingPlanes = [...섹션, 등장]`, 종료 시 제거
- 등장 중 픽킹은 무시

### 접근성

- `prefers-reduced-motion`: 전환 즉시 이동, 펄스·흐름은 정적 강조(최대 불투명도 고정), 등장 생략

## 6. 파일

- `web/src/viewer/render.ts` (신규) — 컴포저 구성·AO 적응·`draw()`·통계 합산·리사이즈
- `web/src/viewer/xray.ts` (신규) — `tier()`, X-ray 재질 3종, 외곽선 생성. `xray.test.ts`
- `web/src/viewer/fx.ts` (신규) — 전환 보간·펄스·흐름·등장 오버레이. 이징·`flowLevel` 순수 함수, `fx.test.ts`
- `web/src/viewer/scene.ts` — 위 셋 배선. 공개 API 추가 `setXray`·`setPulse`·`setFlow`·`flyTo`. `load(url, classify)` 의 콜백이 `{ kind, ifcClass }` 반환
- `web/src/viewer/Viewer.tsx` — `abnormal` → `setPulse`, `route` → `setFlow`, `opts.xray` → `setXray`, 딥링크 최초/재적용 구분
- `web/src/viewer/keys.ts` — `xray` 액션·`X` 키·`KEYS` 표 한 줄, `keys.test.ts` 보강
- `web/src/viewer/LeftPanel.tsx` — `Opts.xray` + 표시 토글 버튼 1개
- `docs/screen-design.md` 뷰어 절, README 단축키 표 — `X` 추가

## 7. 성능 예산

- 측정: 이 Mac 실브라우저, 기존 렌더 툴팁(`div[title^="렌더:"]`) fps

| 모델 | 조작 중 | 정지(AO 켬) | 로드 시간 증가 |
|---|---|---|---|
| mep-building 1,613요소 | ≥ 55fps | ≥ 30fps | ≤ 0.5s |
| mep-large 5,269요소 (병합) | ≥ 30fps | ≥ 20fps | ≤ 0.5s |

- 미달 시 순서: GTAO 해상도 절반 → 화질 토글 추가

## 8. 검증

- vitest: `tier()` 분류표, `flowLevel` 방향·주기, 이징 경계값, `X` 키 액션
- 헤드리스(puppeteer-core, `--use-angle=metal`, scratchpad 스크립트)
  - 전/후 스크린샷 3장면 × 2모델: 홈 뷰 · 기계실 근접 · 추적 + 펄스 / mep-building · Duplex
  - mep-large fps·draw calls, 등장 중간 프레임 1장
- 회귀
  - `keys-check.mjs` 13항목 — 전환 중 `?v=` 가 목적지인지
  - 병합 draw calls (`merge-probe2.mjs`)
  - 독 스냅샷 썸네일이 새 파이프라인 화질인지
  - 단면 박스 + AO 동시 동작
- 실기기 확인 필요: 펄스·흐름 체감(주기·밝기), reduced-motion
- 배포 확인: `docker compose up -d --build web` 후 5173 에서 재확인
- 완료 보고: 직접 확인 명령 목록 포함

## 9. S1 제외

- 앱 셸·패널 UI·트리 라벨 (S2·S3)
- 정전 흐름 (API 변경 필요)
- 그림자, 블룸
- 3D Tiles
