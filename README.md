# bim-platform

IFC 모델을 업로드하면 서버에서 변환하고, 웹에서 3D로 보고, 지도 위에 배치하고, 시설관리(FMS) 자산·점검·작업지시로 연결하는 **개인 BIM 미니 플랫폼**.

> 상태: M0 골격 완료 (2026-08-28). `docs/` 부터 읽으세요.

## 무엇을 보여주려는가

- **BIM 데이터 파이프라인**: IFC → IfcOpenShell 변환 → glTF + 속성 DB (서버 사이드, 대용량 대응)
- **플랫폼 백엔드**: Java 25 / Spring Boot 4 MVC (가상 스레드), PostgreSQL + PostGIS, MinIO
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

## 실행

```bash
docker compose up -d --build --wait
# web   → http://localhost:5173
# api   → http://localhost:8080/actuator/health
# minio → http://localhost:9001  (minio / minio123)
# db    → localhost:5432  bim / bim / bim
docker compose down -v   # 볼륨까지 초기화
```

### 업로드 확인 (M1)

![M1 업로드 페이지](docs/images/m1-upload.jpg)

`http://localhost:5173` 에서 IFC 선택 → 진행률(SSE) → READY 면 glb 링크, FAILED 면 에러 + 재시도.

```bash
PID=$(curl -s -X POST localhost:8080/api/projects -H 'content-type: application/json' -d '{"name":"demo"}' | jq -r .id)
curl -F file=@samples/Duplex_A_20110907.ifc localhost:8080/api/projects/$PID/models   # 202, {id,...}
curl localhost:8080/api/models/<id>                                                   # status, jobStatus, progress, error
curl -N localhost:8080/api/models/<id>/events                                         # SSE, READY/FAILED 에서 종료
curl -X POST localhost:8080/api/models/<id>/retry                                     # FAILED 만 재등록
```

### 3D 뷰어 (M2)

![M2 뷰어](docs/images/m2-viewer.jpg)

모델 목록에서 READY 모델 클릭 → `#/models/{id}`. 요소 클릭 → Pset, 층/클래스 필터, 검색, 표시 옵션(Opening·Space·재질별 병합 + draw call 카운터), 섹션 박스(X/Y/Z, 층 스냅), 측정, 격리/숨김, 호버 툴팁, 뷰 프리셋·더블클릭 핏, 뷰포인트 URL 공유. 리사이즈 패널, 하단 아이콘 툴바, XYZ 축 기즈모, 트리 숨김/솔로, 다중 선택(Cmd·Shift), 우클릭 메뉴, 속성별 색상(클래스·층·Pset 값).

### 시설관리 (M4)

![M4 작업지시 보드](docs/images/m4-board.jpg)

뷰어에서 요소 선택 → "자산 · FM" 탭 → 자산 등록(IFC Pset 스냅샷) → 점검 OK/결함 → 작업지시(현재 뷰포인트 저장). `#/models/{id}/fm` 보드에서 "3D" 를 누르면 뷰어가 그 위치·선택으로 돌아간다.

### 설비 계통 (M6)

![M6 계통별 색](docs/images/m6-systems.png)
![M6 계통 추적](docs/images/m6-route.png)
![M6 상태판](docs/images/m6-status.png)
![M6 정전 시나리오](docs/images/m6-blackout.png)
![M6 모니터링](docs/images/m6-monitor.png)
![M6 모니터링 정전](docs/images/m6-monitor-blackout.png)
![M6 경보 포커스](docs/images/m6-focus.png)

`samples/mep-building.ifc` — `samples/gen/gen_mep.py` 로 만든 가상 업무동 36×16m(지하: 변전실·통신실·방재실·펌프실·기계실·수조실, 지상 3층 A/B 구역, 옥상). **13계통 356요소 434연결**: 전기(수변전·MCC·태양광·EV)·비상전원(발전기·ATS·UPS)·화재감지(수신기·중계기·감지기·방송)·급수·급탕·배수·소방(펌프·알람밸브·스프링클러·소화전·가스계)·공조(AHU·OAU·VAV·디퓨저·댐퍼)·냉난방수(냉동기·냉각탑·보일러·히트펌프·열교환기·FCU)·환기(급배기·제연·제트팬·ERV)·가스·통신(MDF/IDF·BMS·DDC·CCTV·출입)·수송(EL/ES/DW — 에스컬레이터는 30° 경사 트러스+난간+랜딩, 2F 슬래브 개구부; 샤프트·덤웨이터도 IfcOpeningElement 로 슬래브 관통). 장비 195개에 운영 상태(`Pset_BimStatus`). 뷰어 "계통" 탭에서 계통별 색, 요소 선택 → **상류(원천까지) / 하류(말단까지)** 추적, **상태판**(경보/장애 목록, API 로 상태 갱신 → 수신기 집계·작업지시 자동), **정전 시나리오**(발전기 절체 시 전원 있음/없음을 흐름 그래프로 계산). `#/models/{id}/monitor` **모니터링**: 팀(전기·소방·설비) × 층 격자에 장비 상태·자산·작업지시, 5초 갱신. `python3 samples/gen/bms_sim.py <modelId>` 로 BMS 시뮬레이션(경보·장애·펌프·수위·정전).

### 지도 (M3)

![M3 지도](docs/images/m3-map.png)

`#/map` — worker 가 IfcMapConversion(EPSG·회전·단위) 또는 IfcSite 위경도에서 풋프린트를 뽑아 PostGIS 에 저장, MapLibre 에 표시. 지리참조 없는 모델은 지도 클릭으로 배치(수동 핀 + 회전).

샘플 IFC 는 `samples/README.md` 참고. 로컬 개발: `cd api && ./gradlew test` (Testcontainers, Docker 필요), `cd web && npm run dev`.
