# IFC 공간 구조와 요소 매핑 (M2 학습 노트)

> 뷰어의 트리·층 필터·클릭→속성이 어떤 IFC 관계 위에 서 있는지. 코드는 `worker/extract.py`, `ElementController`, `web/src/viewer`.

## 계층

```
IfcProject
 └─ IfcSite            (IfcRelAggregates)
     └─ IfcBuilding
         └─ IfcBuildingStorey   Elevation (m)
             ├─ IfcSpace        (IfcRelAggregates — Storey 의 "부분")
             └─ IfcWall, IfcDoor …   (IfcRelContainedInSpatialStructure — Storey 에 "담김")
```

- **Aggregates 와 Contained 는 다른 관계다.** Space 는 층의 분해(부분)이고, 벽·문은 층에 담긴 것. 그래서 공간 트리는 `IsDecomposedBy` 만 재귀하면 Site→…→Space 가 나오고, 요소는 `get_container()` 로 층/실을 찾는다.
- 요소가 Space 에 담기는 경우도 있다(가구 등, Contained 의 대상이 IfcSpace). 우리 `element.spatial_node_id` 는 Space 든 Storey 든 그대로 가리키고, 층 필터는 "층 + 그 아래 Space 전부" 로 재귀(SQL `WITH RECURSIVE`, 프론트는 parentId 로 집합 확장).
- Site 가 둘인 파일도 있다(IFC4x3 샘플: environment site + house site). Project 밑에 여러 루트가 가능하므로 트리는 forest 로 다룬다.
- 컨테이너 없는 요소(AC20-FZK-Haus 3개) → `spatial_node_id NULL`. "전체" 에서는 보이고 층 필터에선 빠진다.

## 층 정렬

`IfcBuildingStorey.Elevation` 오름차순. 이름("Level 2", "2F", "Erdgeschoss")은 정렬 근거가 안 된다. Elevation 이 None 인 파일(IFC4x3 샘플)은 삽입 순서 유지.

## GlobalId 의 유일성

- 22자, IFC 파일 안에서 유일. **파일 간엔 아니다** — 같은 파일을 두 번 올리면 같은 GlobalId 가 두 모델에 있다(실측: `element` 에 2건씩). 그래서 요소 조회는 `/api/models/{id}/elements/{globalId}` 모델 스코프.
- 문자 집합에 `$` 와 `_` 가 있다. URL 엔 `encodeURIComponent`, 셸에선 따옴표 필수(`$` 확장으로 한 번 당했다).
- 저작 도구가 재수출 시 유지하는 게 원칙이지만 복사·붙여넣기 하면 바뀌기도 한다. FMS 자산(M4)이 요소에 매달릴 때 "GlobalId 가 사라지면?" 이 설계 이슈 → `asset.element_id` nullable 인 이유.

## Pset / Qto

- `IfcPropertySet`(Pset_*) 은 이름-값, `IfcElementQuantity`(Qto_*) 는 길이·면적·부피. `get_psets()` 는 둘 다 한 dict 로 준다.
- 표준 Pset 은 클래스별로 정해져 있다: `Pset_WallCommon.IsExternal / LoadBearing / FireRating`, `Pset_DoorCommon`, `Pset_SpaceCommon` … 검색·필터의 안정적 키는 이것들. 벤더 Pset(`PSet_Revit_*`) 은 툴마다 달라 표시만 한다.
- 타입 Pset: 인스턴스가 아니라 `IfcWallType` 에 붙은 것도 `get_psets()` 가 합쳐 준다(Revit 수출본의 `PSet_Revit_Type_*`). 인스턴스 값이 있으면 인스턴스가 이긴다.

## glb 노드 ↔ DB 행

| glb 노드(GlobalId) | DB | 뷰어 분류 |
|---|---|---|
| `element` 에 있음 | element 행 + Pset | `element` — 클릭하면 속성 |
| `spatial_node` 의 IfcSpace | spatial_node 행 | `space` — 반투명, 토글 |
| 둘 다 없음 | 없음 (Opening 은 element 에서 제외) | `opening` — 기본 숨김 |

분류를 변환 시점이 아니라 뷰어에서 하는 이유: 같은 glb 로 세 가지를 다 토글할 수 있고, 재변환 없이 규칙을 바꿀 수 있다.
