# 03. BIM 오픈소스 기술 레이더

조사일: **2026-08-28**. 다음 재조사: M2 착수 시 (프론트 라이브러리 버전 재확인).

## 채택 / 보류 / 배제

| 구분 | 항목 | 버전 (조사일) | 라이선스 | 판단 |
|---|---|---|---|---|
| **채택** | IfcOpenShell / ifcopenshell.geom / IfcConvert | 0.8.5 (공식 사이트), PyPI 0.8.3.post1 | LGPL-3.0 | IFC 파싱·기하·glTF 변환의 사실상 표준. IDS(ifctester)·BCF·COBie(ifccobie) 도구 포함 |
| **채택** | Three.js + glTF | three 0.185.1 | MIT | glb 로드. 프론트에 IFC 파서 없음 |
| **채택** | MapLibre GL JS | 5.x | BSD-3 | 2D 지도, 풋프린트 |
| **채택** | PostGIS | 3.4 | GPL-2.0 (서버) | 공간 저장·변환 |
| **채택** | Flyway, Testcontainers, MinIO | — | Apache-2.0 / AGPL(MinIO 서버) | MinIO 서버 AGPL은 자체 호스팅·미수정이면 문제 없음. 배포 시 다른 S3로 교체 가능하게 SDK만 의존 |
| **보류(M5)** | 3d-tiles-tools + CesiumJS | — | Apache-2.0 | glb → 3D Tiles. Cesium ion 무료 티어는 비상업용 한정 → 자체 tileset 생성 경로 사용 |
| **보류(M5)** | ifctester (IDS 1.0) | IfcOpenShell 동봉 | LGPL | 모델 요구사항 검증 데모 |
| **보류** | @thatopen/components / fragments | components 3.4.8, fragments 3.4.7, web-ifc 0.0.77 | MIT / MPL-2.0 | 빠른 브라우저 미리보기용. **주의**: Fragments 2→3 비호환, web-ifc 0.0.x 브레이킹 잦음, three 버전 pin 필수 |
| **배제** | xeokit-sdk / xeokit-convert (XKT) | 2.6.113 | **AGPL-3.0** (상용은 Creoox 유료) | 대형 모델 성능은 최고급이나 폐쇄형 서비스에 부적합. 비교 항목으로 기록 |
| **배제** | BIMserver | 1.5.188 (2024-07) | AGPL-3.0 | 유지보수 모드, Java 8 세대. 신규 채택 비권장 |
| **배제** | Java IFC 라이브러리 (bimserverclientlib, IFC.JAVA) | — | AGPL 등 | 기하 엔진 없음. Java에서 IFC를 직접 다루는 대신 Python 워커 사용 → [ADR 0001](adr/0001-java-api-plus-python-worker.md) |
| **배제** | IFC.js (web-ifc-viewer, web-ifc-three) | deprecated | — | ThatOpen Engine으로 승계. 옛 튜토리얼 주의 |
| **배제** | Speckle | server 2.31.14 | Apache-2.0 (일부 EE) | 훌륭하지만 "플랫폼을 직접 만드는" 목적과 충돌. 참고 아키텍처로만 |
| **배제** | openMAINT | 2.4 | AGPL-3.0 | BIM-FM 기성 솔루션. FMS를 직접 구현하는 것이 포트폴리오 목적 |

## 표준 현황

| 표준 | 상태 | 이 프로젝트 |
|---|---|---|
| IFC 4.3.2 | ISO 16739-1:2024 확정 | 기준 스키마. 입력은 IFC2x3/IFC4 허용 (실무 파일 대다수) |
| IFC 4.4 | 소폭 개정 진행 | 무시 |
| IFC5 / IFCX | 공개 alpha, JSON/TypeSpec 기반, "production 부적합" 명시 | study 노트만 |
| IDS 1.0 | 2024-06 최종 승인, 1.1/2.0 피드백 중 | M5 검증 데모 |
| BCF 3.0 | 최종 승인 (XML + API) | viewpoint 개념만 차용 |
| COBie | BIM→FM 인수인계 스프레드시트 표준 | asset 스키마 설계 참고, M5 내보내기 |
| CityJSON 2.0 | OGC 표준 (CityGML 3.0 부분집합) | BIM-GIS study 노트. IFC→CityJSON 자동 변환은 연구 수준 |

## Docker 이미지 주의

- `aecgeeks/ifcopenshell` 공식 이미지는 0.8.0에서 1년 이상 방치 → `ifc-worker/Dockerfile`에서 `python:3.12-slim` + ifcopenshell.org 빌드 zip(또는 conda-forge)으로 직접 설치. 버전은 `ARG IFCOPENSHELL_VERSION` 으로 고정.

## 출처

- IfcOpenShell: https://docs.ifcopenshell.org/ifcconvert.html · https://ifcopenshell.org/downloads.html · https://pypi.org/project/ifcopenshell/ · https://hub.docker.com/r/aecgeeks/ifcopenshell/tags
- ThatOpen / web-ifc: https://www.npmjs.com/package/web-ifc · https://www.npmjs.com/package/@thatopen/components · https://github.com/ThatOpen/engine_fragment · https://github.com/ThatOpen/web-ifc-viewer (deprecated 공지)
- xeokit: https://github.com/xeokit/xeokit-sdk/releases · https://xeokit.io/docs/terms/affero-gpl-agpl/
- BIMserver / Speckle: https://github.com/opensourceBIM/BIMserver/releases · https://github.com/specklesystems/speckle-server/releases · https://docs.speckle.systems/developers/server/introduction
- 표준: https://technical.buildingsmart.org/standards/ifc/ · https://github.com/buildingSMART/IFC5-development · https://technical.buildingsmart.org/projects/information-delivery-specification-ids/ · https://github.com/buildingSMART/BCF-API/releases/tag/v3.0
- 3D Tiles / Cesium: https://github.com/CesiumGS/3d-tiles-tools · https://cesium.com/platform/cesium-ion/pricing/
- CityJSON: https://www.cityjson.org/software/ · https://github.com/citygml4j/citygml-tools/releases
- Java: https://mvnrepository.com/artifact/org.opensourcebim/bimserverclientlib · https://github.com/pipauwel/IFC.JAVA
- openMAINT: https://www.openmaint.org/en
