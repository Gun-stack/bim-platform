# BIM–GIS 통합 — 무엇을 어디까지 (M3 학습 노트)

> 이 프로젝트의 지도 기능이 BIM–GIS 통합의 어느 층인지, 다음 층은 무엇인지.

## 두 세계의 차이

| | BIM (IFC) | GIS (CityGML/CityJSON, 3D Tiles) |
|---|---|---|
| 스케일 | 건물 하나, mm | 도시·국가, m~km |
| 좌표 | 로컬 직교, Z-up | 지리(위경도) 또는 투영, 타원체/지오이드 높이 |
| 의미 | 부재(벽·문·설비)·속성·관계 | 지형·건물 외피·도로·행정구역 |
| 기하 | 파라메트릭(압출·불리언), 정밀 | 표면 메시, LOD 로 단순화 |
| 표준 | buildingSMART | OGC |

통합이란 결국 "IFC 모델을 지리좌표로 옮기고, 도시 데이터와 같은 화면에서 보고, 속성을 서로 조회" 하는 것.

## 통합 단계

1. **위치·풋프린트** — 건물이 지도 어디에 있나. 2D 지도에 폴리곤. ← **우리 M3.** FMS 관점에서 "우리 건물들이 어디 있나" 는 이것으로 대부분 해결된다.
2. **3D 모델을 지도 위에** — MapLibre custom layer(three.js) 로 glb 를 지리좌표에 놓기, 또는 Cesium 에서 3D Tiles 로. 단일 건물 데모는 custom layer 로 가능(ADR 0004 확장 항목).
3. **도시 컨텍스트** — 주변 건물(CityGML LOD1~2, OSM buildings), 지형(DEM), 도로. Cesium ion / 국토지리정보원 3D 데이터.
4. **공간 분석** — 침수 범위·일조·소음 등 GIS 분석 결과를 BIM 요소에 되먹임. 우리는 범위 밖.

## CityGML / CityJSON 과 LOD

- CityGML: OGC 도시 모델 표준(XML). Building, Transportation, Vegetation 등 모듈. **LOD0**(풋프린트) ~ **LOD4**(실내) — 우리 풋프린트가 곧 LOD0.
- CityJSON: 같은 모델을 JSON 으로. 가볍고 웹 친화적. 3.0 부터 IFC 와 연결(`IfcGlobalId` 속성) 가능.
- IFC → CityGML 변환은 손실 변환(파라메트릭 → 표면). 도구: IfcOpenShell + 별도 변환기, FME, ifc2citygml. 우리 파이프라인에 붙인다면 worker 출력 포맷 하나 추가.

## 3D Tiles (M5 후보)

Cesium 의 스트리밍 타일 표준(OGC). 콘텐츠가 glb 라 우리 변환 결과를 재사용할 수 있다 — glb 하나를 tileset.json 으로 감싸고 지리참조(ENU 변환행렬)를 넣으면 Cesium 에서 바로 뜬다. 여러 건물·대용량으로 가면 타일 분할·LOD 생성 파이프라인(py3dtiles, 3d-tiles-tools)이 필요.

## 왜 2D 지도부터

- FM 사용자가 묻는 건 "몇 동 몇 층에 뭐가 있나" 이지 도시 3D 가 아니다.
- 지리참조 없는 IFC 가 태반이라(샘플 4종 중 IfcMapConversion 이 있는 건 2종) **수동 배치 UI** 가 3D 지구본보다 먼저다.
- MapLibre + PostGIS 는 이력서의 GIS 경험과 직접 이어진다.

## 삽질 기록 — MapLibre 워커가 조용히 죽는 세 가지 이유

GeoJSON 소스가 영원히 로드되지 않고(`isStyleLoaded() === false`), 콘솔에는 아무것도 안 뜬다. 래스터 타일은 메인 스레드라 멀쩡히 보여서 더 헷갈린다. 헤드리스 Chrome(puppeteer-core)으로 잡았다.

1. **워커 파일 경로.** MapLibre 6 는 `new URL('./maplibre-gl-worker.mjs', import.meta.url)` 로 자기 옆의 워커를 찾는다. Vite 단일 번들에선 `/assets/maplibre-gl-worker.mjs` 가 없고, nginx `try_files` 가 **index.html 을 200 으로** 돌려줘 "module script MIME text/html" 로 죽는다.
2. **`.mjs` MIME.** nginx 기본 `mime.types` 에 `mjs` 가 없어 `application/octet-stream` → 모듈 워커는 strict MIME 이라 거부. `types { text/javascript mjs; }` 추가.
3. **워커의 의존성.** `?url` 로 워커 파일만 복사하면 그 안의 `import … from './maplibre-gl.mjs'` 가 또 깨진다. **`?worker&url`** 로 Vite 가 의존성까지 묶은 독립 워커 번들(약 480KB)을 만들게 하고 `maplibregl.setWorkerUrl(절대 URL)`.

교훈: 워커 실패는 페이지 콘솔에 안 나온다. `page.on('workercreated')` + `worker.evaluate()` 로 생존을 확인하거나, `map.isStyleLoaded()` 가 몇 초 지나도 false 면 워커부터 의심.

## 참고

- OGC CityGML 3.0: https://www.ogc.org/standards/citygml
- CityJSON: https://www.cityjson.org
- 3D Tiles: https://github.com/CesiumGS/3d-tiles
- MapLibre custom layer(three.js): https://maplibre.org/maplibre-gl-js/docs/examples/add-3d-model/
