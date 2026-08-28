# 05. 규모 측정과 외부 배포 보안

## 규모 측정 (2026-08-28)

실제 대형 IFC 가 없어서 mep-building(404요소)을 DB 에서 50배 복제한 합성 모델(**20,200 요소**, 속성 jsonb 포함)로 주요 쿼리를 `EXPLAIN ANALYZE` 하고 API 응답 크기를 쟀다. 재현: `model` 행 하나 추가 후 `INSERT INTO element … SELECT … FROM element WHERE model_id = <원본>` 을 50회(global_id 에 접미 붙임), `ANALYZE element`. 측정 후 그 모델 행은 지운다(glb 가 없어 뷰어가 열지 못함).

| 쿼리 / API | DB 실행 | API 응답 | 비고 |
|---|---|---|---|
| `GET /elements` 전체 (뷰어 초기 로드) | 124 ms (seq scan 2.8 ms + 정렬) | 167 ms, **2.5 MB** | 병목은 DB 가 아니라 페이로드 |
| `GET /elements?q=` ILIKE 검색 | 22 ms | 6 ms | pg_trgm 인덱스 불필요 (10만 요소 전까지) |
| `GET /property-keys` (jsonb_each 집계) | 21 ms | 16 ms | |
| `GET /property-values?key=` | 6 ms | 16 ms, 660 KB | |
| `GET /status` (상태판) | 76 ms | 116 ms, **2 MB** | 합성 모델이라 전 요소에 상태가 있음(실제는 장비만) |
| `GET /elements/{gid}` | 0.4 ms | — | unique 인덱스 |
| `GET /spatial` | — | 5 ms, 3 KB | |

선형 외삽: 20만 요소면 elements 목록 ≈1.2 s / 25 MB. 그 전에 손댈 순서는 (1) 페이로드 → (2) 정렬 → (3) 스캔.

### 한 것
- **nginx gzip** (`application/json`) — elements 2.5 MB → **180 KB**. 코드 변경 없이 가장 큰 효과.
- **`/elements?limit=&offset=`** 선택 파라미터 (기본은 전체). 뷰어 트리는 전체가 필요해 지금은 안 쓰고, 외부 연동·목록 UI 용.

### 안 한 것 (근거)
- **뷰어 LOD·분할 로드**: 현 최대 모델 82k 삼각형. 소프트웨어 렌더(헤드리스 swiftshader)에서도 20 fps. LOD 가 필요한 시점은 수백만 삼각형(`webgl-performance.md`) — 그때 층별 glb 분할(worker 가 storey 단위로 serializer 호출) → 뷰어가 가시 층만 로드가 첫 단계. 인스턴싱/병합은 이미 GLTF 노드 단위라 다음.
- **pg_trgm**: 22 ms. 
- **커서 페이징**: offset 으로 충분한 크기.

## 외부 배포 보안 보강 (2026-08-28)

로컬 데모 구성을 그대로 외부에 두면 위험한 것들을 막았다. TLS 종단·인증은 여전히 앞단(리버스 프록시·SSO)의 몫이며 이 저장소는 **비인증 API** 다 — 외부 공개 전 최소한 프록시 레벨 Basic/OIDC 를 붙일 것.

| 항목 | 전 | 후 |
|---|---|---|
| 자격증명 | compose·application.yml·worker 에 `bim`/`minio123` 하드코딩 | `.env`(`.env.example` 참고) → `POSTGRES_PASSWORD`, `MINIO_ROOT_USER/PASSWORD` → api(`DB_PASSWORD`, `S3_ACCESS_KEY/SECRET_KEY`)·worker 동일 env. 기본값은 로컬 개발용 |
| 포트 노출 | postgis 5432, minio 9000/9001, api 8080 이 `0.0.0.0` | 전부 `127.0.0.1` 바인딩. 외부는 **web(80) 하나** |
| MinIO 원본 IFC | `/files/` 가 버킷 전체 프록시(버킷 정책만으로 차단) | nginx 는 `/files/glb/` 만 프록시. `models/…/source.ifc` 는 경로 자체가 없음(index.html 폴백) — 정책 + 프록시 이중 차단 |
| actuator | api 직접 접근 시 health 노출 | web 경유 `/actuator/` 404. api 는 로컬 바인딩 |
| 응답 헤더 | 없음 | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `server_tokens off` |
| 레이트리밋 | 없음 | `/api/` IP 당 20 req/s, 버스트 40, 초과 시 **429** (뷰어 초기 로드 5~6 요청 기준) |
| 업로드 | `.ifc` 확장자 + 500 MB 상한 (기존) | 동일 |

검증(2026-08-28): gzip 180 KB, `/files/glb/{id}.glb` 200, `/files/models/{id}/source.ifc` → text/html 462 B(index), `/actuator/health` 404, 60회 연타 시 429 7회, 컨테이너 포트 `127.0.0.1:*` 확인.

### 남은 것
- 인증(프록시 Basic 또는 OIDC) — 이 저장소 범위 밖
- CSP 헤더 — Three.js/MapLibre 인라인 워커 때문에 `worker-src blob:` 등 조정 필요, 실배포 시
- MinIO 콘솔(9001) 은 로컬 바인딩이라 SSH 터널로만
