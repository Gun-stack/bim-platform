# bim-platform

IFC 건물 모델을 올리면 서버에서 변환해 **웹 3D로 보고**, **설비 계통(전기·소방·공조…)을 그래프로 추적**하고, **운영 상태(경보·장애·계측값)를 모니터링**하며, **자산·점검·작업지시(FMS)** 로 이어지는 BIM 운영 플랫폼입니다. 백엔드·변환 파이프라인·프론트를 한 사람이 처음부터 설계·구현했고, `docker compose up` 한 번으로 전부 뜹니다.

| 3D 뷰어 — 계통별 색 · 상류/하류 추적 | 설비 모니터링 — 팀 × 층 상태판 |
|---|---|
| ![](images/m6-route.png) | ![](images/m6-monitor.png) |
| **경보 포커스** — 구역 강조 + 위치 비콘 | **작업지시 칸반** — 드래그 · 우선순위 · 팀 색 |
| ![](images/m6-focus.png) | ![](images/m4-board.png) |
| **정전 시나리오** — 발전기 절체 시 전원 유무를 흐름 그래프로 | **가상 건물** — B2 주차장·주차관제, 옥탑 보일러실, 계단·램프·개구부 |
| ![](images/m6-blackout.png) | ![](images/m6-b2-parking.png) |

## 무엇을 보여주려 했나

| 영역 | 구현 |
|---|---|
| **BIM 데이터 파이프라인** | IFC 업로드 → 잡 큐 → Python 워커(IfcOpenShell)가 glTF 변환 + 요소·속성(Pset)·공간 계층·계통·연결·지리참조 추출 → PostgreSQL/PostGIS + MinIO. 진행률 SSE, 실패 재시도, 워커 lease/heartbeat로 좀비 잡 회수 |
| **플랫폼 백엔드** | Java 25 · Spring Boot 4 MVC(가상 스레드) · JdbcClient · Flyway. 제약은 DB CHECK/UNIQUE에 두고 앱은 400으로 매핑. Testcontainers 통합 테스트 |
| **3D 뷰어** | Three.js. 요소 선택 → 속성, 공간/종류/계통 트리, 검색, 단면(층별), 측정, 격리/솔로, 속성별 색상, 뷰포인트 URL 공유, 우클릭 메뉴, 다중 선택 |
| **설비 계통(MEP)** | IFC `IfcDistributionSystem` + `IfcRelConnectsElements` → `connection` 그래프. PostgreSQL 재귀 CTE로 **상류(원천까지)/하류(말단까지)** 추적. 14계통 474요소 521연결의 가상 업무동을 IfcOpenShell API로 직접 생성 |
| **운영 상태 · 모니터링** | `Pset_BimStatus` jsonb 병합 API(BMS 연동 자리). 경보/장애 → 작업지시 자동 생성(상위 장비 억제·중복 재사용·10분 시간창), 수신기·주차관제 집계는 서버가 계산. 팀 × 층 상태판, 계측값 사전(단위·주의/위험 범위), 최근 이벤트, 새 경보 강조·알림음, 정전 시나리오, 키오스크 모드 |
| **FMS** | 요소 → 자산(태그·분류·IFC 속성 스냅샷) → 점검(OK/결함) → 작업지시(뷰포인트 저장). 지라형 칸반(낙관적 드래그·되돌리기), 자산 대장 필터, 상태 동기화 |
| **GIS** | IfcMapConversion / IfcSite 위경도 → PostGIS 풋프린트 → MapLibre 지도, 지리참조 없는 모델은 수동 배치 |
| **운영 품질** | 규모 측정(2만 요소 합성), gzip, 자격증명 `.env`, 내부 포트 로컬 바인딩, nginx 프록시 최소화·보안 헤더·레이트리밋 |

## 아키텍처

```mermaid
flowchart LR
  subgraph browser
    WEB[web<br/>React 19 · Three.js · MapLibre]
  end
  WEB -- REST / SSE --> API[api<br/>Spring Boot 4 MVC · Java 25]
  API --> PG[(postgis<br/>PostgreSQL 16 + PostGIS)]
  API --> S3[(minio<br/>S3 호환)]
  WORKER[ifc-worker<br/>Python 3.13 + IfcOpenShell 0.8.5] -- 잡 폴링 · lease --> PG
  WORKER --> S3
  WEB -. glb (nginx /files/bim/glb) .-> S3
```

컨테이너 5개(web·api·ifc-worker·postgis·minio). 메시지 브로커·Redis 없음 — 잡 큐는 PostgreSQL 테이블(`FOR UPDATE SKIP LOCKED`).

**업로드 → 뷰어 흐름**: `POST /api/projects/{pid}/models`(multipart) → S3 `models/{id}/source.ifc` → `model(UPLOADED)` + `conversion_job(PENDING)` → 워커가 잡을 잡고(`lease_owner`, 30초 heartbeat) IfcOpenShell `geom.iterator` + `serializers.gltf`로 glb 생성 → `element`(GlobalId·클래스·Pset jsonb)·`spatial_node`·`system`·`connection` 벌크 insert → `model(READY)` → 브라우저는 SSE로 진행률을 받고 glb를 로드. glb 노드 이름 = IFC GlobalId라 별도 ID 매핑 테이블이 없다.

### 데이터 모델 (요지)

`project` → `model` → `element`(jsonb Pset, GIN) / `spatial_node`(Site→Building→Storey→Space, adjacency list) / `system` ↔ `element_system`(N:M) / `connection`(from=상류, to=하류) · `asset`(요소 선택적 FK — 모델에 없는 장비도 등록) → `inspection` → `work_order`(viewpoint jsonb = BCF viewpoint 축소판, priority) · `conversion_job`(1:N, attempts·heartbeat_at·lease_owner, 모델당 활성 잡 1개 부분 unique). 상태 enum은 전부 DB `CHECK`.

### 주요 결정과 이유

| 결정 | 이유 |
|---|---|
| API는 Java, IFC 처리는 Python 사이드카 | 기하 엔진·IDS·BCF·COBie 생태계가 Python(IfcOpenShell)에 있고, Java IFC 라이브러리는 기하가 없거나 AGPL. 경계는 DB 테이블과 오브젝트 키뿐 |
| 서버에서 glTF 변환, 브라우저에 IFC 파서 없음 | 대용량 IFC를 클라이언트가 파싱하면 기기 한계. glb는 캐시·CDN·모바일에 유리 |
| Spring MVC + JdbcClient + 가상 스레드 (WebFlux/R2DBC 대신) | 워크로드가 짧은 SQL 다수 + 파일 업로드. 가상 스레드면 블로킹 코드로도 동시성 충분, 트랜잭션·jsonb·재귀 CTE가 JDBC가 훨씬 단순 |
| 잡 큐 = PostgreSQL 테이블 | 워커 1~3개, 분 단위 잡. 브로커는 컨테이너·장애 지점만 늘림. lease/heartbeat로 hang 회수, 부분 unique로 중복 변환 방지 |
| IfcConvert 바이너리 대신 `ifcopenshell.geom` API | 요소 수·진행률을 코드에서 다루고 속성 추출과 같은 프로세스에서 처리 |
| 흐름 연결은 포트 대신 요소 간 관계 | 포트는 요소당 객체 2개 이상 늘고 결국 방향 플래그. 원천→말단을 관계 하나로. 실무 파일(`IfcRelConnectsPorts`)은 변환기 하나 더 붙이면 됨 |
| 팀 ↔ 계통 매핑을 프론트 한 곳(`teams.ts`) | 모니터 격자·보드 색·뷰어 계통 탭이 같은 표를 씀. 순서가 곧 우선순위 |
| 운영 상태는 IFC가 아니라 DB의 것 | IFC는 설계 정보. 재변환하면 상태는 초기값으로 리셋(의도). 파생값(수신기 집계·주차 점유)은 서버가 계산 |
| MapLibre 2D (Cesium 3D Tiles는 보류) | 건물 배치·풋프린트에는 2D면 충분. 3D Tiles는 다음 단계 |

## 기술 스택

Java 25 · Spring Boot 4.1 (MVC, JdbcClient, Flyway, Testcontainers) · PostgreSQL 16 + PostGIS 3.4 · MinIO · Python 3.13 + IfcOpenShell 0.8.5 + pyproj · React 19 + TypeScript + Vite 8 · Three.js 0.185 · MapLibre GL 6 · nginx · Docker Compose

기준 표준: IFC 4.3(ISO 16739-1:2024), 입력은 IFC2x3/IFC4 허용. BCF 3.0 viewpoint·COBie 개념 반영. IDS 검증·COBie 내보내기·3D Tiles는 다음 단계.

## 규모와 보안 (측정 기준)

- 2만 요소 합성 모델: `GET /elements` 124 ms(DB) / 응답 2.5 MB → **gzip 180 KB**. 상태판 76 ms. 검색 ILIKE 22 ms. 병목은 DB가 아니라 페이로드라 페이징은 선택 파라미터로만.
- 외부 노출은 `web`(80) 하나. postgis·minio·api는 `127.0.0.1` 바인딩. nginx는 `/api/`(레이트리밋 20 r/s, 429)와 `/files/bim/glb/`(glb만)만 프록시, 원본 IFC는 경로 자체가 없음. 보안 헤더·`server_tokens off`·`index.html no-cache`. 자격증명은 `.env`.
- 인증은 없음(데모 단일 사용자) — 외부 공개 시 프록시 레벨 Basic/OIDC를 앞에 둘 것.

## 실행

```bash
cp .env.example .env            # 로컬 기본값 bim / minio123 — 외부 배포 전 변경
docker compose up -d --build --wait
# web → http://localhost:5173   (api 8080·minio 9001·db 5432 는 로컬 바인딩)
```

샘플 IFC는 `samples/README.md`(공개 샘플 다운로드 명령, `.ifc`는 git에 없음). 설비 계통 데모 건물은 생성 스크립트로 만듭니다:

```bash
docker compose cp samples/gen/gen_mep.py ifc-worker:/tmp/ && docker compose exec ifc-worker sh -c 'cd /tmp && python gen_mep.py mep-building.ifc' && docker compose cp ifc-worker:/tmp/mep-building.ifc samples/
# 업로드 후 모니터링 페이지 → "자산 일괄 등록", BMS 시뮬레이션:
python3 samples/gen/bms_sim.py <modelId>     # 경보·장애·펌프·수위·정전을 흘려보냄
```

화면: `#/` 모델 목록·업로드 → `#/models/{id}` 3D 뷰어 → `/monitor` 설비 모니터링(`?kiosk=1` 벽면 모드) → `/fm` 시설관리 → `#/map` 지도.

### 개발·테스트

```bash
cd api && ./gradlew test          # Testcontainers(PostGIS) — 컨텍스트, 변환 잡 lease 회수·활성 잡 1개·재변환 정합성
cd ifc-worker && pytest           # 잡 lease, 재시도 정합성
cd web && npm run dev             # 또는 docker compose up -d --build web (이미지 빌드형)
```

UI는 헤드리스 Chrome(puppeteer-core)으로 드래그·클릭·스크린샷을 찍어 검증했습니다.

## 저장소 구조

```
api/          Spring Boot — ModelController(업로드·SSE·재시도·삭제) ElementController(트리·검색·속성)
              SystemController(계통·재귀 CTE 추적) FmController→FmService(자산·점검·작업지시)
              StatusController→StatusService(상태 병합·작업지시 자동·집계·정전·동기화) MonitorController(격자·이벤트)
              resources/db/migration V1~V5
ifc-worker/   main.py(폴링·lease·heartbeat) convert.py(glb) extract.py(요소·Pset·공간·계통·연결) georef.py(지리참조) tests/
web/src/      App(목록·업로드) viewer/(scene.ts Three.js, Viewer, LeftPanel, SystemPanel, StatusEditor, FmPanel, ColorPanel)
              MonitorPage FmPage FmBoard MapPage · teams.ts(팀↔계통) readings.ts(계측 사전) ifcNames.ts(한글 라벨) Section.tsx
samples/      README(공개 샘플) gen/gen_mep.py(가상 건물 생성) gen/bms_sim.py(BMS 시뮬레이터)
compose.yaml  web · api · ifc-worker · postgis · minio
```

## 가상 건물에 대해

36×16 m 업무동, 지하 2층 + 지상 3층 + 옥상. 실무 관행대로 **B2 변전실·발전기실(별실)·펌프실·기계실·수조실·오폐수처리실 + 주차**, **B1 주차장 + 방재실·통신실·주차관제실**, **옥탑 보일러실**(도시가스는 지하로 내리지 않음), 계단실 2개소, 차량 램프 17%(옥외 지상→B1, 건물 내 B1→B2), 슬래브 개구부. 계통은 전기·비상전원·화재감지·급수·급탕·배수·소방·공조·냉난방수·환기·가스·통신·수송·주차관제. 장비 약 200개에 운영 상태(`Pset_BimStatus`)가 들어 있어 경보·정전·주차 점유 시나리오를 바로 돌려볼 수 있습니다. 의도적으로 단순화한 것: 층고 균일 3.5 m, 기둥·창호 없음, 업무동의 에스컬레이터(계통 예시용).

## 한계와 다음 단계

- 실무 IFC의 `IfcRelConnectsPorts` → `connection` 변환기 (스키마는 그대로)
- 작업지시에 영향 범위(하류 요소·구역) 첨부, 인증, IDS 검증·COBie 내보내기, 3D Tiles, CI(빌드→테스트→Trivy)
