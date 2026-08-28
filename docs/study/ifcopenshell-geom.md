# IfcOpenShell geom — 변환 파이프라인에서 실제로 부딪힌 것 (M1 학습 노트)

> 버전 0.8.5 (pip). 수치는 worker 컨테이너(arm64, cpu 10)에서 샘플 4종으로 측정 (2026-08-28). 결정은 [ADR 0005](../adr/0005-gltf-serializer-over-ifcconvert.md).

## 구조

```
ifcopenshell.open(path)            # 파싱. 스키마(IFC2X3/4/4X3)는 EXPRESS 로 자동 판별
geom.settings()                    # 기하 옵션 (OpenCASCADE 커널)
geom.iterator(settings, file, threads)   # 요소별 삼각형 메시를 순서대로 생산
geom.serializers.gltf(path, settings, serializer_settings)   # IfcConvert 와 같은 C++ 직렬화기
```

`iterator` 는 "요소 하나 = 메시 하나". `it.get()` 이 `TriangulationElement`(verts/faces/materials + GlobalId/type/name), `it.next()` 가 False 면 끝. serializer 는 이걸 받아 파일에 쌓는다. IfcConvert 바이너리는 이 둘을 감싼 CLI일 뿐이라 Python 에서 같은 결과를 얻는다.

## settings — 우리가 건드린 것과 기본값

| 키 | 기본 | 우리 값 | 왜 |
|---|---|---|---|
| `use-world-coords` | False | **True** | 기본은 요소 로컬좌표 + 변환행렬. glb 노드에 행렬을 넣어도 되지만 뷰어에서 raycast·바운딩 계산이 단순해지도록 월드좌표로 굽는다 |
| `weld-vertices` | True | **False** | True 면 정점 공유로 파일이 작아지지만 노멀이 평균화되어 각진 건물 모서리가 뭉개진다. 크기 문제 생기면 True 로 돌리고 압축은 gltf-transform |
| `mesher-linear-deflection` | 0.001 | 기본 | 곡면 근사 정밀도(m). 파이프·곡면벽이 많으면 0.01 로 올려 삼각형 수를 줄인다 |
| `mesher-angular-deflection` | 0.5 | 기본 | 곡면 각도 근사(rad) |
| `apply-default-materials` | True | 기본 | 재질 없는 요소에 IFC 타입별 기본색. glb 에 material 11~25개가 이래서 나온다 |
| `disable-opening-subtractions` | False | 기본 | True 면 벽에서 창·문 구멍을 빼지 않는다(빠르지만 틀린 그림) |

serializer_settings: `use-element-guids=True` 로 glb 노드 이름 = GlobalId. 이것이 프론트 클릭 → DB 조회의 유일한 연결고리([01-architecture](../01-architecture.md) "glb ↔ 요소 매핑"). `y-up` 기본 False 지만 glTF 직렬화기가 Z-up→Y-up 을 자체 처리한다(결과 glb 가 Three.js 에서 바로 서 있음, M2 에서 확인).

## 단위

IFC 는 프로젝트마다 단위가 다르다(`IfcUnitAssignment`, mm 가 흔함). iterator 는 **항상 미터로 환산**해 내놓는다(`convert-back-units` 로 끌 수 있음). serializer 에 `setUnitNameAndMagnitude("METER", 1.0)` 은 그걸 명시하는 것. 그래서 DB·뷰어·지도가 전부 m 로 통일된다.

## 무엇이 기하에 포함되나

iterator 기본은 `IfcProduct` 중 `Representation` 이 있는 것 전부 — **IfcOpeningElement(창문 구멍 볼륨)·IfcSpace(방 볼륨)도 포함**. Duplex: 기본 286 → `exclude=["IfcOpeningElement","IfcSpace"]` 215.
DB `element` 는 `IfcElement` 에서 Opening 을 뺀 것(218)이라 glb 노드 > element 행. 뷰어에서 이름으로 못 찾는 노드는 그 차이다. M2 결정: Opening·Space 모두 glb 에는 남기고 뷰어 표시 토글(기본 숨김/반투명)로 처리 — 변환을 다시 안 해도 되게.

## 성능·메모리 (example-project-location.ifc, 3.0MB, 570 요소, 167k 삼각형)

| threads | 시간 | maxrss |
|---|---|---|
| 1 | 8.3s | 451MB |
| 4 | 2.9s | 1.2GB |
| 10 (cpu) | 2.6s | 2.0GB |

- 스레드당 OpenCASCADE 컨텍스트가 따로 잡혀 **메모리 ≈ 200MB + 스레드 × 200MB**. 4 이상은 시간 이득 거의 없음.
- 그래서 `GEOM_THREADS` env 로 뺐다(기본 cpu 수). 컨테이너 메모리 제한을 걸면 이 값부터 낮춘다.
- IFC 3MB → glb 11.6MB. 텍스트 IFC 는 파라메트릭(압출·불리언)이라 작고, 메시는 삼각형을 다 적어서 커진다. 100MB급 IFC 는 glb 수백 MB 가 되므로 그때 Draco/meshopt 또는 3D Tiles([3d-formats.md](3d-formats.md)).
- 파싱(`open`)은 전체를 메모리에 올린다. 대용량은 파싱 자체가 GB 단위 → worker 컨테이너 메모리와 `STALE` 10분 기준의 근거.

## 실패 패턴

- 비IFC / 잘린 파일: `ifcopenshell.Error: Unable to parse IFC SPF header`. 뒤따르는 `__del__` 의 `KeyError` 경고는 무해.
- 기하 없는 파일(속성만 있는 IFC): iterator `initialize()` False → 우리는 `no geometry` 로 FAILED 처리. 속성만 적재하는 경로는 필요해지면.
- 불리언 실패한 개별 요소는 iterator 가 건너뛰고 로그만 남긴다. 요소 수 불일치의 또 다른 원인.

## 참고

- https://docs.ifcopenshell.org/ifcopenshell-python/geometry_settings.html
- https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html
