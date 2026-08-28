# ADR 0002. 서버 glTF 변환, 브라우저 IFC 파싱 안 함

- 상태: 채택 (2026-08-28)

## 맥락

브라우저에서 web-ifc(WASM)로 IFC를 직접 파싱하면 백엔드가 가벼워지고 데모가 빠르다. 그러나 대용량 파일에 약하고, 파싱 결과(속성·계층)를 서버에 남기지 않으면 검색·FMS 연결·지도 통합이 불가능하다.

## 결정

- worker가 IFC를 **glb(glTF binary)** 로 변환하고, 요소·Pset·공간계층을 DB에 적재한다.
- 프론트는 glb만 로드. glb 노드 이름 = IFC GlobalId (`--use-element-guids`).
- 프론트에 IFC 파서 의존성 없음.

## 대안

- ThatOpen Fragments: 성능 좋고 활발하지만 2→3 비호환 이력, 자체 포맷 종속. 필요 시 worker에서 추가 출력 포맷으로 확장 가능.
- xeokit XKT: 성능 최상이나 AGPL.
- 3D Tiles: 도시 규모 스트리밍용. 단일 건물 데모에는 과함 → M5.

## 결과

- 대용량 모델은 서버 리소스로 처리, 브라우저는 표준 포맷만 다룸.
- glb 크기 문제가 생기면 Draco/meshopt 압축(gltf-transform) → 이것도 서버 파이프라인에 붙는다.
