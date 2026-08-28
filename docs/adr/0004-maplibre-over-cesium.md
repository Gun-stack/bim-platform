# ADR 0004. 지도는 MapLibre GL (2D), Cesium 3D Tiles는 확장 항목

- 상태: 채택 (2026-08-28)

## 맥락

GIS 통합의 핵심 요구는 "건물이 어디 있는지 지도에서 보고, 클릭하면 모델로 들어간다". CesiumJS + 3D Tiles는 지도 위에 3D 건물을 그대로 얹을 수 있어 화려하지만, glb → 3D Tiles 변환·ECEF 좌표 변환·타일링 파이프라인이 추가된다.

## 결정

- MapLibre GL JS + PostGIS. 모델의 footprint(Polygon, 4326)와 프로젝트 location(Point)을 GeoJSON으로 표시.
- 3D 뷰어와 지도는 별도 화면. 지도 → 모델 진입 링크로 연결.
- 지리참조 추출은 worker(`georef.py`)가 담당: IfcMapConversion(IFC4+) 우선, 없으면 IfcSite RefLatitude/RefLongitude, 둘 다 없으면 NULL → 수동 핀.

## 대안

- CesiumJS + 3d-tiles-tools: M5에 추가. worker 출력에 tileset 생성 단계만 붙이면 됨.
- MapLibre custom layer(three.js)로 glb를 지도 위에 직접 렌더: 단일 건물 데모에는 가능. M3 이후 여유 있으면 시도.

## 결과

- 이력서의 MapLibre·PostGIS 경험 직접 연결.
- 좌표계 변환(EPSG:5186 등 한국 TM ↔ 4326)은 pyproj(worker) 또는 PostGIS `ST_Transform`.
