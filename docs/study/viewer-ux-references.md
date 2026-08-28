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
| **lucide-react** | 아이콘 세트 (MIT, 트리셰이킹) | 툴바 아이콘. 유니코드 글리프는 폰트마다 달라 보여 교체 |
| lil-gui / Tweakpane | 디버그용 슬라이더 패널 | 표시 옵션 프로토타입에 편함. 제품 UI 는 아님 |
| three.js editor ([threejs.org/editor](https://threejs.org/editor/)) | 씬 트리 + 속성 패널 UI 의 기본형 | 레이아웃 참고만 |

## 3. 결론 — 우리 뷰어 다음 손질 순서

1. ✅ **패널 리사이즈·접기** — react-resizable-panels 4.x (`Group/Panel/Separator`), 섹션은 `<details>`. 캔버스는 `ResizeObserver` 로 추종.
2. ✅ **하단 아이콘 툴바 + 모드 버튼** — 홈/핏/평면/정면 · 격리/숨김/전체 · 단면/병합 · URL. 단면 슬라이더는 단면 모드일 때만 상단에.
3. ✅ **축 기즈모** — 처음엔 글자 라벨 큐브였으나 사용자 피드백으로 Blender식 XYZ 기즈모(빨강 X·초록 Y(up)·파랑 Z, 음의 축은 연한 구, 글자 없음)로 교체. `scene.ts` 의 `NavCube` 클래스: 별도 WebGLRenderer(96px, alpha) + Orthographic, 메인 카메라 quaternion 의 역을 적용, 구 호버 시 1.35배 확대 + 라벨(Front/Back/Top/Bottom/Right/Left/Home) DOM 툴팁, 구 클릭 → `lookFrom(dir)` (거리 유지), 가운데 회색 구 → 홈 뷰(중앙 반경은 축 구에 가려도 홈 우선).
4. ✅ **좌측 패널 재설계 + 트리 2모드** — `LeftPanel.tsx`: 공간 구조 / 클래스 탭, 행마다 클래스 아이콘·개수 배지·눈 토글(하위 전체 숨김), 이름 클릭 → 범위 핏(+요소면 선택), 통합 검색(이름·클래스·GlobalId), 표시 옵션은 아이콘 토글. 층/클래스 필터 state 는 눈 토글로 대체. 타입 모드는 M5.
   - **다중 선택**: 선택은 `Set<GlobalId>`. 클릭=교체, Cmd/Ctrl+클릭=토글(트리·캔버스), Shift+클릭=앵커부터 범위(트리의 보이는 행 순서 기준, 펼침 상태를 LeftPanel 로 호이스팅해 평면화), 부모 행 클릭=하위 전부, Esc=해제. 여러 개면 우측 패널에 클래스별 개수 + 공통 Pset(앞 20개 상세를 병렬 조회해 교집합). 격리·선택만 보기·핏·URL `sel=` 모두 집합 기준.
   - **숨김 + 솔로**: 행마다 눈(숨김 토글)과 ◎(이것만 보기). Alt+눈 클릭 = 솔로. 모델은 `Hidden{nodes,classes,gids,solo?}`, 보임 = (solo 없음 || gid ∈ solo) && !hidden. 솔로는 숨김 위의 임시 렌즈라 해제하면 숨김이 복원되고, 숨긴 행을 솔로하면 그 행 숨김은 자동 해제. 헤더에 "이것만 보기: X ✕" 칩. 툴바 "나머지 숨김" 도 같은 솔로 모델(격리=반투명만 별도).
5. ✅ **속성 색상 모드** — 툴바 팔레트 → 캔버스 좌상단 카드(`ColorPanel.tsx`). 키: 클래스·층(로컬) + `GET /property-keys`(Pset.속성, 상위 200, 표준 Pset_* 우선) → `GET /property-values?key=` → 값별 범례(Tableau 팔레트 12색 순환, 값 없음은 회색) → 범례 클릭 = 그 값만 보기(솔로 모델 재사용, key `v:`). scene 은 `setColors(Map<gid,hex>)` 로 재질만 교체, 병합 모드와도 호환(색상 = 재질 그룹).
6. **우클릭 컨텍스트 메뉴** — 격리/숨김/핏/속성 복사.
7. 섹션 박스(3축), 측정(F), 2D 평면 모드 — 그다음.

**안 할 것**: 엔진 교체(xeokit/That Open/R3F). 이유는 [3d-formats.md](3d-formats.md) 와 동일 — 지금 코드가 이미 병합·픽킹·단면을 갖고 있고, 포트폴리오 가치는 "직접 구현" 에 있다.
