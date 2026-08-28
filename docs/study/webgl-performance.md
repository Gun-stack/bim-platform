# WebGL 성능 — draw call 이 전부다 (M2 학습 노트)

> 뷰어 "재질별 병합" 토글이 보여주는 것. 수치는 Duplex(218 요소 + 21 Space, 22.7k 삼각형).

## 측정

| 상태 | draw calls | 삼각형 |
|---|---|---|
| 기본 (요소 218 + Space 21) | 192 | 22,684 |
| Opening 표시 | 384 | 28,428 |
| Space 숨김 | 171 | 22,116 |
| Level 2 만 | 73 | 6,140 |
| **재질별 병합** | **14** | 22,684 |
| 병합 + 선택 1개 | 15 | 22,684 |

삼각형은 그대로인데 draw call 이 192 → 14. 병합이 줄이는 건 GPU 일이 아니라 **CPU 가 GPU 에 명령을 보내는 횟수**다. 모바일·통합 GPU 에서 수천 draw call 은 그 자체로 병목이고, 삼각형 수십만은 아니다.

(glb 노드 수 192 ≠ 요소 218: glb 는 iterator 가 낸 "기하 있는 것" 이고 element 는 IfcElement. 기하 없는 요소, Opening, Space 가 차이를 만든다. [ifc-spatial-structure.md](ifc-spatial-structure.md).)

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
