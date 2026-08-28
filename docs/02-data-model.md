# 02. 데이터 모델

```mermaid
erDiagram
  project ||--o{ model : has
  model ||--o{ element : contains
  model ||--o{ spatial_node : contains
  model ||--o{ conversion_job : queued_by
  spatial_node ||--o{ spatial_node : parent
  spatial_node ||--o{ element : located_in
  element ||--o| asset : registered_as
  asset ||--o{ inspection : has
  asset ||--o{ work_order : has
  inspection ||--o{ work_order : raises

  project {
    uuid id PK
    text name
    geometry location "Point,4326 nullable"
    timestamptz created_at
  }
  model {
    uuid id PK
    uuid project_id FK
    text name
    text ifc_schema "IFC2X3 | IFC4 | IFC4X3"
    text status "UPLOADED|PROCESSING|READY|FAILED"
    text ifc_key "minio object key"
    text glb_key
    geometry footprint "Polygon,4326 nullable"
    jsonb map_conversion "IfcMapConversion/IfcSite 원본값"
    bigint element_count
    timestamptz created_at
  }
  element {
    bigint id PK
    uuid model_id FK
    text global_id "IFC GlobalId, unique per model"
    text ifc_class "IfcWall, IfcDoor..."
    text name
    bigint spatial_node_id FK
    jsonb properties "Pset_* 평탄화"
  }
  spatial_node {
    bigint id PK
    uuid model_id FK
    bigint parent_id FK
    text global_id
    text ifc_class "IfcSite|IfcBuilding|IfcBuildingStorey|IfcSpace"
    text name
    real elevation
  }
  conversion_job {
    bigint id PK
    uuid model_id FK
    text status "PENDING|RUNNING|DONE|FAILED"
    int progress
    int attempts "재시도 횟수, 3 초과 시 FAILED"
    text error
    timestamptz started_at
    timestamptz finished_at
  }
  asset {
    uuid id PK
    uuid model_id FK
    bigint element_id FK "nullable"
    text tag "자산 태그"
    text category "설비/문/창/소방..."
    text status "ACTIVE|OUT_OF_SERVICE|RETIRED"
    date installed_on
    jsonb attributes
  }
  inspection {
    uuid id PK
    uuid asset_id FK
    date inspected_on
    text result "OK|DEFECT"
    text note
  }
  work_order {
    uuid id PK
    uuid asset_id FK
    uuid inspection_id FK "nullable"
    text title
    text status "OPEN|IN_PROGRESS|DONE"
    text assignee
    date due_on
    jsonb viewpoint "카메라 + 선택 GlobalId (BCF viewpoint 축소판)"
  }
```

## 설계 근거

- **element.properties jsonb**: Pset 종류가 모델마다 다르다. 정규화하면 테이블 폭발. GIN 인덱스(`jsonb_path_ops`)로 `properties @> '{"Pset_WallCommon":{"IsExternal":true}}'` 조회.
- **spatial_node adjacency list**: 깊이 최대 4(Site→Building→Storey→Space). 재귀 CTE로 충분. ltree 안 씀.
- **asset ↔ element 선택적 FK**: IFC에 없는 자산(추가 설치 장비)도 등록 가능. 그래서 `asset.model_id`를 따로 둔다 — element가 NULL이어도 어느 모델(건물) 소속인지는 알아야 한다. COBie의 Component–Type 관계는 `category` + `attributes`로 단순화. COBie 정식 내보내기는 M5.
- **work_order.viewpoint**: BCF 3.0 viewpoint(카메라·컴포넌트 선택)를 jsonb로 축소 저장. BCF 파일 포맷 자체는 만들지 않음.
- **footprint 계산**: 지리참조가 있으면 IfcSite 하위 IfcBuilding 요소의 XY 바운딩 박스(또는 convex hull)를 EPSG 변환 후 저장. 없으면 NULL, UI에서 수동 핀(Point) → `project.location`.
- **conversion_job 1:N**: 재시도는 새 행 insert. 실패 이력이 남고 `model.status`는 최신 잡 기준.
- **인덱스**: `element(model_id, ifc_class)`, `element(model_id, global_id)` unique, `model USING GIST(footprint)`, `conversion_job(status)`.
- **ifc_schema 정규화**: 헤더 `FILE_SCHEMA`는 `IFC4X3_ADD2`, `IFC4X1` 처럼 접미가 붙는다. 접두 매칭(`IFC2X3` / `IFC4X3` / 그 외 `IFC4` 시작 → `IFC4`)으로 3값 중 하나만 저장.
- **제약은 DB에**: status/result 류는 전부 `CHECK`, `asset UNIQUE(model_id, tag)`, `element UNIQUE(model_id, global_id)`. 앱 코드에서 enum 검증 안 함.
- **삭제 전파**: 소유 관계(model→element 등)는 `ON DELETE CASCADE`, 참조 관계(`element.spatial_node_id`, `asset.element_id`, `work_order.inspection_id`)는 `SET NULL`.
- **마이그레이션**: Flyway (api 기동 시, `api/src/main/resources/db/migration`). worker는 스키마를 소유하지 않는다. **이 문서와 V1 SQL은 1:1** — 둘 중 하나 바꾸면 나머지도.
