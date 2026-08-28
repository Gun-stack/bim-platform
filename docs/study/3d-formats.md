# 웹 3D 포맷 비교 — 왜 glb 인가 (M1 학습 노트)

> 결정은 [ADR 0002](../adr/0002-server-gltf-over-browser-parsing.md). 여기는 판단 근거와 각 포맷이 어떤 문제를 푸는지.

## IFC 자체를 브라우저에서 읽으면 안 되나

web-ifc(WASM)로 가능하고 데모는 빠르다. 그러나 (1) 파싱 결과가 브라우저에만 있어 검색·FMS·지도가 서버에서 불가, (2) 대용량은 탭 메모리 한계, (3) 사용자마다 매번 파싱. "플랫폼"이면 서버가 한 번 변환하고 결과를 저장하는 쪽이 맞다.

## 후보

| 포맷 | 무엇 | 장점 | 단점 | 라이선스 |
|---|---|---|---|---|
| **glTF 2.0 / glb** | Khronos 표준. JSON 씬 + 바이너리 버퍼(glb 는 한 파일) | 모든 뷰어·엔진 지원, Three.js `GLTFLoader` 내장, 노드 이름에 GlobalId 실어 매핑 가능, Draco/meshopt/KTX2 확장 | BIM 특화 아님: 요소 수천 개 = 노드·메시 수천 개 → draw call 많음 | 오픈 |
| ThatOpen **Fragments** | That Open Company 의 BIM 전용 바이너리(FlatBuffers) | 인스턴싱·스트리밍·속성 내장, 큰 모델에 강함 | v2→v3 비호환 이력, 자체 뷰어 종속, 문서 유동적 | MIT |
| xeokit **XKT** | xeokit SDK 전용 압축 포맷 | 대형 모델 성능 최상급 | 뷰어 AGPL(상용 라이선스 별도) | AGPL |
| **3D Tiles** | Cesium 의 타일 스트리밍 표준(OGC). 내부 콘텐츠는 glb | 도시 규모 LOD 스트리밍, 지리참조 내장 | 단일 건물엔 과함, 타일링 파이프라인 필요 | 오픈 |
| IFC5 / IFCX | buildingSMART 차세대(USD 유사 레이어) | 미래 | alpha, 툴 없음 | 오픈 |

## 왜 glb

1. 표준 → 프론트가 IFC 도 Fragments 도 모른다. Three.js 하나면 됨.
2. 노드 이름 = GlobalId 한 줄로 요소 매핑 끝. 별도 매핑 테이블 없음.
3. 커지면 갈 길이 정해져 있다: `gltf-transform` 로 Draco/meshopt 압축(서버 후처리 한 줄) → 그래도 크면 3D Tiles (내용물이 glb 라 재변환 없음) → M5.
4. Fragments/XKT 는 "더 빠른 뷰어"이지 "다른 파이프라인"이 아니다. 필요하면 worker 출력 포맷 하나 추가로 끝나므로 지금 고를 이유가 없다.

## glb 구조 (우리 출력 기준)

```
12B 헤더 (magic 'glTF', version 2, length)
JSON 청크: scenes/nodes/meshes/materials/accessors/bufferViews
BIN 청크: 정점·인덱스·노멀
```
- 요소 1개 = node 1개 = mesh 1개. node.name = GlobalId.
- Duplex 286 노드 1.9MB, example-project-location 570 노드 11.6MB.
- 크기의 대부분은 정점 (weld-vertices=False 라 면마다 정점 복제, [ifcopenshell-geom.md](ifcopenshell-geom.md)).

## 뷰어 성능은 포맷이 아니라 draw call 문제 (M2 예고)

요소 수천 개를 노드 수천 개로 그리면 느린 건 glb 탓이 아니라 draw call 수 탓. 해결은 로드 후 병합(`BufferGeometryUtils.mergeGeometries`) + 요소 ID 를 정점 속성으로 심어 픽킹, 또는 인스턴싱. Fragments 가 하는 일도 결국 이것. `webgl-performance.md` 에서.

## 참고

- glTF 2.0 spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
- gltf-transform: https://gltf-transform.dev/
- 3D Tiles: https://github.com/CesiumGS/3d-tiles
- That Open fragments: https://github.com/ThatOpen/engine_fragment
