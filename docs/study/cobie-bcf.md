# COBie · BCF — FMS 가 BIM 과 만나는 두 표준 (M4 학습 노트)

> 우리 `asset / inspection / work_order` 가 두 표준의 어느 부분을 축소한 것인지. 도메인 배경은 [fm-domain.md](fm-domain.md).

## COBie (Construction-Operations Building information exchange)

설계·시공 단계의 정보를 **운영(FM)에 인계**하기 위한 스프레드시트 규격. IFC 의 부분집합을 시트로 펼친 것이라 "IFC 를 엑셀로 본 것" 이 정확하다. buildingSMART 가 관리, 영국 BIM Level 2 에서 의무화되며 퍼졌다.

| 시트 | 내용 | IFC 대응 | 우리 |
|---|---|---|---|
| Facility | 건물 | IfcBuilding | `model` |
| Floor / Space | 층·실 | IfcBuildingStorey / IfcSpace | `spatial_node` |
| **Type** | 제품 타입(제조사·모델·보증·수명) | IfcTypeObject + Pset_ManufacturerTypeInformation | `asset.category` + `attributes` 로 단순화 |
| **Component** | 설치된 개별 자산 | IfcElement (GlobalId, 태그, 설치일, 직렬번호) | **`asset`** — `tag`, `installed_on`, `element_id` |
| System / Zone | 설비 계통·구역 | IfcSystem / IfcZone | 범위 밖 |
| Job / Resource / Spare | 유지보수 작업·자원·예비품 | — | `inspection`·`work_order` 가 Job 의 축소 |
| Attribute / Document | 속성·문서 | Pset / IfcDocumentReference | `attributes` jsonb |

핵심 통찰 두 가지:
- **Component ≠ 모든 IfcElement.** 벽·슬래브는 COBie 에 안 들어간다. 유지보수 대상(문·설비·센서)만. 그래서 우리는 "모든 요소가 자산" 이 아니라 **선택한 요소만 자산으로 등록** 한다.
- **Type 이 있어야 대장이 쓸 만하다.** 문 50개의 제조사·내화등급을 50번 입력하지 않으려고 Type 을 둔다. 우리는 등록 시 `Pset_*Common` 을 `attributes` 로 스냅샷 떠서 재입력을 없앴고, Type 정규화는 M5 COBie 내보내기 때.

## BCF (BIM Collaboration Format)

모델 **위에** 이슈를 꽂는 포맷. IFC 를 바꾸지 않고 "여기 이 요소가 문제" 를 주고받는다(BIMcollab, Solibri, Revizto 가 쓴다). buildingSMART 관리, 현재 3.0.

```
.bcfzip
 └─ {topic-guid}/
     ├─ markup.bcf      topic(제목·상태·담당·기한), comments
     ├─ viewpoint.bcfv  camera(위치·방향·FOV), components(선택 GlobalId, 표시/숨김), clipping planes
     └─ snapshot.png
```

| BCF | 우리 `work_order` |
|---|---|
| Topic: title, status, assigned_to, due_date | `title, status, assignee, due_on` — 1:1 |
| Viewpoint: PerspectiveCamera(CameraViewPoint, Direction, UpVector, FOV) | `viewpoint.v` = 카메라 위치 + 타깃 (up 은 Y 고정, FOV 60 고정) |
| Viewpoint: Components.Selection (IfcGuid) | `viewpoint.sel` |
| Viewpoint: ClippingPlanes | `viewpoint.clip` (축 정렬 박스 6값으로 축소) |
| Viewpoint: Visibility(숨김 목록) | 없음 — 필요하면 `hidden` 추가 |
| Comments, snapshot | 없음 |

**왜 축소본인가.** BCF 는 툴 간 교환 포맷이라 카메라 수학이 일반적(임의 up·FOV)이고 파일 패키징이 있다. 우리는 같은 뷰어 안에서 저장·복원만 하면 되므로 **뷰어 URL 과 같은 필드**(`v, sel, clip`)를 jsonb 로 넣었다. 뷰어 URL 공유 기능이 곧 BCF viewpoint 의 데모판이고, work_order 는 거기에 topic 필드를 붙인 것. 정식 `.bcfzip` 내보내기는 M5 후보 — 필드가 이미 1:1 이라 변환기만 쓰면 된다.

## 우리 순환과 표준의 관계

```
IfcElement ──등록──▶ asset(COBie Component)
                       │ inspection(OK|DEFECT)
                       ▼
                   work_order(BCF topic + viewpoint) ──▶ 뷰어 복원
```

- 점검 → 결함 → 작업지시 연결(`work_order.inspection_id`)은 COBie Job 의 "원인" 개념을 최소로 가져온 것.
- 자산 삭제 시 점검·작업지시 CASCADE, 요소 삭제(모델 재변환) 시 `asset.element_id` SET NULL — 자산은 살고 3D 연결만 끊긴다. FMS 데이터가 BIM 재변환보다 오래 산다는 [fm-domain.md](fm-domain.md) §4 의 구현.

## 참고

- COBie: https://www.nibs.org/nbims/cobie · buildingSMART Data Dictionary
- BCF 3.0: https://github.com/buildingSMART/BCF-XML/tree/release_3_0
