# FM 도메인 — BIM 위의 시설관리

> 이 프로젝트의 FMS 영역이 무엇을, 왜 그렇게 담았는지. 면접 설명용 노트.
> 테이블 정의는 [02-data-model.md](../02-data-model.md) 참조.

## 1. BIM 참여자: 만드는 쪽 / 쓰는 쪽

| 단계 | 누가 | 도구 | 모델을 |
|---|---|---|---|
| 설계 | 건축가·설계사 | Revit, ArchiCAD (저작 도구) | **만들고 고친다** |
| 시공·검토 | 시공사, 발주처, 감리 | Speckle, BIMcollab, ACC (플랫폼) | 보고, 검토하고, 이슈를 꽂는다 |
| 운영 | 시설관리자 | FMS | 준공 모델 위에 **운영 정보를 쌓는다** |

이 프로젝트는 세 번째 줄. 설계·시공은 1~3년, 운영은 30~50년이라 "설계자가 만든 모델을 운영에서 어떻게 활용하나"가 BIM 업계의 큰 주제.

그래서 **IFC write-back은 범위 밖**. 플랫폼이 IFC 기하를 고치면 저작 도구의 원본과 어긋난다. 설계 변경은 설계자가 하고 IFC를 다시 내보내는 게 정석. 이 프로젝트가 하는 "쓰기"는 모델 위에 정보를 덧붙이는 것(asset, inspection, work_order)뿐.

## 2. FMS가 하는 일

| 영역 | 내용 | 예 | 이 프로젝트 |
|---|---|---|---|
| 자산 관리 | 설비·부품 대장 | 공조기 #3, 3층 방화문 12개 | `asset` |
| 예방 점검 | 주기 점검 계획·실행·기록 | 소방 월 1회, 승강기 분기 1회 | `inspection` |
| 작업지시 | 결함 → 수리 요청 → 배정 → 완료 | "방화문 클로저 교체, 담당 김OO, 9/5까지" | `work_order` |
| 공간 관리 | 층·실 면적, 용도, 점유 | 임대 면적 집계 | `spatial_node`로 대체 |
| 에너지·설비 운전 | 사용량, BMS 연동 | — | 범위 밖 |
| 이력·보고 | 설비별 수리 이력, 비용, 잔여 수명 | 교체 시기 판단 | 범위 밖 |

핵심 순환: **자산 → 점검 → 결함 → 작업지시 → 완료 → 이력**.

```
element(IFC) ─0..1─ asset ─1:N─ inspection(OK|DEFECT)
                       └─1:N─ work_order(OPEN|IN_PROGRESS|DONE) ←(선택)─ inspection
```

## 3. BIM이 붙으면 달라지는 것

기존 FMS의 자산은 **엑셀 대장 한 줄**. "3층 방화문 #12"가 어디 있는지는 담당자 머릿속이나 별도 도면.

`asset.element_id`로 **3D 모델의 그 문**에 직접 연결되면:

- 작업지시를 열면 뷰어가 그 요소로 카메라 이동 + 하이라이트 (`work_order.viewpoint`)
- 자산 등록 시 IFC Pset(제조사, 내화등급, 설치층)을 재입력 없이 가져옴
- 뷰어에서 "3층 모든 방화문"을 골라 한 번에 자산 등록

→ [00-overview.md](../00-overview.md) 데모 시나리오 4번.

## 4. 설계 근거 두 가지

**`asset.element_id` nullable, `model_id` NOT NULL**
준공 후 설치한 CCTV·소화기·임차인 장비는 IFC에 없다. 실제 FMS에서 모델에 없는 자산이 절반을 넘기도 한다. 요소 연결은 선택이지만 "어느 건물 소속"은 강제.

**`work_order.viewpoint` jsonb**
BCF 3.0 viewpoint(카메라 위치·방향 + 선택된 GlobalId)의 축소판. 기존 FMS에서 못 하던 "작업지시 → 현장 위치로 바로 이동"을 만든다. BCF 파일 포맷 자체는 만들지 않음.

## 5. 표준 대응

> 상세는 [cobie-bcf.md](cobie-bcf.md).

| 표준 | 무엇 | 이 프로젝트 |
|---|---|---|
| COBie | 설계·시공 → 운영 인계 자산 정보 규격 (Component / Type / Space / System 시트) | Component ≈ `asset`. Type은 `category` + `attributes`로 단순화. 정식 내보내기 M5 |
| BCF 3.0 | 모델 위에 이슈를 핀으로 꽂는 협업 포맷 (topic + viewpoint) | viewpoint만 `work_order.viewpoint`로 축소 |

## 6. 면접 프레이밍

> 이력서의 FMS 앱 경험을 BIM 위에 다시 얹은 데모. 그때 엑셀 대장이던 자산을 3D 모델에 직접 연결하면 어떻게 되는지 보여주려 했다.

강조 포인트:
1. `asset.element_id` nullable — "실제로 해보니 모델에 없는 자산이 많더라"는 경험 기반 설계
2. `work_order.viewpoint` — 기존 FMS에 없던 기능. BCF 표준을 알고 필요한 부분만 축소했다는 점까지
