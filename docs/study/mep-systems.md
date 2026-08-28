# 건물 설비 계통(MEP)을 IFC 로 표현하고 추적하기 (M6 학습 노트)

> 왜 지도 대신 이것인가: 시설관리자가 묻는 건 "이 건물이 지구 어디냐" 가 아니라 **"이 스프링클러는 어느 밸브·펌프·수조에서 오나", "이 구역 정전이면 어느 분전반을 봐야 하나"** 다. 코드: `samples/gen/gen_mep.py`, `worker/extract.py`, `SystemController`, `web/src/viewer/SystemPanel.tsx`.

## 가상 건물

24 × 12 m, 지하 1층(변전실·펌프실·수조실) + 지상 3층. 층마다 A/B 구역(`IfcSpace`), 코어에 EPS(전기 샤프트)·PS(배관 샤프트). 좌표는 건물 남서 모서리 원점의 **상대좌표(m)** — 지리참조 없음. 가구·마감 없이 공용부 설비만.

```
              3F  LP-3F ─ LP-3F-A ─ 조명×4      AV-3F ─ 주관 ─ 스프링클러×6      밸브 ─ 위생기구×2 ─ 횡주관
              2F  ⋮                              ⋮                                ⋮
              1F  ⋮                              ⋮                                ⋮
   전기 ──────────┤ EPS 입상 트레이           소방 ──┤ 소화 입상관              급수 ──┤ 급수 입상관     배수 ──┤ 배수 입상관
              B1  TR-1 변압기 → MDB → 트레이     FT-1 소화수조 → FP-1 소화펌프    WT-1 저수조 → WP-1 급수펌프    → SP-1 집수정
```

| 계통 | `IfcDistributionSystem.PredefinedType` | 원천 → 말단 | 요소 |
|---|---|---|---|
| 전기 | ELECTRICAL | 변압기 → 메인분전반 → 입상 트레이 → 층 분전반 → 구역 분전반 → 조명 | IfcTransformer, IfcElectricDistributionBoard, IfcCableCarrierSegment, IfcLightFixture |
| 급수 | DOMESTICCOLDWATER | 저수조 → 펌프 → 입상관 → 층 분기관 → 구역 밸브 → 위생기구 | IfcTank, IfcPump, IfcPipeSegment, IfcValve, IfcSanitaryTerminal |
| 배수 | WASTEWATER | 위생기구 → 횡주관 → 입상관 → 집수정 | (역방향) |
| 소방 | FIREPROTECTION | 소화수조 → 소화펌프 → 입상관 → 층 알람밸브 → 주관 → 스프링클러 | IfcFireSuppressionTerminal, IfcValve(알람밸브) |
| 비상전원 | ELECTRICAL | 비상발전기 → ATS(한전/발전 절체, MDB 도 입력) → 비상분전반 EMDB → 입상 → 층 비상분전반 → 비상조명 · 소화펌프 · 화재수신기 | IfcElectricGenerator, IfcSwitchingDevice(TRANSFERSWITCH), IfcLightFixture(EMERGENCY) |
| 화재감지 | SIGNAL | **감지기 → 층 중계기 → 간선 → 화재수신기(방재실)** — 신호 방향이라 수신기가 "하류" | IfcSensor(SMOKESENSOR/HEATSENSOR), IfcUnitaryControlElement(ALARMPANEL), IfcCableSegment |

**상태**: 감지기·발전기·ATS·비상조명·수신기·분전반(Breaker, LoadPercent)·펌프(RUNNING/STANDBY, RunHours)·밸브(Open, Pressure)·수조(LevelPercent)·변압기(LoadPercent, OilTemp)·조명(On) 에 `Pset_BimStatus`(Status NORMAL/ALARM/FAULT/STANDBY, AlarmAt, LastTest, FuelLevel, BatteryLevel, Source UTILITY/GENERATOR). 표준 Pset 에 "현재 상태" 자리는 없어서(IFC 는 설계 정보) 프로젝트 Pset 으로 뒀다. 실제 운영에선 BMS/수신기 연동값이 여기로 들어오고, 뷰어 "속성별 색상 → Pset_BimStatus.Status" 가 곧 상태판(ALARM 빨강·FAULT 주황·NORMAL 초록). 예시 데이터: 2F-B 연기감지기 1 = ALARM, 3F-A 열감지기 = FAULT.

## IFC 에서 계통과 흐름을 담는 자리

| 개념 | IFC | 우리 |
|---|---|---|
| 계통(그룹) | `IfcSystem` / `IfcDistributionSystem` + `IfcRelAssignsToGroup` | `system`, `element_system` (N:M — 위생기구는 급수·배수 둘 다) |
| 흐름 연결 | 정식은 `IfcDistributionPort` + `IfcRelConnectsPorts`(포트 방향 SOURCE/SINK) | `IfcRelConnectsElements`(Relating=상류, Related=하류, Description="FLOW") 로 축소 → `connection` |
| 구역 | `IfcSpace`(층 분해) 또는 `IfcZone` | `IfcSpace` 컨테이너 — 요소의 `spatial_node_id` |
| 설비 속성 | `Pset_TransformerTypeCommon`, `Pset_ElectricalDeviceCommon`, `Pset_PipeSegmentTypeCommon` … | 그대로 jsonb |

포트를 안 쓴 이유: 포트는 요소당 2개 이상 객체가 더 생기고(150 요소 → 300+ 포트) 방향은 결국 SOURCE/SINK 플래그다. 원천→말단 방향을 관계 하나로 적는 편이 추출·추적 모두 단순하다. 실제 저작 툴(Revit MEP)이 내보내는 IFC 는 포트 기반이므로 **실무 파일을 받으면 `IfcRelConnectsPorts` → `connection` 변환기를 하나 더 붙이면 된다** — 스키마는 그대로.

## 추적 = 그래프 탐색

`connection(from, to)` 는 방향 그래프. 상류 추적은 `to = 나` 인 edge 를 따라 원천까지, 하류는 `from = 나` 로 말단까지. PostgreSQL 재귀 CTE 한 방:

```sql
WITH RECURSIVE r AS (
  SELECT e.id, 0 depth, ARRAY[e.id] path FROM element e WHERE global_id = :gid
  UNION ALL
  SELECT e.id, r.depth+1, r.path || e.id FROM r JOIN connection c ON c.to_element_id = r.id JOIN element e ON e.id = c.from_element_id
   WHERE NOT e.id = ANY(r.path) AND r.depth < 50)
SELECT DISTINCT ON (id) ... ORDER BY id, depth
```
`path` 배열로 순환 방지, `DISTINCT ON` 으로 여러 경로로 닿는 요소는 가장 짧은 depth 만. 상류는 보통 사슬(8단계), 하류는 나무(변압기 → 43개).

## 뷰어에서

- "계통별 색": 계통 멤버는 의미색(전기 주황·급수 파랑·배수 갈색·소방 빨강·비상전원 진주황·화재감지 보라), 구조체는 반투명 — 건물 안의 배관·트레이가 보인다. 표시 옵션 "구조체 숨김"(벽·슬래브·지붕) 으로 아예 뺄 수도 있다.
- 신호 계통(SIGNAL)은 버튼 라벨이 "감지기 쪽 / 수신기까지" 로 바뀐다 — 데이터는 같은 `connection`, 의미만 다르다.
- 요소 하나 선택 → 상류/하류. 경로는 파랑(상류)/초록(하류), 선택 요소 주황, 나머지 반투명. "경로만 보기" 는 솔로 모델 재사용.
- 층·구역 필터(트리 눈/솔로)와 조합: "2F-B 구역 소방" = 트리에서 2F-B 솔로 + 계통 색.

## 런타임 상태 — IFC 밖의 것을 IFC 위에 얹기

`Pset_BimStatus` 는 IFC 파일에 초기값으로 있지만 **운영 중엔 API 가 바꾼다**: `PATCH /models/{id}/elements/{gid}/status` 가 jsonb 를 병합(`||`)한다. 별도 테이블을 안 둔 이유 — 속성 패널·색상 모드·검색이 전부 `element.properties` 를 읽으므로 같은 자리에 두면 아무것도 안 바꿔도 된다. 대가: 재변환하면 IFC 값으로 초기화. 상태는 본래 BMS/수신기의 것이지 IFC 의 것이 아니므로 맞는 방향(운영에선 연동 배치가 다시 채운다).

부수효과 두 가지가 "관계" 를 만든다:
- 감지기 ALARM/FAULT → 수신기 `ActiveAlarms/Faults` 재계산(모델 단위 집계 쿼리).
- 이상 상태 요소가 **자산이면 작업지시 자동 생성**(제목 "경보 확인: …", viewpoint 에 선택 요소) → FM 보드에 바로 뜬다. 상태(BMS) → 자산(FMS) → 작업지시 가 한 줄로 이어지는 지점.

## 정전 시나리오 = 그래프 차집합

`POST /models/{id}/power?source=GENERATOR`:
1. ATS `Source=GENERATOR, Status=TRANSFERRED`, 발전기 `Status=RUNNING`
2. 전원 있음 = EMDB 하류(재귀 CTE), 전원 없음 = MDB 하류 ∖ EMDB 하류
3. 뷰어가 초록/짙은 회색으로 칠한다 — 어느 조명·분전반이 죽는지, 소화펌프·수신기·비상조명이 살아있는지가 한눈에.

`source=UTILITY` 로 복전. 계통 데이터(connection)만으로 "무엇이 영향받나" 가 나오는 게 핵심 — 정전뿐 아니라 밸브 잠금·차단기 트립도 같은 계산(하류 차집합)이다.

## 모니터링 페이지 — 팀 × 층

현장 조직은 계통이 아니라 **팀**(전기팀·소방팀·설비팀) 으로 움직인다. 팀 ↔ 계통 매핑은 `MonitorPage.tsx` 의 `TEAMS` 한 곳(전기팀=전기·비상전원, 소방팀=소방·화재감지, 설비팀=급수·배수·공조·냉난방). 행은 층(elevation 내림차순), 열은 팀, 셀 안은 이상 → 작업지시 → 결함 → 정상 순. 배관·트레이 같은 "선" 은 `GET /monitor` 가 기본 제외(장비만). 팀 카드 클릭으로 한 팀만, "이상만" 으로 정상 숨김. 5초 폴링이라 뷰어에서 경보를 내면 모니터에 바로 뜬다 — 실제로는 BMS 연동이 같은 API 를 친다.

## "어디 있는 감지기인가" — 포커스 모드

모니터·상태판에서 경보/장애를 클릭하면 뷰어가 `?sel=&focus=1` 로 열리며: 요소가 속한 `IfcSpace` 와 요소만 남기고 나머지 반투명(격리), 그 층 위를 수평 단면으로 잘라내고(`storey.elevation + 3.3`), 구역+요소 바운딩에 카메라 핏, 상단 배너 "1F · 1F-B 구역 · 열감지기 4 · 경보". 공간 구조(요소 → Space → Storey)가 DB 에 있어서 좌표를 계산할 필요가 없다 — `spatial_node` 체인만 따라가면 된다.

## 살아 움직이게 — BMS 시뮬레이터

`samples/gen/bms_sim.py <modelId>` 가 3초마다 상태 API 를 친다: 수조 수위·분전반 부하 드리프트, 확률적으로 감지기 경보(몇 틱 뒤 자동 복구)·장애, 펌프 운전/대기 전환, 드물게 정전→복전. 모니터(5초 폴링)와 뷰어 상태판이 따라 움직인다. **실제 BMS/화재수신기 연동도 같은 PATCH 를 치면 된다** — 시뮬레이터는 연동 어댑터의 자리표시자. 자산으로 등록된 감지기가 경보를 내면 작업지시가 자동 생성되므로 오래 돌리면 보드에 쌓인다(의도 — 실무에선 중복 억제 규칙이 필요한 지점).

`POST /models/{id}/assets/bulk` 는 배관·트레이를 뺀 계통 장비 전부를 자산으로 등록(태그 = 클래스 약어-층-순번, 예 `EDB-2F-03`). 모니터 페이지 버튼 하나. COBie 로 치면 Component 시트를 IFC 에서 자동 생성한 것.

## FM 시나리오

1. 3층 B구역 조명 고장 신고 → 조명 선택 → 상류 → `LP-3F-B 구역 분전반` 부터 확인, 그래도 안 되면 `LP-3F` → `MDB`.
2. 급수 펌프 교체 예정 → 펌프 선택 → 하류 → 영향 범위 = 전 층 위생기구 26개 → 작업지시에 첨부(뷰포인트 저장).
3. 1층 A구역 스프링클러 오작동 → 상류 → `AV-1F 알람밸브` 잠그면 1층만 차단, 그 위 `소화 입상관` 잠그면 전 층.
4. 수신기 ALARM 1건 → 상태 색상 모드로 빨간 감지기 찾기(2F-B) → 수신기까지 경로로 중계기 확인 → 작업지시.
5. 정전 → ATS `Source` 가 GENERATOR 로 바뀌면 비상전원 계통 하류(비상조명·소화펌프·수신기)만 살아있음을 뷰어에서 확인, 발전기 `FuelLevel` 로 잔여 운전 시간.

## 참고

- IFC4.3 IfcDistributionSystem: https://ifc43-docs.standards.buildingsmart.org/IFC/RELEASE/IFC4x3/HTML/lexical/IfcDistributionSystem.htm
- IfcRelConnectsPorts / IfcDistributionPort: 같은 문서의 Domain > Shared Building Services
- IfcOpenShell API `system.add_system / assign_system`, `geometry.connect_element`
