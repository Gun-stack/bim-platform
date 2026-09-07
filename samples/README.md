# 샘플 IFC

`.ifc` 는 git 에 없다(`.gitignore`). 아래 명령으로 받는다.

| 파일 | 스키마 | 크기 | 출처 |
|---|---|---|---|
| `Duplex_A_20110907.ifc` | IFC2X3 | 2.4MB | buildingSMART Community Sample Files (Git LFS) |
| `AC20-FZK-Haus.ifc` | IFC4 | 2.6MB | KIT / IFCwiki. IfcSite RefLatitude 포함 |
| `Building-Architecture.ifc` | IFC4X3_ADD2 | 0.2MB | buildingSMART Sample-Test-Files PCERT 씬 |
| `example-project-location.ifc` | IFC4 | 3.0MB | (M3용) IfcMapConversion 지리참조 예제 |

```bash
cd samples
curl -sLO "https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/main/IFC%202.3.0.1%20(IFC%202x3)/Duplex%20Apartment/Duplex_A_20110907.ifc"
curl -sLO "https://www.ifcwiki.org/images/e/e3/AC20-FZK-Haus.ifc"
curl -sLO "https://raw.githubusercontent.com/buildingSMART/Sample-Test-Files/main/IFC%204.3.2.0%20(IFC4X3_ADD2)/PCERT-Sample-Scene/Building-Architecture.ifc"
curl -sL -o example-project-location.ifc "https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/main/IFC%204.0.2.1%20(IFC%204)/Example%20project%20location/example%20project%20location.ifc"
```

주의: buildingSMART 는 2025년 이후 커뮤니티 샘플(Duplex, Schependomlaan 등)을 `buildingsmart-community/Community-Sample-Test-Files` 로 옮겼고 Git LFS 를 쓴다. `raw.githubusercontent.com` 으로 받으면 132바이트 포인터만 온다. Schependomlaan 은 IFC2X3 이라 IFC4 대표로는 FZK-Haus 를 쓴다.

## mep-building.ifc (생성)

`gen/gen_mep.py` 가 IfcOpenShell API 로 만든 가상 건물. 지리참조 없음, 상대좌표. 호스트 python 에 IfcOpenShell 이 없어 워커 컨테이너에서 실행한다(`gen/` 디렉터리째 복사 — `mep_plan.py` 를 import 한다).

```bash
docker compose exec ifc-worker rm -rf /tmp/gen && docker compose cp samples/gen ifc-worker:/tmp/gen
docker compose exec ifc-worker sh -c 'cd /tmp/gen && python gen_mep.py mep-building.ifc'                                   # 기본: 지상 10층 + 주차타워, 격자 4 m
docker compose exec ifc-worker sh -c 'cd /tmp/gen && python gen_mep.py large.ifc --floors 20 --annex 2 --density high'    # 대형: 3D Tiles·규모 측정용
docker compose cp ifc-worker:/tmp/gen/mep-building.ifc samples/
```

| 인자 | 기본 | 의미 |
|---|---|---|
| `--floors N` | 10 | 지상 층수(3 이상). 지하 2층·옥탑은 고정 |
| `--annex K` | 1 | 0 없음 / 1 주차타워(P1F~P3F) / 2 +후생동(W1F~W2F) |
| `--density` | `mid` | `low` 고정 좌표 / `mid` 격자 4 m / `high` 격자 2.5 m + 콘센트 |

생성 끝에 두 줄을 찍는다 — `ifc:` 원시 IFC 개수(개구부 포함), `db:` 워커 적재 기준(개구부 제외 요소·IfcSystem 포함 계통·연결). 검증은 `db:` 줄과 DB 를 비교한다. 기본 인자 실측: 14계통 **1,613요소 2,005연결**. 자기 검사(연결 없는 계통 요소·소속 없는 요소·이름 중복)는 AssertionError 로 멈춘다.

테스트: 호스트 `python3 -m unittest samples/gen/test_mep_plan.py`(배치 로직), 컨테이너 `docker compose exec ifc-worker sh -c 'cd /tmp/gen && python -m unittest test_gen_mep -v'`(생성·연결).

`gen/bms_sim.py <modelId>` — 상태 API 시뮬레이터. `--interval 3 --ticks 0` 기본(무한), `--seed` 로 재현.


## 실무 IFC 테스트 파일

포트 기반 연결(`IfcRelConnectsPorts`) 검증에는 buildingSMART 커뮤니티의 Revit 출력 배관 모델을 썼습니다 (LFS라 raw 대신 media URL, 용량 때문에 저장소엔 미포함):

```bash
curl -L -o Duplex_Plumbing_20121113.ifc "https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/main/IFC%202.3.0.1%20(IFC%202x3)/Duplex%20Apartment/Duplex_Plumbing_20121113.ifc"
```

IFC2x3 · 포트 970 · IfcRelConnectsPorts 485 · IfcSystem 0 — 포트 연결 변환과 Pset(System Classification) 계통 유도(7계통), 계통 없는 추적 폴백까지 확인 가능한 파일입니다.

2라운드는 같은 저장소의 Medical-Dental Clinic(Revit, IFC2x3 CoordinationView)으로 했습니다:

```bash
curl -L -o Clinic_HVAC.ifc "https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/main/IFC%202.3.0.1%20(IFC%202x3)/Medical-Dental%20Clinic/Clinic_HVAC.ifc"
curl -L -o Clinic_Electrical.ifc "https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/main/IFC%202.3.0.1%20(IFC%202x3)/Medical-Dental%20Clinic/Clinic_Electrical.ifc"
```

| 파일 | 크기 | 관찰 | 반영 |
|---|---|---|---|
| `Clinic_HVAC.ifc` | 27MB, mm | 포트 7,390 · IfcRelConnectsPorts 3,695 · IfcSystem 0 · 요소 3,704 이 전부 IfcFlowTerminal/Segment/Fitting 같은 **일반 클래스** (종류는 IfcAirTerminalType 등 타입에만) · System Classification = Supply Air / Return Air / Exhaust Air / Hydronic | 타입 이름으로 구체 클래스 복원(IfcAirTerminal·IfcDuctSegment·IfcFan·IfcChiller…), Supply/Return/Exhaust Air → 공조·환기 계통 타입, 피팅을 자산 제외 목록에 |
| `Schependomlaan/Design model IFC/IFC Schependomlaan.ifc` (규모 측정용, 건축 47MB·요소 3,635) | 47MB | 변환 12.6초 · GLB 16.6MB · draw calls 4,671 | README "규모 측정" 절 |
| `Clinic_Electrical.ifc` | 7MB | 포트·연결 0 (2x3 CV 는 전기 회로를 안 냄) · IfcFlowTerminal 2,081 = 조명 1,120 + 콘센트 961 · Pset `Electrical.Load Classification`·`Other.BackupSupplySystem` | 클래스 복원만(IfcLightFixture·IfcOutlet). 회로 기반 계통 유도는 보류 — 연결 정보 없이는 추적이 안 되므로 |
