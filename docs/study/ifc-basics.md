# IFC 기초 (M0 학습 노트)

> 초안. M0 진행하며 실제 파일 열어보고 보강할 것.

## IFC란

Industry Foundation Classes. buildingSMART가 관리하는 건물 정보의 개방형 교환 스키마. ISO 16739. 상용 BIM 툴(Revit, ArchiCAD 등) 사이의 중립 포맷.

## 파일 형식

| 형식 | 확장자 | 비고 |
|---|---|---|
| STEP Physical File (ISO 10303-21) | `.ifc` | 텍스트. `#123=IFCWALL('guid',...)` 행 나열. 가장 흔함 |
| ifcXML | `.ifcxml` | 크기 큼, 드묾 |
| ifcZIP | `.ifczip` | 위 둘의 zip |
| ifcJSON / IFCX | `.json` / `.ifcx` | IFC5 계열, 아직 alpha |

스키마 정의 언어는 EXPRESS (ISO 10303-11). IfcOpenShell은 EXPRESS 스키마를 읽어 파싱하므로 IFC2X3/IFC4/IFC4X3 를 모두 같은 API로 다룬다.

## 파일 머리

```
ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('x.ifc','2026-08-28T00:00:00',...);
FILE_SCHEMA(('IFC4'));      ← 스키마 버전. worker가 model.ifc_schema 에 저장
ENDSEC;
DATA;
#1=IFCPROJECT('2O2Fr$t4X7Zf8NOew3FLOH',...);
...
```

## 핵심 개념

- **GlobalId**: 22자 base64 압축 GUID. 요소 식별자. 파일 재수출 시에도 유지되어야 하지만 툴마다 다름 → 우리 시스템의 요소 키.
- **공간 구조**: `IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → IfcSpace`. 관계는 `IfcRelAggregates`(구조 간), `IfcRelContainedInSpatialStructure`(요소 → 공간).
- **요소(Product)**: `IfcWall`, `IfcDoor`, `IfcSlab`, `IfcFlowTerminal`(설비) … 모두 `IfcProduct` 하위. 형상은 `Representation`, 위치는 `ObjectPlacement`(상대 배치 체인).
- **속성**: `IfcPropertySet`(Pset_WallCommon 등) ↔ 요소는 `IfcRelDefinesByProperties`. 수량은 `IfcElementQuantity`(Qto_*).
- **타입**: `IfcWallType` 등. 인스턴스 여러 개가 타입 하나를 공유(`IfcRelDefinesByType`). COBie의 Type/Component 가 여기서 온다.
- **단위**: `IfcUnitAssignment`. 대부분 미터/밀리미터. glb 변환 시 미터로 통일.
- **MVD (Model View Definition)**: 스키마의 부분집합 규약. IFC4 `ReferenceView`(조율용, 기하 단순) vs `DesignTransferView`. IFC2x3는 `CoordinationView 2.0`.

## 지리참조 (M3에서 상세)

- IFC4+: `IfcMapConversion` + `IfcProjectedCRS` (EPSG 코드, Eastings/Northings, 회전).
- IFC2x3: `IfcSite.RefLatitude/RefLongitude` (도·분·초 튜플) 정도가 전부.
- 없는 파일이 많다 → 수동 핀 필요. 관련 개념: LoGeoRef 등급(0~50).

## IfcOpenShell 첫 코드

```python
import ifcopenshell, ifcopenshell.util.element as ue
f = ifcopenshell.open("sample.ifc")
print(f.schema)                          # 'IFC4'
walls = f.by_type("IfcWall")
w = walls[0]
print(w.GlobalId, w.Name)
print(ue.get_psets(w))                   # {'Pset_WallCommon': {...}}
print(ue.get_container(w))               # IfcBuildingStorey
```

## 샘플 파일 출처

- buildingSMART Sample-Test-Files: https://github.com/buildingSMART/Sample-Test-Files
- IfcOpenShell test files: https://github.com/IfcOpenShell/files
- 선정 후보: IFC2x3 Duplex Apartment, IFC4 Schependomlaan, IFC4x3 공식 샘플 1종 (M0에서 확정)

## 참고

- https://technical.buildingsmart.org/standards/ifc/ifc-schema-specifications/
- https://docs.ifcopenshell.org/
- https://ifc43-docs.standards.buildingsmart.org/
