# IFC 지리참조 — 모델 좌표를 지구 위에 놓기 (M3 학습 노트)

> 코드: `worker/georef.py`, `MapController`. 결정: [ADR 0004](../adr/0004-maplibre-over-cesium.md). 샘플 4종의 실제 값으로 확인한 내용.

## 문제

IFC 기하는 **프로젝트 로컬 좌표**(보통 건물 모서리가 원점, 단위 mm 또는 m, Z-up)다. 지도에 올리려면 "로컬 (0,0) 이 지구 어디이고 로컬 X 축이 어느 방향인가" 가 필요하다. 이걸 담는 자리가 스키마 버전마다 다르고, **없는 파일이 많다**.

## 두 가지 방식

| | IfcMapConversion (IFC4+) | IfcSite.RefLatitude/RefLongitude (IFC2x3~) |
|---|---|---|
| 내용 | 투영좌표계(`IfcProjectedCRS`, EPSG) + 로컬 원점의 Eastings/Northings/OrthogonalHeight + X 축 방향(XAxisAbscissa/Ordinate) + Scale | 사이트 원점의 위경도(도·분·초 튜플) + RefElevation |
| 정밀도 | 측량급. 회전·축척까지 | 위치만. **회전 없음**(북쪽 = 로컬 Y 라고 가정할 수밖에) |
| 샘플 | Building-Architecture(EPSG:32760, 회전 60°), example-project-location(EPSG:28992 네덜란드 RD) | Duplex(시카고), AC20-FZK-Haus(카를스루에) |
| LoGeoRef 등급 | 50 | 20 |

**우선순위**: MapConversion > Site 위경도 > 없음(NULL → 수동 핀). example-project-location 은 둘 다 있는데 Site 는 보스턴, MapConversion 은 네덜란드 — 저작 툴이 Site 값을 기본값으로 남긴 것. MapConversion 이 이긴다.

## 실제로 밟은 것

1. **단위.** MapConversion 의 Eastings 가 `729013348.8` — mm 다. `ifcopenshell.util.unit.calculate_unit_scale(file)` 로 프로젝트 길이단위 → m 스케일을 곱해야 한다. 안 곱하면 지구 밖으로 나간다.
2. **DMS 튜플.** `RefLatitude = (41, 52, 27, 840000)` — 도·분·초·**백만분의 초**. 4번째 항을 무시하면 수 cm 오차, 부호는 첫 항 기준(서경은 `(-87, -38, -21, -839999)` 처럼 전부 음수).
3. **회전.** `XAxisAbscissa/Ordinate = (0.5, 0.866)` 는 로컬 X 축의 지도상 방향 벡터(cos 60°, sin 60°). 로컬 (x, y) → 지도 (E + s(ax − by), N + s(bx + ay)). 정규화하지 않은 파일도 있어 길이로 나눈다.
4. **EPSG 변환.** pyproj 로 `EPSG:28992 → 4326`. PostGIS `ST_Transform` 으로도 되지만 worker 가 이미 Python 이라 여기서 끝낸다. 지도용 폴리곤은 4326 으로 저장(GeoJSON 이 4326 이라 프론트가 변환 없음).
5. **Site 만 있을 때 로컬 → 위경도.** 미터 → 도: 위도 1° ≈ 111.32 km, 경도 1° ≈ 111.32 km × cos(lat). 건물 하나 크기(수십 m)에서 오차 무시 가능. 회전 정보가 없으므로 "로컬 Y = 북" 가정 — 틀릴 수 있어 UI 에서 재배치(수동 핀 + 회전) 허용.

## 풋프린트

건물 외곽선을 정확히 뽑으려면 층별 슬래브 외곽 union 등이 필요하지만, 지도 축척에서는 **XY 바운딩 박스**로 충분하다. iterator 정점(IFC 월드좌표, m, Z-up)을 훑으며 min/max — Space·Opening 은 제외(Space 는 대지 전체를 덮는 경우가 있음). 회전이 있으면 박스도 같이 돌아가므로 지도에서 건물 방향이 맞다.

## 수동 핀 (지리참조 없는 파일)

핀(lon, lat) + 회전(deg) 만 받고, 폭은 worker 가 저장한 로컬 bbox 를 쓴다. 미터 박스를 **핀 중심의 정거방위 투영(`+proj=aeqd +lat_0 +lon_0`)** 에서 만들어 `ST_Transform(…, 'EPSG:4326')` — 위도가 높아도 동서 방향이 늘어나지 않는다(웹 메르카토르 3857 로 하면 서울에서 약 25% 늘어남). `map_conversion` 에 `source: manual` 을 남겨 지도에서 색을 다르게 그린다.

## 한국 좌표계 메모

국내 IFC 는 EPSG:5186(중부원점 TM) 이 흔하다. pyproj 가 EPSG DB 를 내장하므로 코드 변경 없이 동작하지만, 구 Bessel 기반(EPSG:2097 등)은 datum shift 파라미터를 확인해야 한다. 샘플이 없어 미검증.

## 참고

- buildingSMART IFC4.3 IfcMapConversion: https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcMapConversion.htm
- LoGeoRef (Level of Georeferencing): Clemen & Görne, 2019
- pyproj: https://pyproj4.github.io/pyproj/
