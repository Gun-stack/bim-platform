# 04. 마일스톤

각 마일스톤은 "동작하는 것 + 학습 노트 1~2편" 을 산출물로 한다. 노트는 `docs/study/`.

| M | 동작 목표 (완료 기준) | 학습 노트 |
|---|---|---|
| **M0** 골격 | `docker compose up` 으로 postgis·minio·api(헬스체크)·web(빈 페이지)·worker(idle 루프) 기동. Flyway 초기 스키마. 샘플 IFC 3종 `samples/` 에 배치 (목록은 `ifc-basics.md` 에 확정) | `ifc-basics.md` — STEP/EXPRESS, IFC 파일 구조, 스키마 버전 |
| **M1** 변환 파이프라인 ✅ 2026-08-28 | IFC 업로드 → 잡 → worker 변환 → glb MinIO 저장 → `READY`. SSE 진행률. 실패 시 FAILED + 에러 노출 | `ifcopenshell-geom.md` — geom settings, 단위, 정밀도, 대용량 시 메모리 · `3d-formats.md` — glTF vs Fragments vs XKT vs 3D Tiles |
| **M2** 3D 뷰어 ✅ 2026-08-28 | Three.js glb 로드, 요소 클릭 → Pset 패널, 층별 필터, 공간 트리, 요소 검색 | `ifc-spatial-structure.md` — Site/Building/Storey/Space, GlobalId, Pset/Qto · `webgl-performance.md` — 인스턴싱, 병합, 프러스텀 컬링 |
| **M3** GIS ✅ 2026-08-28 | 지리참조 추출 → footprint → `/api/map/footprints` → MapLibre 표시. 지리참조 없는 모델은 수동 핀 | `ifc-georeferencing.md` — IfcMapConversion, IfcSite RefLat/Long, EPSG:5186↔4326, LoGeoRef 등급 · `bim-gis-integration.md` — CityGML/CityJSON, LOD 개념 |
| **M4** FMS ✅ 2026-08-28 | 자산 등록(요소 연결) → 점검 → 작업지시. 작업지시에서 뷰어 열면 요소 하이라이트 + viewpoint 복원 | `cobie-bcf.md` — COBie 시트 구조, BCF 3.0 topic/viewpoint · `fm-domain.md` — 시설관리 업무 흐름 |
| **M6** 설비 계통 ✅ 2026-08-28 | 가상 건물 IFC 생성(13계통 356요소 — 수변전·비상전원·화재감지·급수·급탕·배수·소방·공조·냉난방수·환기·가스·통신·수송, 흐름 연결 434, 구역, 상태 Pset), 모니터링(팀×층)·상태 API·정전 시나리오·BMS 시뮬레이터, 계통/연결 추출, 재귀 CTE 경로 추적 API, 뷰어 계통 탭(계통별 색·솔로·상류/하류 추적) | `mep-systems.md` — IfcDistributionSystem, 포트 vs 요소 연결, 그래프 추적 |
| **M5** 선택 (보류) | IDS 검증 + 결과 색상 표시 / COBie 내보내기 / 3D Tiles + Cesium 탭 / GitHub Actions(빌드 → Trivy) | `ids.md`, `ifc5-outlook.md`, `ci-trivy.md` |

## 순서 원칙

- M1까지 끝나야 "BIM 플랫폼"이라 부를 수 있다. M0~M1 최우선.
- M3(GIS)와 M4(FMS)는 독립. 순서 바꿔도 됨.
- 각 M 완료 시 README에 스크린샷/GIF 1장 추가.
