# 뷰어 UI/UX 레퍼런스 (2026-08 조사)

> 우리 뷰어(M2+)를 어디까지 끌어올릴지 정하기 위한 참고 목록. "우리 뷰어에 적용" 열이 결론.

## 1. BIM 뷰어 제품·오픈소스

| 이름 | 성격 | 라이선스 | UI 에서 배울 것 | 우리 뷰어에 적용 |
|---|---|---|---|---|
| **xeokit BIMViewer** ([docs](https://xeokit.github.io/xeokit-bim-viewer/docs/), [GitHub](https://github.com/xeokit/xeokit-bim-viewer)) | xeokit SDK 위의 완성형 뷰어. OpenProject 에 내장 | AGPL | 좌측 Explorer 가 **Objects / Classes / Storeys 세 탭**. NavCube, 단면, X-ray, 2D/3D 토글, 우클릭 컨텍스트 메뉴, BCF 뷰포인트 저장/복원, flyToObject | 트리 3모드(우리는 Storeys + 클래스 select 만 있음), NavCube, 컨텍스트 메뉴, 2D 평면 모드. **X-ray = 우리 "격리"** |
| **That Open ui-components** ([GitHub](https://github.com/ThatOpen/engine_ui-components), [docs](https://docs.thatopen.com/Tutorials/Components/)) | Lit 기반 Web Components. `@thatopen/ui`(panel/toolbar/table/tree/input) + `@thatopen/ui-obc`(ModelsList, Classification tree, Properties, Relations) | MIT | 패널을 **접히는 섹션(panel-section)** 으로 쌓는 구조, 툴바 그룹, 속성은 테이블+검색, 분류(Classification) 트리 = 클래스/층/시스템 별 그룹 | 좌측 패널을 접히는 섹션으로(지금은 h4 나열). 속성 패널에 검색창. 프레임워크 무관이라 React 에 직접 써도 됨 — 단 three 버전 pin 문제로 엔진은 안 씀, UI 만 참고 |
| **Speckle viewer** ([docs](https://docs.speckle.systems/developers/viewer), [샌드박스](https://viewer.speckle.systems/)) | Speckle 플랫폼 뷰어, 확장(Extension) 구조 | Apache-2.0 | 선택 → 속성 사이드바, **속성값으로 색칠(Filtering/Coloring)**, 섹션 박스, 측정, 뷰 저장, 모델 diff, 카메라 프리셋 | 후보 E(속성 색상 모드)의 UX 원형. 섹션 "박스"(우리는 수평 1면) |
| **Autodesk APS Viewer** ([docs](https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/), [Assets 샘플](https://github.com/autodesk-platform-services/aps-bim360-assets-viewer)) | 상용 표준. Model Browser + Properties 패널 + 하단 툴바 | 상용 | 하단 **아이콘 툴바**(orbit/pan/zoom, 단면, 측정, 폭발, 설정), 우측 도킹 패널, Level 필터(BIM 360 SpaceFilterPanel = 층/실 트리), 자산 패널과 뷰어 연동 | 툴바를 캔버스 하단 아이콘으로. M4 자산 패널 ↔ 뷰어 연동 패턴 |
| Bentley iTwin Viewer, BIMcollab Zoom, Trimble Connect, Solibri (미검색, 일반 지식) | 상용 | — | 공통점: 좌 트리 / 중앙 3D / 우 속성, 하단 또는 상단 툴바, 층 선택 드롭다운, 뷰포인트(BCF) 목록 | 3열 구조는 이미 동일. 뷰포인트 "목록" 은 M4 |

**공통 관습(사실상 표준)**
- 레이아웃: 좌 트리·필터 / 중앙 캔버스 / 우 속성. 패널 접기·리사이즈 가능.
- 트리 3모드: 공간(Site→Storey→Space) / 클래스(IfcWall …) / 타입(IfcWallType). 체크박스로 표시 토글.
- 툴 상태: 선택 / 숨김 / 격리(X-ray) / 단면 / 측정 은 **모드 버튼**(토글), 아이콘 툴바.
- 카메라: NavCube 또는 뷰큐브, 홈, 핏, 오빗/1인칭 전환.
- 뷰포인트: BCF viewpoint(카메라 + 선택 + 숨김 + 단면) 저장 목록.

## 2. React / Three 쪽 라이브러리

| 이름 | 용도 | 비고 |
|---|---|---|
| **react-resizable-panels** ([shadcn Resizable](https://ui.shadcn.com/docs/components/radix/resizable)) | 패널 드래그 리사이즈, 키보드 지원 | 우리 3열 그리드를 이걸로 바꾸면 끝. 의존성 1개 |
| **react-arborist** ([비교](https://reactscript.com/best-tree-view/)) | 가상화 트리, 체크박스, 드래그 | 요소 수천 개 트리에 필요. 지금(≤600)은 불필요 |
| **shadcn/ui** ([Tree 템플릿](https://www.shadcn.io/template/mrlightful-shadcn-tree-view)) | Radix + Tailwind 컴포넌트 복사 방식 | 패널·버튼·셀렉트·툴팁 통일. Tailwind 도입 비용 있음 |
| **@react-three/fiber + drei** ([R3F](https://github.com/pmndrs/react-three-fiber), [drei](https://github.com/pmndrs/drei)) | Three 를 React 트리로. drei 의 `GizmoHelper/GizmoViewcube`(NavCube), `Html`(3D 라벨), `Bounds`(핏) | 우리는 `scene.ts` 클래스 방식. R3F 로 갈아타면 병합·픽킹 코드를 다시 짜야 함 → **안 감**. NavCube 만 직접 구현(작은 서브씬) |
| lil-gui / Tweakpane | 디버그용 슬라이더 패널 | 표시 옵션 프로토타입에 편함. 제품 UI 는 아님 |
| three.js editor ([threejs.org/editor](https://threejs.org/editor/)) | 씬 트리 + 속성 패널 UI 의 기본형 | 레이아웃 참고만 |

## 3. 결론 — 우리 뷰어 다음 손질 순서

1. ✅ **패널 리사이즈·접기** — react-resizable-panels 4.x (`Group/Panel/Separator`), 섹션은 `<details>`. 캔버스는 `ResizeObserver` 로 추종.
2. ✅ **하단 아이콘 툴바 + 모드 버튼** — 홈/핏/평면/정면 · 격리/숨김/전체 · 단면/병합 · URL. 단면 슬라이더는 단면 모드일 때만 상단에.
3. ✅ **축 기즈모** — 처음엔 글자 라벨 큐브였으나 사용자 피드백으로 Blender식 XYZ 기즈모(빨강 X·초록 Y(up)·파랑 Z, 음의 축은 연한 구, 글자 없음)로 교체. `scene.ts` 의 `NavCube` 클래스: 별도 WebGLRenderer(96px, alpha) + Orthographic, 메인 카메라 quaternion 의 역을 적용, 구 호버 시 1.35배 확대 + 라벨(Front/Back/Top/Bottom/Right/Left/Home) DOM 툴팁, 구 클릭 → `lookFrom(dir)` (거리 유지), 가운데 회색 구 → 홈 뷰(중앙 반경은 축 구에 가려도 홈 우선).
4. **트리 3모드** — 공간 / 클래스 / (타입은 M5). 노드 체크박스로 표시 토글.
5. **속성 색상 모드(E)** — Speckle 방식: 속성 선택 → 값별 범례 → 색칠.
6. **우클릭 컨텍스트 메뉴** — 격리/숨김/핏/속성 복사.
7. 섹션 박스(3축), 측정(F), 2D 평면 모드 — 그다음.

**안 할 것**: 엔진 교체(xeokit/That Open/R3F). 이유는 [3d-formats.md](3d-formats.md) 와 동일 — 지금 코드가 이미 병합·픽킹·단면을 갖고 있고, 포트폴리오 가치는 "직접 구현" 에 있다.
