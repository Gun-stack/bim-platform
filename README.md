# bim-platform

IFC 모델을 업로드하면 서버에서 변환하고, 웹에서 3D로 보고, 지도 위에 배치하고, 시설관리(FMS) 자산·점검·작업지시로 연결하는 **개인 BIM 미니 플랫폼**.

> 상태: 설계 단계 (2026-08). 코드 없음. `docs/` 부터 읽으세요.

## 무엇을 보여주려는가

- **BIM 데이터 파이프라인**: IFC → IfcOpenShell 변환 → glTF + 속성 DB (서버 사이드, 대용량 대응)
- **플랫폼 백엔드**: Java 17 / Spring Boot 3 WebFlux, PostgreSQL + PostGIS, MinIO
- **3D 웹 뷰어**: React + Three.js, 요소 선택·속성·공간 계층
- **GIS 통합**: IFC 지리참조 → PostGIS 풋프린트 → MapLibre 지도
- **FMS 통합**: 요소 → 자산 → 점검 → 작업지시 (COBie / BCF 개념 반영)
- **전부 Docker Compose** 한 번으로 기동

## 문서

| 순서 | 파일 | 내용 |
|---|---|---|
| 1 | [docs/00-overview.md](docs/00-overview.md) | 목적, 요구사항, 결정 요약 |
| 2 | [docs/01-architecture.md](docs/01-architecture.md) | 컨테이너 구성, 데이터 흐름, API 개요 |
| 3 | [docs/02-data-model.md](docs/02-data-model.md) | 테이블/ERD |
| 4 | [docs/03-tech-radar.md](docs/03-tech-radar.md) | BIM 오픈소스 조사표 (2026-08) |
| 5 | [docs/04-milestones.md](docs/04-milestones.md) | 마일스톤별 범위와 학습 주제 |
| — | [docs/adr/](docs/adr/) | 아키텍처 결정 기록 |
| — | [docs/study/](docs/study/) | 개발하며 남기는 학습 노트 |

## 실행 (예정)

```bash
docker compose up --build
# web  → http://localhost:5173
# api  → http://localhost:8080
# minio→ http://localhost:9001
```
