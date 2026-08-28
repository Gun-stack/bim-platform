# 00. 개요

## 목적

BIM 서비스 기업 이직용 포트폴리오. 다음 경험을 **하나의 동작하는 시스템**으로 엮는다.

| 이력서 경험 | 이 프로젝트에서 대응하는 부분 |
|---|---|
| Java 17 / Spring Boot 3 / WebFlux | `api` 서비스 |
| PostGIS, GeoTools, 타일·공간데이터 파이프라인 | 지리참조 추출, 풋프린트 저장, 지도 API |
| 대용량 바이너리 서빙(FlatBuffers/MVT) | glTF 변환·저장·서빙 파이프라인 |
| React + Unity WebGL 3D 편집기 | React + Three.js 뷰어 |
| MapLibre GL SDK 운영 | 지도 화면 |
| FMS 앱 개발 | 자산/점검/작업지시 |
| Docker / OKD / CI·CD / Trivy | Compose 구성, (M5) GitHub Actions + Trivy |
| Airflow 배치 | `ifc-worker` 잡 큐 (배치 관점 설명) |

## 필수 요구사항

1. Docker로 전체 기동
2. BIM 업계 오픈 라이브러리 적극 사용, 최신 동향 반영 → [03-tech-radar.md](03-tech-radar.md)
3. 백엔드부터 프론트까지 미니 플랫폼
4. GIS·FMS 통합
5. 개념·학습·코드 구성을 문서로 남김 → `docs/`, `adr/`, `study/`

## 확정된 결정 (요약)

| 결정 | 선택 | ADR |
|---|---|---|
| 백엔드 언어 | Java 17 + Spring Boot 3 (WebFlux) | [0001](adr/0001-java-api-plus-python-worker.md) |
| IFC 처리 | Python + IfcOpenShell 사이드카 워커 | [0001](adr/0001-java-api-plus-python-worker.md) |
| 3D 포맷 | 서버에서 glTF(glb) 변환, 프론트 Three.js | [0002](adr/0002-server-gltf-over-browser-parsing.md) |
| 잡 큐 | PostgreSQL 테이블 폴링 (`FOR UPDATE SKIP LOCKED`) | [0003](adr/0003-db-table-queue.md) |
| 지도 | MapLibre GL (2D) + PostGIS. Cesium 3D Tiles는 M5 | [0004](adr/0004-maplibre-over-cesium.md) |
| 통합 범위 | 지도 위 건물 배치 + 자산/점검/작업지시 | — |
| 기준 표준 | IFC 4.3 (ISO 16739-1:2024), 입력은 IFC2x3/4 허용. IDS 1.0, BCF 3.0, COBie 개념 반영 | — |

## 범위 밖 (명시)

- 사용자 인증/권한 (데모 단일 사용자). 필요 시 M5 이후
- IFC 편집·저장(write-back). 조회 전용
- 실시간 협업, 모델 버전 diff
- IFC5/IFCX 지원 (alpha, 학습 노트로만)

## 데모 시나리오

1. IFC 업로드 → 진행률(SSE) → 3D 뷰어 자동 오픈
2. 요소 클릭 → Pset 속성 패널, 층별 필터, 공간 트리
3. 지도 탭 → 프로젝트 풋프린트 클릭 → 모델 이동 (지리참조 없으면 수동 핀)
4. 요소 → 자산 등록 → 점검 → 작업지시 → 뷰어에서 하이라이트/카메라 이동
5. (M5) IDS 검증 → 실패 요소 색상 표시
