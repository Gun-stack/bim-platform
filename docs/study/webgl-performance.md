# WebGL 성능 — draw call 이 전부다 (M2 학습 노트)

> 뷰어 "재질별 병합" 토글이 보여주는 것. 수치는 Duplex(218 요소 + 21 Space, 22.7k 삼각형).

## 측정

> Duplex, 2026-08-28 재측정. 처음 측정(192 calls)은 아래 "분류 버그" 상태였다.

| 상태 | draw calls | 삼각형 |
|---|---|---|
| 기본 (요소 + Space 21) | 334 | 27,604 |
| Opening 표시 (+50) | 384 | 28,428 |
| Space 숨김 | 313 | 27,036 |
| Level 2 숨김 (트리 눈 토글) | 171 | 18,264 |
| **재질별 병합** | **24** | 27,604 |

삼각형은 그대로인데 draw call 이 334 → 24. 병합이 줄이는 건 GPU 일이 아니라 **CPU 가 GPU 에 명령을 보내는 횟수**다. 모바일·통합 GPU 에서 수천 draw call 은 그 자체로 병목이고, 삼각형 수십만은 아니다.

### 분류 버그에서 배운 것 — glb 노드 수 ≠ Mesh 수

glb 노드는 286개(요소 218 + Space 21 + Opening 50 − 형상 없는 요소 3)인데 Three.js Mesh 는 384개다. glTF 의 mesh 하나가 **primitive 여러 개**(재질이 다른 부분 — 문짝+문틀)를 가지면 GLTFLoader 는 노드를 `Group` 으로 만들고 자식 `Mesh` 를 `{노드이름}_0`, `_1` 로 이름 붙인다. 처음 코드는 `mesh.name` 을 GlobalId 로 믿어서 이런 자식 142개를 "DB 에 없는 노드 = Opening" 으로 분류해 기본 숨김 처리했다 — 문·창이 일부만 보였는데 샘플이 작아 눈치채지 못했다. 수정: 이름이 GlobalId 형식(22자 `[0-9A-Za-z_$]`)인 쪽(자기 이름 또는 부모 이름)을 취한다. draw call 도 노드가 아니라 **Mesh(= primitive) 수** 로 센다.

## Three.js 에서 한 draw call 의 단위

`Mesh` 하나 = `geometry × material` 하나 = draw call 하나 (material 배열이면 group 마다). glTF 로더는 노드마다 Mesh 를 만들므로 요소 수 = draw call 수. BIM 은 요소가 수천~수만이라 그대로 그리면 안 된다.

## 줄이는 방법 세 가지

| 방법 | 언제 | 우리 |
|---|---|---|
| **병합** `BufferGeometryUtils.mergeGeometries` — 같은 재질의 지오메트리를 하나로 | 정적 씬. 요소별 이동 없음 | 토글로 구현. 재질 수(14)가 하한 |
| **인스턴싱** `InstancedMesh` — 같은 지오메트리를 행렬만 바꿔 N 번 | 같은 타입 반복(창문 24개, 문 14개) | IfcOpenShell 이 타입 공유 지오메트리를 `cache-shapes` 로 낼 수 있음. 미적용 |
| **컬링** frustum(기본 on) / occlusion / LOD | 큰 모델, 실내 | 병합하면 frustum 컬링 단위가 커져 오히려 손해 — 층별·구역별로 나눠 병합하는 게 정석 |

## 병합하면 잃는 것과 되찾는 법

1. **요소별 픽킹** — Mesh 이름이 사라진다. → 병합 순서대로 index 구간 `[start, end)` 를 GlobalId 와 함께 기록, raycast 의 `faceIndex*3` 이 어느 구간인지 이진/선형 탐색. (`scene.ts` `mergedRanges`)
2. **요소별 표시/하이라이트** — material 을 바꿀 Mesh 가 없다. → 재구성한다. 필터가 바뀌면 보이는 것만 다시 병합, 선택하면 하이라이트 재질이 자기 그룹으로 분리(+1 call). 500 요소면 수 ms.
   더 큰 모델에선 재구성 대신 **정점 색 / 정점 속성(요소 ID)** 을 심고 셰이더에서 처리 — Fragments·xeokit 이 하는 방식.
3. **프러스텀 컬링 단위** — 위 표 참고.

## glb 크기 vs 렌더 성능은 별개

glb 11.6MB 는 네트워크·파싱 비용이고 draw call 과 무관하다. 크기는 Draco/meshopt(gltf-transform), draw call 은 병합/인스턴싱. [3d-formats.md](3d-formats.md).

## 측정 방법

`renderer.info.render.calls / .triangles` 를 읽으면 된다(프레임마다 리셋). 우리는 500ms 마다 한 번 직접 렌더 후 읽는다 — 탭이 숨겨져 rAF 가 멈춰도 수치가 나오게. Chrome 의 rAF 는 hidden 탭에서 완전히 정지한다(fps 0 이 그 표시).
