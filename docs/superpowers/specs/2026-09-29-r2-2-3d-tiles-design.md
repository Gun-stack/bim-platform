# R2-2 3D Tiles 대용량 — 상세 설계

- 날짜: 2026-09-29
- 로드맵: `2026-09-29-round2-tech-depth-design.md` 4절
- 진행 방식: 사용자 "중지 없이 끝까지" — 세부 결정은 이 문서에 이유와 함께

## 1. 현재 상태 (실측)

- IfcOpenShell GLB 구조: 루트 노드 = 요소 1개(`name` = GlobalId, `matrix` = Z-up→Y-up 회전), 노드마다 메시 1개·프리미티브 1개(드물게 여럿), 접근자 3개(indices·POSITION·NORMAL)·버퍼뷰 3개, 버퍼 1개, 재질 26개 공유. 자식 노드 없음
- mep-building 1,729노드 GLB 13.4MB. mep-large 5,269요소 GLB 48.9MB, 뷰어 로드 2.0~3.8초
- 뷰어 `Scene3D.load()` 는 GLB 하나를 한 번에 받아 `meshes`·`kind`·`tiers`·`edges` 를 채운 뒤 모든 기능이 이 목록을 전제
- MinIO 익명 읽기는 `glb/` 접두어만, nginx 는 `/files/bim/glb/` 만 프록시

## 2. 효과 목표 — 무엇을 증명하나

- 첫 화면 시간: 단일 GLB 는 전체를 받아야 첫 프레임. 타일은 동별 외피(작음)부터 → 층이 흘러 들어옴
- 근접 메모리: 기계실 근접처럼 화면 밖·먼 층은 안 받거나 해제 → 삼각형·지오메트리 수 감소
- 홈 뷰에선 X-ray 로 설비까지 보이는 게 제품 가치 → 홈 거리에서는 층 타일까지 정제되도록 오차 값을 잡는다(멀리 빠질 때만 외피)

## 3. 타일셋 (3D Tiles 1.1)

- `tileset.json` — 좌표는 3D Tiles 규약대로 Z-up(= IFC 월드 좌표). glTF 콘텐츠는 Y-up(노드 행렬 그대로) — 런타임이 Y→Z 로 돌리는 표준 관례와 일치
- 트리: 루트(대지) → 동(콘텐츠 = 외피 GLB, `REPLACE`) → 층(콘텐츠 = 층 GLB, 잎). 동·층에 속하지 않는 요소는 루트 콘텐츠 `site.glb`
- 외피 = 그 동의 수평·수직 건축 요소(뷰어 `tier` 와 같은 분류: `IfcSlab|Roof|Covering`, `IfcWall|CurtainWall|Window|Door|Column|Beam|Stair|Ramp|Railing|Plate|Member`)
- `boundingVolume.box` = 콘텐츠 POSITION 접근자 min/max 를 노드 행렬로 변환 후 Y-up→Z-up 되돌린 축 정렬 박스
- `geometricError`: 층 = 0(잎), 동 = 동 대각선/40, 루트 = 대지 대각선/10 — 화면 오차 임계 16px·세로 950px·FOV 60° 에서 동은 거리 ≈ 1.27×대각선 안쪽이면 층으로 정제(홈 뷰 거리 ≈ 1.1×대각선)
- 타일 id: 동·층의 IFC GlobalId (`extras.globalId`) — 뷰어가 요소 → 층 관계(API `spatial`)로 필요한 타일을 찾는다

## 4. 워커 — GLB 분할기 `worker/tiles.py` (새 의존성 없음)

- `split_glb(glb: bytes, groups: dict[str, list[str]]) -> dict[str, bytes]` — 그룹 이름 → 노드 GlobalId 목록. 선택 노드의 메시 → 접근자 → 버퍼뷰만 새 BIN 에 4바이트 정렬로 복사, 인덱스 재매핑, 재질은 쓰인 것만
- `bounds(glb: bytes) -> [minx,miny,minz,maxx,maxy,maxz]` (Z-up) — POSITION min/max × 노드 행렬
- `tileset(site_box, buildings) -> dict` — 3절 트리
- `main.convert` 에서 GLB 업로드 직후: 그룹 계산(extract 결과의 요소 → 층 → 동) → 분할 → `glb/{model}/tiles/{lease}/` 에 업로드(기존 익명 읽기 접두어·nginx 경로 재사용) → 같은 트랜잭션에서 `model.tileset_key` 공개
- 테스트: 합성 GLB(노드 3개·재질 2개)로 분할 결과가 유효한 GLB(매직·청크 정렬·접근자 수·BIN 길이), 노드 이름 보존, 경계 상자 변환

## 5. API

- Flyway `V9__tileset.sql`: `model.tileset_key text`
- 모델 응답에 `tilesetUrl` (`/files/{bucket}/{tileset_key}`, 있을 때만)

## 6. 뷰어 — 자체 순회기 `viewer/tiles.ts` + Scene3D 증분 로드

- 사용 조건: `tilesetUrl` 이 있고 요소 수 ≥ 3,000, 또는 `?tiles=1`(`?tiles=0` 은 강제 끔)
- `Scene3D`
  - `load()` 의 메시 등록부를 `addContent(root, tileId)` 로 추출(단일 GLB 도 같은 경로) + `removeContent(tileId)`(지오메트리 해제·목록 제거)
  - 메시 `userData.tile`, 타일 표시 여부 `tileShown(tile)` 을 `apply()` 가시성에 AND
  - `REPLACE`: 동의 보이는 층 타일이 모두 준비되면 외피 타일 숨김, 층이 해제되면 외피 다시 표시
  - 병합 모드는 타일 모드에서 끔(토글 비활성 + title 설명)
  - 등장 연출: 타일 모드에선 층이 들어오는 것 자체가 연출 — 기존 절단면 등장은 생략
- `tiles.ts` 순회기: 250ms 마다(카메라가 움직일 때만) 화면 공간 오차 계산 → 정제 대상 층 타일 요청(동시 4개, 가까운 순), LRU 캐시 삼각형 예산 초과 시 화면 밖·먼 타일부터 해제. 선택·추적·포커스 중인 요소의 타일은 고정(pin)
- `ensureLoaded(gids)`: 요소 → 층(API spatial 조상) → 층 타일을 즉시 로드·고정. 트리 선택·딥링크 `?sel`·추적 결과·펄스 대상이 호출
- 통계 툴팁에 "타일 N/M" 추가

## 7. 측정

- 기준 모델: `gen_mep.py --floors 40 --annex 2 --density high` (초대형, 이름 `mep-xlarge.ifc`)
- 스크립트 `$SP/tiles-bench.mjs`: `?tiles=0` 대 `?tiles=1` — 첫 프레임까지(통계 draw calls > 0), 전체 정제 완료까지, 홈 뷰·기계실 근접에서 삼각형·지오메트리 수, fps
- README "규모 측정" 표에 추가

## 8. 환경 제약 (이 사내망)

- 워커 이미지 재빌드는 pip TLS 로 실패 → `FROM bim-platform-ifc-worker` + `COPY worker/ /app/worker/` 이미지 교체, `up -d --no-build --force-recreate ifc-worker`
- 뷰어는 새 npm 의존성 없음(자체 순회기) — web 컨테이너 빌드 가능

## 9. 제외

- meshopt·Draco 압축(의존성) — nginx gzip 으로 전송량은 이미 1/5
- 층 안에서의 추가 LOD(설비 박스 프록시)
- 암시적 타일링(implicit tiling), 3d-tiles-validator 를 CI 에 넣는 것 — 구조만 규약 준수
