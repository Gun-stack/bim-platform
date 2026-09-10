# 3D 뷰어 키보드 단축키 — 설계

- 날짜: 2026-09-10
- 범위: `#/models/:id` 뷰어(`web/src/viewer/`) 한 곳. 다른 페이지는 3D 없음
- 목적: 마우스 없이 카메라 조작 + 툴바 액션 전부. 일반 3D 툴(Blender·Autodesk Viewer·Navisworks) 관례와 동일한 키

## 현재 상태

- 키 처리: `scene.ts:321 onKey` 와 `ui.ts useEsc` 가 Escape 만. 나머지 키 전부 미점유
- 카메라: three.js `OrbitControls`, `PerspectiveCamera`, rAF 루프에서 `controls.update()`
- 액션 진입점: 툴바 `Viewer.tsx` `<Tool>`, 우클릭 메뉴 `menuItems()`, NavCube. 상태는 `Scene3D` 인스턴스 + `Viewer.tsx` useState

## 키맵

| 구분 | 키 | 동작 | 호출 |
|---|---|---|---|
| 이동 | `W` `S` | 앞 / 뒤 | scene 루프 |
| 이동 | `A` `D` | 좌 / 우 | scene 루프 |
| 이동 | `Q` `E` | 아래 / 위 | scene 루프 |
| 이동 | `Shift` + 위 키 | 4배속 | scene 루프 |
| 회전 | `←` `→` `↑` `↓` | 타깃 중심 궤도 회전 | scene 루프 |
| 줌 | `+`(`=`) `-` | 누르고 있는 동안 타깃 쪽 접근 / 후퇴 (초당 약 3배) | scene 루프 |
| 뷰 | `Home` | 홈 뷰 | `preset('home')` |
| 뷰 | `F` | 선택 요소에 맞춤, 없으면 전체 | `fit()` |
| 뷰 | `1` `3` `7` | 정면 / 측면 / 평면 (Blender 넘패드 관례, 상단 숫자키) | `preset(...)` |
| 표시 | `I` | 격리 토글 (선택 외 반투명) | `setFocus` |
| 표시 | `H` | 선택 숨김 | `hideSelected` |
| 표시 | `Shift+H` | 선택만 보기 토글 | `soloSelected` |
| 표시 | `Alt+H` | 숨긴 것 모두 표시 + 격리·솔로 해제 | 메뉴 "숨긴 것 모두 표시" 와 동일 |
| 도구 | `C` | 단면 토글 | `setClip` |
| 도구 | `M` | 측정 토글 | `setMeasuring` |
| 도구 | `N` | 스냅 토글 | `setSnap` |
| 도구 | `G` | 그리드 토글 | `setOpts(grid)` |
| 도구 | `P` | 속성별 색상 토글 | `setColorMode` |
| 기타 | `L` | 현재 화면 링크 복사 | `share` |
| 기타 | `?` | 단축키 안내 오버레이 토글 | overlay state |
| 기타 | `Esc` | 선택 해제 · 측정 종료 · 안내 닫기 (기존 유지) | 기존 |

## 동작 규칙

- 무시 조건: 이벤트 target 이 `input`/`textarea`/`select`/`contentEditable`, 또는 `Ctrl`/`Cmd` 눌림 (브라우저 단축키 보존). `Alt+H` 만 Alt 허용
- 키 판정: `e.code` 기준 (`KeyW`, `Digit1`, `ArrowLeft` …). 한글 입력 상태·Alt 조합 특수문자에 영향 없음. `?` 와 `+` 는 `e.key` 로 판정
- 이동 속도: 모델 bounds 대각선 × 0.25 m/s. Shift 4배. 회전 90°/s. 프레임 dt 는 `performance.now()` 차이
- 이동 = 카메라와 `controls.target` 을 같은 벡터로 이동 (비행). 방향은 카메라 기준 forward/right, 상하는 월드 Y
- 회전 = 타깃 기준 구면 좌표(theta/phi) 증감, phi 는 OrbitControls 기본 범위 안에서 clamp
- 창 `blur` 시 `keys` Set 초기화 (키 누른 채 탭 전환 → 무한 비행 방지)
- 리스너: `window` keydown/keyup. `Scene3D.dispose()` 와 effect cleanup 에서 제거

## 컴포넌트

- `web/src/viewer/scene.ts`
  - `keys = new Set<string>()`, `onKey` 를 keydown/keyup 공용으로 확장. Escape 처리 유지
  - 루프에 `fly(dt)` 추가: keys 를 읽어 이동·회전·줌 적용 후 `controls.update()`
  - 공개 API 추가 없음
- `web/src/viewer/keys.tsx` (신규)
  - `KEYS`: 위 표를 상수로 (구분·키·설명). 오버레이와 툴팁 표기의 단일 출처
  - `Shortcuts` 오버레이: 캔버스 중앙 반투명 카드, 표 렌더, 바깥 클릭·Esc·`?` 로 닫힘
- `web/src/viewer/Viewer.tsx`
  - keydown effect 하나: 단발 액션 키 → 기존 핸들러 호출. 핸들러는 ref 로 최신값 참조 (effect 재등록 방지)
  - `useState showKeys`. 속성 탭의 "단축키 ?" 텍스트 클릭 → 오버레이 열기
  - 각 `<Tool>` 에 `keys` prop 전달
- `web/src/viewer/chrome.tsx`
  - `Tool` 에 `keys?: string` 추가. 툴팁에 `<kbd>` 로 표기
- `README.md`
  - 단축키 표 추가 (불릿·명사형 규칙)

## 검증

- `web` 에서 `tsc --noEmit` + lint 통과
- 헤드리스 Chrome 스크립트 1개: 뷰어 로드 → `W` keydown 500ms → `getView()` 카메라 위치 변화 확인, `7` → 카메라 y 가 타깃 위, `H` → 선택 요소 숨김. 기존 README 촬영 스크립트 방식
- 단위 테스트 프레임워크 추가 없음

## 생략

- `Ctrl+A` 전체 선택: 수천 요소 외곽선 생성으로 멈춤
- 키 리바인딩 설정 UI
- 넘패드 별도 매핑 (`Numpad1/3/7` 은 `Digit` 과 함께 인식, 넘패드 `+`/`-` 는 미지원)
- OrbitControls `listenToKeyEvents`: 방향키가 팬이라 요구(회전)와 다름
