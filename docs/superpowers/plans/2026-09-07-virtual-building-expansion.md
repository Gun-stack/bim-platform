# 가상 건물 확장(gen_mep.py 매개변수화) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `samples/gen/gen_mep.py` 를 `--floors/--annex/--density` 인자로 층수·부속동·말단 밀도를 바꿀 수 있게 확장하고, 부속동이 들어와도 모니터링 층 단면 링크가 올바른 높이로 자르게 한다.

**Architecture:** 순수 배치 계산(층 표고, 평면, 격자, 제외 영역)은 `samples/gen/mep_plan.py` 로 떼어 호스트에서 unittest 하고, IFC 생성은 `gen_mep.py` 가 그대로 맡는다(ifcopenshell 은 워커 컨테이너에만 있음). 본동 지상층은 `PLAN`(평면 사양) 한 곳에서 IfcSpace 생성과 설비 배치를 같이 읽고, 실 하나의 말단은 `fit_zone()` 이 상류 묶음 `ctx` 를 받아 만든다(부속동은 자체 공급원을 `ctx` 로 넘김). 모니터 API 는 `building` 열 하나를 더 싣고, 화면은 같은 동의 다음 층 표고를 단면 상한으로 쓴다.

**Tech Stack:** Python 3.13 + IfcOpenShell 0.8.5(컨테이너), Spring Boot 4 / JdbcClient + Testcontainers, React 19 / vitest, Docker Compose.

**설계서:** [design](../specs/2026-09-07-virtual-building-expansion-design.md) · [review](../specs/2026-09-07-virtual-building-expansion-review.md)

**설계서와 다른 점 하나(이유 포함):** 설계 §5 는 "파일 하나 유지"라 했지만, 순수 배치 로직 약 60행을 `mep_plan.py` 로 분리한다. `gen_mep.py` 는 import 시점에 IFC 를 통째로 생성하는 스크립트라 호스트(ifcopenshell 없음)에서 격자·제외 영역·층 표고 로직을 단위 테스트할 방법이 없기 때문이다. 재생성 명령은 `samples/gen` 디렉터리째 컨테이너에 복사한다.

## Global Constraints

- IfcOpenShell 0.8.5, Python 3.13 (워커 컨테이너 `ifc-worker`). 호스트 python 은 `/opt/homebrew/bin/python3`(ifcopenshell 없음).
- 계통 14개 이름·타입, `IfcRelConnectsElements` Relating=상류, `Pset_BimStatus` 규약 유지. 화재감지 방향은 감지기→중계기→FACP(FACP 가 하류).
- 지하 B2·B1 은 XY·Z(표고 −7.0/−3.5, 층고 3.5) 불변. `H = 3.5` 는 지하 코드 전용 상수로 남긴다.
- `--floors ≥ 3`, `--annex 0~2`, `--density low|mid|high`. 범위 밖은 argparse 오류(종료 코드 2).
- 벽 스위치(IfcSwitchingDevice) 생성 금지 — 전원 API 가 이 클래스 전부를 ATS 로 본다.
- `RF` = 최상 지상층 `z + h`(옥상 슬래브 상단, 입상 `top` 과 같은 값), `RF_TOP = RF + 3.0`. 높이 식이 음수가 되지 않게 `RF` 기준 유지.
- 워커 코드 수정 금지. API 는 `MonitorController.monitor` 의 `building` 열만, 화면은 `MonitorPage.storeyClip` 만.
- Flyway 마이그레이션 파일(V1~V7) 수정 금지(체크섬).
- IFC 파일은 커밋하지 않는다(`.gitignore` `samples/*.ifc` 유지).
- 커밋 메시지는 기존 관례(한국어, `web:`/`docs:` 접두어 선택적) + 세션 attribution 꼬리말.
- 셸: `cd web && …` 뒤에는 절대 경로로 복귀. GlobalId 는 `$` 가 있어 bash 스크립트 파일로만 다룬다.

---

## File Structure

| 파일 | 역할 |
|---|---|
| Create `samples/gen/mep_plan.py` | 순수 배치 사양: 치수 상수, `SHAFTS`, `PLAN`, `PITCH/FRAC/GRID`, `floor_spec()`, `grid()`, `place()`, `EXCL_CORE` |
| Create `samples/gen/test_mep_plan.py` | 호스트 unittest — 층 표고, 격자 순서, 제외 영역, low/mid/high 개수 |
| Modify `samples/gen/gen_mep.py` | argparse, 층별 `h`, PLAN 기반 실·말단(`fit_zone`), `annex_parking()`, `annex_welfare()`, 자기 검사, 카운트 2줄 |
| Create `samples/gen/test_gen_mep.py` | 컨테이너 unittest — 인자 검증, 조합별 생성, 층·동·연결 검사(ifcopenshell 없으면 skip) |
| Modify `api/src/main/java/com/bim/api/MonitorController.java` | `building` 열 + IfcBuilding 조인 |
| Modify `api/src/test/java/com/bim/api/MonitorTests.java` | 동 이름·층 직접 소속 요소 검증 |
| Modify `web/src/monitor.ts` | `Row.building`, `Storey`, `storeyClipZ()` |
| Modify `web/src/monitor.test.ts` | `storeyClipZ` 3케이스 |
| Modify `web/src/MonitorPage.tsx:66-67,87` | `storeyList` 에 동 포함, `storeyClip` 이 `storeyClipZ` 사용 |
| Modify `samples/README.md`, `README.md`, `docs/screen-design.md:78` | 생성 명령·숫자·층 단면 설명 |

---

### Task 1: 순수 배치 사양 `mep_plan.py`

**Files:**
- Create: `samples/gen/mep_plan.py`
- Test: `samples/gen/test_mep_plan.py`

**Interfaces:**
- Produces: `W, D, EPS, PS, DS, ELV, ST1, ST2, SHAFTS, PLAN, PITCH, EXCL_CORE`
- `floor_spec(n_floors: int) -> list[tuple[str, float, float, str]]` — `(이름, z, h, kind)`, kind ∈ `basement|lobby|dining|office|roof`, RF 포함, `n_floors < 3` 이면 `ValueError`
- `grid(x, y, w, d, pitch, offset=0.0, margin=0.8) -> list[tuple[float, float]]`
- `place(kind, x, y, w, d, density, exclude=()) -> list[tuple[float, float]]` — kind ∈ `light|spr|dif|det`
- `inside(px, py, rect) -> bool`, `pad(rect, m) -> rect`

- [ ] **Step 1: 실패하는 테스트 작성**

`samples/gen/test_mep_plan.py`:

```python
"""mep_plan 순수 로직 — 호스트에서 `python3 -m unittest samples/gen/test_mep_plan.py` (ifcopenshell 불필요)"""
import unittest
from mep_plan import D, EXCL_CORE, ST1, floor_spec, grid, inside, pad, place


class FloorSpecTest(unittest.TestCase):
    def test_default_10(self):
        fl = floor_spec(10)
        names = [n for n, *_ in fl]
        self.assertEqual(names, ["B2", "B1", "1F", "2F"] + [f"{i}F" for i in range(3, 11)] + ["RF"])
        by = {n: (z, h, k) for n, z, h, k in fl}
        self.assertEqual(by["B2"], (-7.0, 3.5, "basement")); self.assertEqual(by["B1"], (-3.5, 3.5, "basement"))
        self.assertEqual(by["1F"], (0.0, 5.0, "lobby")); self.assertEqual(by["2F"], (5.0, 3.5, "dining"))
        self.assertEqual(by["3F"], (8.5, 3.5, "office")); self.assertEqual(by["10F"], (33.0, 3.5, "office"))
        self.assertEqual(by["RF"], (36.5, 3.0, "roof"))   # 10F 상단 = RF 슬래브

    def test_stack_is_contiguous(self):
        fl = floor_spec(20)
        for (_, z, h, _), (_, z2, _, _) in zip(fl[1:], fl[2:]):   # 지상층부터 표고 = 아래층 z + h
            self.assertAlmostEqual(z + h, z2)

    def test_min_floors(self):
        self.assertEqual(floor_spec(3)[-2][0], "3F")
        with self.assertRaises(ValueError):
            floor_spec(2)


class GridTest(unittest.TestCase):
    def test_origin_and_order(self):
        pts = grid(0, 0, 13, D, 4.0)
        self.assertEqual(pts[0], (0.8, 0.8))                  # 원점 = 여유 0.8
        self.assertEqual(pts[:3], [(0.8, 0.8), (4.8, 0.8), (8.8, 0.8)])   # x 먼저 증가
        self.assertEqual(pts[3], (0.8, 4.8))
        self.assertTrue(all(0.8 <= x <= 12.2 and 0.8 <= y <= 15.2 for x, y in pts))

    def test_offset(self):
        self.assertEqual(grid(0, 0, 13, D, 4.0, offset=2.0)[0], (2.8, 2.8))

    def test_exclusion(self):
        st1 = pad(ST1, 0.3)
        self.assertTrue(inside(10.8, 10.8, st1)); self.assertFalse(inside(8.8, 10.8, st1))
        spr = place("spr", 0, 0, 13, D, "mid")                  # 사무A: 피치 4, 오프셋 2 → (10.8,10.8),(10.8,14.8) 은 ST1 안
        self.assertNotIn((10.8, 10.8), spr); self.assertNotIn((10.8, 14.8), spr); self.assertEqual(len(spr), 10)
        self.assertEqual(place("det", 0, 0, 13, D, "mid")[0], (0.8, 0.8))   # 감지기 인덱스 0 은 항상 원점

    def test_density_counts(self):
        n = lambda dens, kind: len(place(kind, 0, 0, 13, D, dens))
        self.assertEqual((n("low", "light"), n("low", "spr"), n("low", "dif"), n("low", "det")), (4, 6, 4, 4))
        self.assertEqual((n("mid", "light"), n("mid", "det")), (12, 4))
        self.assertGreater(n("high", "light"), n("mid", "light"))

    def test_core_exclusion_list(self):
        self.assertEqual(len(EXCL_CORE), 6)
        self.assertTrue(any(inside(16.6, 8.0, r) for r in EXCL_CORE))   # EPS 중심


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/samples/gen && python3 -m unittest test_mep_plan -v; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: `ModuleNotFoundError: No module named 'mep_plan'`

- [ ] **Step 3: `mep_plan.py` 작성**

```python
"""가상 건물 배치 사양 — 층 표고·평면·말단 격자. 순수 계산이라 ifcopenshell 없이 호스트에서 unittest 한다(test_mep_plan.py).
gen_mep.py 가 import 해서 IfcSpace 생성과 설비 배치에 같은 목록을 쓴다."""
W, D = 36.0, 16.0
EPS = (16.0, 7.0, 1.2, 2.0)           # 전기 샤프트 x,y,w,d
PS = (17.4, 7.0, 1.2, 2.0)            # 배관 샤프트
DS = (18.8, 7.0, 1.6, 2.0)            # 덕트 샤프트
ELV = (13.2, 7.0, 2.4, 2.4)           # 엘리베이터 승강로
ST1 = (10.4, 10.0, 2.6, 4.6)          # 계단실 1 (코어 서쪽 — 사무A 안에 있다)
ST2 = (33.0, 0.3, 2.6, 4.6)           # 계단실 2 (동남)
SHAFTS = (("EPS", EPS), ("PS", PS), ("DS", DS), ("EV", ELV), ("ST1", ST1), ("ST2", ST2))

# 지상층 평면: 유형 → [(실 이름, x, y, w, d)]. 코어 x 13~20.6 은 샤프트·엘리베이터·계단실(현행 좌표 그대로)
PLAN = {
    "lobby": [("로비", 0, 0, 13, D), ("상가1", 20.6, 0, 7.7, D), ("상가2", 28.3, 0, W - 28.3, D)],
    "dining": [("식당", 0, 0, 13, D), ("회의1", 20.6, 0, 7.7, D), ("회의2", 28.3, 0, W - 28.3, D)],
    "office": [("사무A", 0, 0, 13, D), ("사무B", 20.6, 0, W - 20.6, D)],
}
PITCH = {"low": None, "mid": 4.0, "high": 2.5}   # 말단 격자 피치 P(m). low 는 격자 없이 FRAC 고정 좌표
GRID = {"light": (1, 0.0), "spr": (1, 0.5), "dif": (2, 0.0), "det": (2, 0.0)}   # 종류 → (P 배수, 오프셋 P 배수)
# low: 현행 A/B 구역 고정 좌표(실당 조명 4·스프링클러 6·디퓨저 4·감지기 4)를 실 폭·깊이 비율로 옮긴 것
FRAC = {"light": [(0.25, 0.2), (0.25, 0.7), (0.7, 0.2), (0.7, 0.7)],
        "spr": [(0.15, 0.25), (0.5, 0.25), (0.85, 0.25), (0.15, 0.75), (0.5, 0.75), (0.85, 0.75)],
        "dif": [(0.3, 0.28), (0.3, 0.72), (0.7, 0.28), (0.7, 0.72)],
        "det": [(0.25, 0.35), (0.25, 0.65), (0.7, 0.35), (0.7, 0.65)]}


def floor_spec(n_floors):
    """[(이름, 표고 z, 층고 h, 유형)]. 지하 B2·B1 은 현행 고정(램프 rise·개구부 계산이 3.5 에 묶여 있음),
    1F 로비 5.0, 2F 식당 3.5, 3F~NF 사무 3.5, RF 옥탑 3.0. n_floors ≥ 3 (2F 에스컬레이터·3F 덤웨이터 개구부 고정)"""
    if n_floors < 3:
        raise ValueError("floors >= 3")
    fl = [("B2", -7.0, 3.5, "basement"), ("B1", -3.5, 3.5, "basement"), ("1F", 0.0, 5.0, "lobby"), ("2F", 5.0, 3.5, "dining")]
    z = 8.5
    for i in range(3, n_floors + 1):
        fl.append((f"{i}F", z, 3.5, "office")); z += 3.5
    fl.append(("RF", z, 3.0, "roof"))
    return fl


def pad(rect, m):
    x, y, w, d = rect
    return (x - m, y - m, w + 2 * m, d + 2 * m)


def inside(px, py, rect):
    x, y, w, d = rect
    return x <= px <= x + w and y <= py <= y + d


EXCL_CORE = [pad(r, 0.3) for _, r in SHAFTS]   # 샤프트·계단실 0.3 확장 — 격자점 제외 영역


def grid(x, y, w, d, pitch, offset=0.0, margin=0.8):
    """실 사각형 안 격자점 [(x, y)]. 원점 (x+margin+offset, y+margin+offset), x 먼저 증가 후 y — 인덱스 순서 고정(데모 상태 키가 인덱스를 쓴다)"""
    pts, yy = [], y + margin + offset
    while yy <= y + d - margin + 1e-9:
        xx = x + margin + offset
        while xx <= x + w - margin + 1e-9:
            pts.append((round(xx, 3), round(yy, 3))); xx += pitch
        yy += pitch
    return pts


def place(kind, x, y, w, d, density, exclude=()):
    """말단 좌표 목록. mid/high 는 격자, low 는 FRAC 비율. exclude(샤프트 확장·개구부 사각형) 안 점은 버린다"""
    p = PITCH[density]
    if p is None:
        pts = [(round(x + fx * w, 3), round(y + fy * d, 3)) for fx, fy in FRAC[kind]]
    else:
        mult, off = GRID[kind]; pts = grid(x, y, w, d, p * mult, p * off)
    return [q for q in pts if not any(inside(q[0], q[1], r) for r in exclude)]
```

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/samples/gen && python3 -m unittest test_mep_plan -v; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: `Ran 8 tests … OK`. `test_exclusion` 의 스프링클러 10개가 맞지 않으면 좌표를 출력해 ST1 확장 사각형(x 10.1~13.3, y 9.7~14.9)과 대조하고 기대값을 실측으로 고친다(격자 규칙은 바꾸지 않는다).

- [ ] **Step 5: 커밋**

```bash
git add samples/gen/mep_plan.py samples/gen/test_mep_plan.py
git commit -m "samples: 가상 건물 배치 사양 mep_plan.py — floor_spec·PLAN·격자·제외 영역 (호스트 unittest)"
```

---

### Task 2: `gen_mep.py` 본동 매개변수화 (인자·층고·PLAN·fit_zone·자기 검사)

**Files:**
- Modify: `samples/gen/gen_mep.py` (전체 구조 변경, 지하·기계실·옥탑 코드는 `H`→`h`, `top` 만 손댐)
- Test: `samples/gen/test_gen_mep.py`

**Interfaces:**
- Consumes: Task 1 의 `mep_plan` 전부
- Produces(Task 3·4 가 씀): 전역 `args`, `f, site, storeys, spaces, systems, make, link, chain, box, pipe, cyl, ramp, void, ST, S`, `MDB, EMDB, MDF, FACP, PCS, SP, GASR, riser_fp, riser_ws`, `fit_zone(sp, x, y, w, d, z, h, west, c, key, excl=())`, `spot_occ: list[bool]`, `set_status(el, props)`
- `fit_zone` 의 `c` 키: `lp lcp elp rpt fpb hc wsb hwsb wwb chwb hb ddc odu tx my` — 값이 `None`/없음이면 그 말단은 만들지 않는다. `tx` = 트레이 시작 x(본동 `ex`), `my` = 스프링클러 주관 y.

- [ ] **Step 1: 컨테이너 테스트 작성**

`samples/gen/test_gen_mep.py`:

```python
"""gen_mep.py 통합 검사 — ifcopenshell 필요(워커 컨테이너). 실행:
docker compose cp samples/gen ifc-worker:/tmp/gen && docker compose exec ifc-worker sh -c 'cd /tmp/gen && python -m unittest test_gen_mep -v'"""
import os, subprocess, sys, tempfile, unittest

try:
    import ifcopenshell
    import ifcopenshell.util.element as ue
except ImportError:   # 로컬(맥)엔 ifcopenshell 없음
    ifcopenshell = None

HERE = os.path.dirname(os.path.abspath(__file__))


def gen(*args):
    out = os.path.join(tempfile.mkdtemp(), "t.ifc")
    r = subprocess.run([sys.executable, os.path.join(HERE, "gen_mep.py"), out, *args], capture_output=True, text=True)
    return r, out


@unittest.skipIf(ifcopenshell is None, "ifcopenshell 없음 — 워커 컨테이너에서 실행")
class GenMepTest(unittest.TestCase):
    def test_bad_args(self):
        for a in (["--floors", "2"], ["--annex", "3"], ["--annex", "-1"], ["--density", "ultra"]):
            self.assertEqual(gen(*a)[0].returncode, 2, a)

    def test_main_building_default(self):
        r, out = gen("--annex", "0")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("db: elements=", r.stdout)
        f = ifcopenshell.open(out)
        st = {s.Name: s.Elevation for s in f.by_type("IfcBuildingStorey")}
        self.assertEqual(set(st), {"B2", "B1", "1F", "2F", "RF"} | {f"{i}F" for i in range(3, 11)})
        self.assertAlmostEqual(st["2F"], 5.0); self.assertAlmostEqual(st["RF"], 36.5)
        sp = {s.Name for s in f.by_type("IfcSpace")}
        self.assertTrue({"1F-로비", "1F-상가1", "2F-식당", "2F-회의1", "3F-사무A", "10F-사무B"} <= sp)
        self.assertEqual(len(f.by_type("IfcSystem")), 14)
        self.assertEqual(len(f.by_type("IfcSwitchingDevice")), 1)   # ATS 만 — 벽 스위치 없음
        names = [e.Name for e in f.by_type("IfcSensor")]
        self.assertIn("2F-회의1 연기감지기 1", names); self.assertIn("3F-사무A 열감지기 4", names)
        alarm = next(e for e in f.by_type("IfcSensor") if e.Name == "2F-회의1 연기감지기 1")
        self.assertEqual(ue.get_pset(alarm, "Pset_BimStatus")["Status"], "ALARM")
        for el in f.by_type("IfcElement"):   # 개구부 제외 전부 실 또는 층 소속
            if not el.is_a("IfcOpeningElement"):
                self.assertIsNotNone(ue.get_container(el), el.Name)

    def test_floors_and_density(self):
        r3, o3 = gen("--annex", "0", "--floors", "3", "--density", "low")
        rh, oh = gen("--annex", "0", "--floors", "3", "--density", "high")
        self.assertEqual((r3.returncode, rh.returncode), (0, 0), r3.stderr + rh.stderr)
        f3, fh = ifcopenshell.open(o3), ifcopenshell.open(oh)
        self.assertEqual(len([s for s in f3.by_type("IfcBuildingStorey") if s.Name == "4F"]), 0)
        self.assertGreater(len(fh.by_type("IfcLightFixture")), len(f3.by_type("IfcLightFixture")))
        self.assertGreater(len(fh.by_type("IfcOutlet")), 2)   # high 만 콘센트(EV 충전기 2 는 항상)
        self.assertEqual(len([o for o in f3.by_type("IfcOutlet")]), 2)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: 실패 확인(컨테이너)**

Run:
```bash
cd /Users/hubilon_map/orca/projects/bim-platform
docker compose cp samples/gen ifc-worker:/tmp/gen && docker compose exec ifc-worker sh -c 'cd /tmp/gen && python -m unittest test_gen_mep -v'
```
Expected: `test_bad_args` FAIL(현재는 인자를 무시하고 0 으로 끝남), `test_main_building_default` FAIL(`4F` 없음).

- [ ] **Step 3: 머리(1~25행)를 argparse + mep_plan import 로 교체**

기존 `import sys` ~ `dx, dy = …` (6~24행)을 아래로 바꾼다. docstring 은 첫 줄에 `실행: python gen_mep.py [out.ifc] --floors 10 --annex 1 --density mid` 를 추가한다.

```python
import argparse
import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.api.root, ifcopenshell.api.unit, ifcopenshell.api.context, ifcopenshell.api.project
import ifcopenshell.api.geometry, ifcopenshell.api.spatial, ifcopenshell.api.aggregate, ifcopenshell.api.system, ifcopenshell.api.pset, ifcopenshell.api.style, ifcopenshell.api.feature
import ifcopenshell.util.element as ue
from ifcopenshell.util.shape_builder import ShapeBuilder, V
from mep_plan import D, DS, ELV, EPS, EXCL_CORE, PLAN, PS, SHAFTS, ST1, ST2, W, floor_spec, pad, place

ap = argparse.ArgumentParser(description="가상 업무동 MEP IFC 생성")
ap.add_argument("out", nargs="?", default="mep-building.ifc")
ap.add_argument("--floors", type=int, default=10, help="지상 층수 (3 이상)")
ap.add_argument("--annex", type=int, choices=(0, 1, 2), default=1, help="부속동 수: 1=주차타워, 2=주차타워+후생동")
ap.add_argument("--density", choices=("low", "mid", "high"), default="mid", help="말단 밀도: low 고정 좌표 / mid 격자 4m / high 격자 2.5m+콘센트")
args = ap.parse_args()
if args.floors < 3: ap.error("--floors 는 3 이상")

H = 3.5                                # 지하 층고 (B2·B1 코드 전용 — 램프·개구부 계산이 이 값에 묶여 있어 고정)
FLOORS = floor_spec(args.floors)       # [(이름, z, h, kind)] RF 포함
Z = {n: z for n, z, _, _ in FLOORS}; HH = {n: h for n, _, h, _ in FLOORS}
RF = Z["RF"]                           # 옥상 슬래브 상단 = 최상 지상층 z+h. 입상 top 도 이 값
RF_TOP = RF + 3.0                      # 옥탑 상단
ex, ey = EPS[0] + EPS[2] / 2, EPS[1] + EPS[3] / 2
px, py = PS[0] + PS[2] / 2, PS[1] + PS[3] / 2
dx, dy = DS[0] + DS[2] / 2, DS[1] + DS[3] / 2
```

`W, D, H = 36.0, 16.0, 3.5`, `FLOORS = […]`, `ST1/ST2/RF/EPS/PS/DS/ELV` 정의 행은 삭제(mep_plan 에서 온다).

- [ ] **Step 4: 구조 루프(100~131행)를 층고별로**

`storeys, spaces, slabs = {}, {}, {}` 부터 `def S(k)` 앞까지를 아래로 교체한다.

```python
storeys, spaces, slabs = {}, {}, {}
for name, z, h, kind in FLOORS:
    st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name=name); st.Elevation = z
    api.aggregate.assign_object(f, relating_object=bld, products=[st]); storeys[name] = st
    slabs[name] = make("IfcSlab", f"{name} 바닥", [box(0, 0, z - 0.2, W, D, 0.2)], st, ST["slab"], ptype="ROOF" if kind == "roof" else "FLOOR")
    if name != "B2":   # 샤프트(EPS·PS·DS·EV)·계단실은 슬래브를 관통 → 개구부
        for label, (x, y, w, d) in SHAFTS:
            void(slabs[name], x, y, z - 0.25, w, d, 0.3, f"{name} {label} 개구부")
    if kind == "roof":
        make("IfcWall", "옥상 파라펫", [box(0, 0, z, W, 0.2, 1.0), box(0, D - 0.2, z, W, 0.2, 1.0), box(0, 0, z, 0.2, D, 1.0), box(W - 0.2, 0, z, 0.2, D, 1.0)], st, ST["wall"])
        continue
    for (x, y, w, d) in [(0, 0, W, 0.2), (0, D - 0.2, W, 0.2), (0, 0, 0.2, D), (W - 0.2, 0, 0.2, D)]:
        if name == "B1" and y == D - 0.2:   # B1 북벽: 옥외 진입 램프 출입구 (x 30~35.5) 개구
            make("IfcWall", f"{name} 외벽", [box(0, y, z, 30.0, 0.2, h), box(35.5, y, z, 0.5, 0.2, h)], st, ST["wall"]); continue
        make("IfcWall", f"{name} 외벽", [box(x, y, z, w, d, h)], st, ST["wall"])
    for label, (x, y, w, d) in SHAFTS:
        make("IfcWall", f"{name} {label} {'계단실' if label.startswith('ST') else '샤프트'}", [box(x, y, z, w, 0.1, h), box(x, y + d, z, w, 0.1, h), box(x, y, z, 0.1, d, h), box(x + w, y, z, 0.1, d, h)], st, ST["shaft"])
    zones = [("변전실", 0, 4, 7, 6.5), ("발전기실", 0, 10.5, 7, 5.5), ("펌프실", 7, 4, 5.5, 5), ("주차C", 7, 9, 13.6, 7), ("기계실", 20.6, 4, 8.4, 12), ("수조실", 29, 4, 7, 6), ("오폐수처리실", 29, 10, 7, 6), ("램프", 5, 0, 25, 3.8)] if name == "B2" \
        else [("주차A", 0, 0, 9.4, 8), ("방재실", 0, 8, 7, 4), ("통신실", 0, 12, 7, 4), ("주차관제실", 7, 12, 3.2, 4), ("램프", 9.4, 0, 20.6, 3.8), ("주차B", 20.6, 3.8, 15.4, 12.2)] if name == "B1" \
        else PLAN[kind]
    for zname, x, y, w, d in zones:
        sp = api.root.create_entity(f, ifc_class="IfcSpace", name=f"{name}-{zname}")
        api.geometry.assign_representation(f, product=sp, representation=rep([box(x + 0.2, y + 0.2, z, w - 0.4, d - 0.4, h - 0.3)], ST["space"]))
        api.geometry.edit_object_placement(f, product=sp); api.aggregate.assign_object(f, relating_object=st, products=[sp]); spaces[f"{name}-{zname}"] = sp
rf = storeys["RF"]; b1 = storeys["B1"]; b2 = storeys["B2"]; zb = -3.5; z2 = -7.0; top = RF
```

옥상 공간·보일러실(126~130행)은 그대로 둔다(`RF` 기준, 높이 3.0 = `RF_TOP - RF`).

- [ ] **Step 5: 계단(133~136행) rise = h/2**

```python
for label, (sx, sy, sw, sd) in (("ST-1", ST1), ("ST-2", ST2)):
    for (name, z, h, _), (nxt, *_) in zip(FLOORS[:-1], FLOORS[1:]):
        r_ = h / 2
        make("IfcStair", f"{label} 계단 {name}→{nxt}", [ramp(sx + 0.1, sy + 0.3, z, 1.15, 0.6, 2.0, r_), box(sx + 0.1, sy + 2.3, z + r_, sw - 0.2, 1.0, 0.15), ramp(sx + sw - 1.25, sy + 2.7, z + r_, 1.15, 0.6, -2.0, r_)],
             storeys[name], ST["slab"], None, "HALF_TURN_STAIR")
```

- [ ] **Step 6: 에스컬레이터·덤웨이터(254~265행) 1F 층고 5.0 반영**

30° 유지: rise 5.0 → run 8.6. 상부 랜딩이 D=16 안에 들게 시작 y 를 5.5 로.

```python
# 에스컬레이터: 1F 로비 → 2F 식당. 1F(z=0) y=5.5 → 2F(z=h1F) y=14.1, 경사 30°. 상·하행 2대. 2F 슬래브 개구부(머리 높이 2.1m 확보 지점부터)
ESC_RUN, ESC_RISE, ESC_Y = 8.6, HH["1F"], 5.5
esc_items = []
for x in (2.0, 3.4):
    esc_items += [ramp(x, ESC_Y, -0.3, 1.2, 0.8, ESC_RUN, ESC_RISE),
                  ramp(x, ESC_Y, 0.9, 0.06, 0.8, ESC_RUN, ESC_RISE), ramp(x + 1.14, ESC_Y, 0.9, 0.06, 0.8, ESC_RUN, ESC_RISE),
                  box(x, ESC_Y - 1.2, 0.0, 1.2, 1.2, 0.05), box(x, ESC_Y + ESC_RUN + 0.8, ESC_RISE, 1.2, 1.0, 0.05)]
ESC = make("IfcTransportElement", "ES-1 에스컬레이터 1F↔2F", esc_items, S("1F-로비"), ST["trans"], None, "ESCALATOR", {"Status": "RUNNING"})
esc_y0 = ESC_Y + ESC_RUN * (ESC_RISE - 2.1) / ESC_RISE
ESC_OPEN = (1.7, esc_y0, 3.2, ESC_Y + ESC_RUN + 1.8 - esc_y0)          # 2F 개구부 사각형 — 말단 격자 제외 영역
void(slabs["2F"], ESC_OPEN[0], ESC_OPEN[1], Z["2F"] - 0.25, ESC_OPEN[2], ESC_OPEN[3], 0.3, "2F 에스컬레이터 개구부")
DW_OPEN = (ELV[0] - 1.2, ELV[1] + 0.6, 0.9, 0.9)                          # 덤웨이터 개구부(2F·3F)
DW = make("IfcTransportElement", "DW-1 덤웨이터 (2F 식당용)", [box(DW_OPEN[0], DW_OPEN[1], 0.0, 0.9, 0.9, top)], storeys["1F"], ST["trans"], None, "ELEVATOR", {"Status": "NORMAL"})
for n_ in ("2F", "3F"): void(slabs[n_], DW_OPEN[0], DW_OPEN[1], Z[n_] - 0.25, 0.9, 0.9, 0.3, f"{n_} 덤웨이터 개구부")
```

- [ ] **Step 7: 지하·옥탑 코드의 `H` 점검**

지하 코드(146~308행)의 `H` 는 전부 지하 층고라 그대로 둔다(`gz + H - 0.4`, `z + H - 0.35` 등). `top` 을 쓰는 입상 식(`top - z2 - 2.8`, `RF - top + 1.2`)은 `top = RF` 라 변경 없음. `PCS` 의 초기 `Capacity/Occupied` 는 나중에 부속동까지 합쳐 다시 쓰므로 `spots` 루프 바로 뒤에 두 줄 추가:

```python
spot_occ = [i % 3 != 1 for i in range(len(spots))]   # 부속동 주차면이 더해지면 끝에서 PCS 집계를 다시 쓴다
def set_status(el, props):
    api.pset.edit_pset(f, pset=f.by_id(ue.get_pset(el, "Pset_BimStatus")["id"]), properties=props)
```

- [ ] **Step 8: 층별 블록(310~359행)을 `fit_zone` + PLAN 루프로 교체**

```python
# ---------- 지상층: 층 공용(EPS·PS·DS 장비, 분기관) + PLAN 실별 말단(fit_zone) ----------
det_status = {("2F", "회의1", 0): ("ALARM", "2026-08-28T13:42"), ("3F", "사무A", "last"): ("FAULT", None)}

def fit_zone(sp, x, y, w, d, z, h, west, c, key, excl=()):
    """실 하나의 말단. c = 상류 묶음(dict) — lp·lcp·elp·rpt·fpb·hc·wsb·hwsb·wwb·chwb·hb·ddc·odu·tx·my. None/없음이면 그 말단은 만들지 않는다.
    west: 고정 말단(분전반·소화전·밸브)을 서쪽 벽에 붙일지(코어 반대편). key = (층, 실) — 이름 접두어·det_status 조회"""
    x0, x1, fl, rm = x, x + w, key[0], key[1]
    ax = x0 + 0.3 if west else x1 - 0.55                       # 앵커 벽 x
    ex_ = list(excl) + EXCL_CORE
    pts = lambda kind: place(kind, x, y, w, d, args.density, ex_)
    ZP = None
    if c.get("lp"):
        tx0, tx1 = (c["tx"] - 0.15, x0 + 1.0) if west else (c["tx"] + 0.15, x1 - 1.0)
        tray = make("IfcCableCarrierSegment", f"{fl}-{rm} 트레이", [box(min(tx0, tx1), ey - 0.1 if fl[0] != "W" else y + d / 2, z + 3.05, abs(tx1 - tx0), 0.2, 0.1)], sp, ST["tray"], None, "CABLETRAYSEGMENT"); link(c["lp"], tray, "전기")
        ZP = make("IfcElectricDistributionBoard", f"LP-{fl}-{rm} 구역 분전반", [box(ax, y + d / 2 - 0.3, z + 1.2, 0.25, 0.6, 0.8)], sp, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 220.0, "RatedCurrent": 100.0}}, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 22.0}); link(tray, ZP, "전기")
        for i, (lx, ly) in enumerate(pts("light")):
            L = make("IfcLightFixture", f"{fl}-{rm} 조명 {i + 1}", [box(lx - 0.6, ly - 0.15, z + h - 0.35, 1.2, 0.3, 0.08)], sp, ST["light"], None, "POINTSOURCE", {"Status": "NORMAL", "On": True}); link(ZP, L, "전기")
            if c.get("lcp"): link(c["lcp"], L, "전기")
        if args.density == "high":   # 콘센트: 남·북 벽면 따라 3 m 간격
            for i, (ox, oy) in enumerate([(x0 + 1.5 + 3 * j, yy) for yy in (y + 0.25, y + d - 0.35) for j in range(int((w - 3.0) // 3) + 1)]):
                O = make("IfcOutlet", f"{fl}-{rm} 콘센트 {i + 1}", [box(ox, oy, z + 0.3, 0.12, 0.1, 0.12)], sp, ST["el"], None, "POWEROUTLET"); link(ZP, O, "전기")
    if c.get("elp"):
        for i, lx in enumerate((x0 + 1.0, x1 - 1.0)):
            EL = make("IfcLightFixture", f"{fl}-{rm} 비상조명 {i + 1}", [box(lx - 0.15, y + d / 2 - 0.15, z + 2.4, 0.3, 0.3, 0.15)], sp, ST["em"], None, "EMERGENCY", {"Status": "NORMAL", "BatteryLevel": 100.0}); link(c["elp"], EL, "비상전원")
    if c.get("rpt"):
        dp = pts("det")
        for i, (dxx, dyy) in enumerate(dp):
            heat = i == len(dp) - 1   # 모서리 하나는 열감지기
            status, at = det_status.get((fl, rm, "last" if heat else i), ("NORMAL", None))
            DET = make("IfcSensor", f"{fl}-{rm} {'열' if heat else '연기'}감지기 {i + 1}", [cyl(dxx, dyy, z + h - 0.4, 0.06, 0.05), sb.sphere(radius=0.07, center=V(dxx, dyy, z + h - 0.4))], sp, ST["fa"], None, "HEATSENSOR" if heat else "SMOKESENSOR", {"Status": status, "AlarmAt": at or "", "LastTest": "2026-07-15"}); link(DET, c["rpt"], "화재감지")
    if c.get("fpb"):
        for i, (sx, sy) in enumerate(pts("spr")):
            SPR = make("IfcFireSuppressionTerminal", f"{fl}-{rm} 스프링클러 {i + 1}", [pipe([(sx, c["my"], z + h - 0.3), (sx, sy, z + h - 0.3)], 0.015), sb.sphere(radius=0.08, center=V(sx, sy, z + h - 0.3))], sp, ST["fp"], None, "SPRINKLER"); link(c["fpb"], SPR, "소방")
    if c.get("hc"):
        HC = make("IfcFireSuppressionTerminal", f"HC-{fl}-{rm} 옥내소화전", [box(ax, y + d / 2 + 1.5, z, 0.6, 0.25, 1.6)], sp, ST["fp"], None, "HOSEREEL", {"Status": "NORMAL"}); link(c["hc"], HC, "소방")
    if c.get("wsb"):
        vx = x0 + 2.5 if west else x1 - 2.5
        VL = make("IfcValve", f"V-{fl}-{rm} 구역 급수밸브", [box(vx - 0.15, y + 2.85, z + 2.85, 0.3, 0.3, 0.3)], sp, ST["ws"], None, "ISOLATION", {"Status": "NORMAL", "Open": True}); link(c["wsb"], VL, "급수")
        for i in range(2):
            fx = vx + (i * 1.5 if west else -i * 1.5)
            SAN = make("IfcSanitaryTerminal", f"{fl}-{rm} 위생기구 {i + 1}", [box(fx - 0.3, y + 0.4, z, 0.6, 0.7, 0.4), pipe([(fx, y + 0.7, z + 0.4), (fx, y + 3.0, z + 3.0)], 0.02), pipe([(fx, y + 0.75, z), (fx, y + d - 3.0, z + 0.15)], 0.03)], sp, ST["ws"], None, "TOILETPAN"); link(VL, SAN, "급수")
            if c.get("wwb"): link(SAN, c["wwb"], "배수")
            if c.get("hwsb"): link(c["hwsb"], SAN, "급탕")
    if c.get("hb"):   # 공조: 풍량댐퍼 → VAV(실) → 덕트 → 디퓨저
        vav = make("IfcAirTerminalBox", f"VAV-{fl}-{rm}", [box((x0 + 1.5) if west else (x1 - 2.5), dy - 0.4, z + 3.0, 1.0, 0.8, 0.35)], sp, ST["hvac"], None, "VARIABLEFLOWPRESSUREDEPENDANT", {"Status": "NORMAL", "DamperPercent": 55.0, "RoomTemp": 24.1}); link(c["hb"], vav, "공조"); link(c["ddc"], vav, "통신")
        bd = make("IfcDuctSegment", f"{fl}-{rm} 급기 덕트", [box(x0 + 2.5 if west else x0 + 1.5, dy - 0.3, z + 3.05, w - 4.0, 0.6, 0.3)], sp, ST["duct"], None, "RIGIDSEGMENT"); link(vav, bd, "공조")
        for i, (ax_, ay) in enumerate(pts("dif")):
            dif = make("IfcAirTerminal", f"{fl}-{rm} 디퓨저 {i + 1}", [box(ax_ - 0.3, ay - 0.3, z + h - 0.32, 0.6, 0.6, 0.05)], sp, ST["hvac"], None, "DIFFUSER"); link(bd, dif, "공조")
    fx2 = x0 + 1.5 if west else x1 - 1.5
    if c.get("chwb") and ZP:
        for i, fy in enumerate((y + d * 0.25, y + d * 0.75)):
            fcu = make("IfcUnitaryEquipment", f"FCU-{fl}-{rm}-{i + 1} 팬코일", [box(fx2 - 0.5, fy - 0.25, z + 2.8, 1.0, 0.5, 0.3)], sp, ST["hvac"], None, "AIRCONDITIONINGUNIT", {"Status": "RUNNING", "SetTemp": 24.0, "FanSpeed": "MED"}); link(c["chwb"], fcu, "냉난방수"); link(ZP, fcu, "전기"); link(c["ddc"], fcu, "통신")
    if c.get("odu") and ZP:   # 후생동: 실외기 → 실내기 (냉난방수·공조 계통을 동 밖으로 끌지 않음)
        for i, fy in enumerate((y + d * 0.25, y + d * 0.75)):
            idu = make("IfcUnitaryEquipment", f"IDU-{fl}-{rm}-{i + 1} 실내기", [box(fx2 - 0.5, fy - 0.2, z + h - 0.6, 1.0, 0.4, 0.3)], sp, ST["hvac"], None, "SPLITSYSTEM", {"Status": "RUNNING", "SetTemp": 24.0}); link(c["odu"], idu, "공조"); link(ZP, idu, "전기")

for name, z, h, kind in FLOORS:
    if kind not in PLAN: continue
    st = storeys[name]
    LP = make("IfcElectricDistributionBoard", f"LP-{name} 층 분전반", [box(EPS[0] + 0.2, EPS[1] + 0.3, z + 0.8, 0.6, 0.25, 1.0)], st, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 250.0}}, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 35.0}); link(riser_el, LP, "전기")
    LCP = make("IfcController", f"LCP-{name} 조명제어반", [box(EPS[0] + 0.2, EPS[1] + 0.05, z + 2.0, 0.4, 0.2, 0.4)], st, ST["el"], None, "PROGRAMMABLE", {"Status": "ONLINE", "Scene": "OFFICE"}); link(LP, LCP, "전기"); link(riser_comm, LCP, "통신")
    ELP = make("IfcElectricDistributionBoard", f"ELP-{name} 층 비상분전반", [box(EPS[0] + 0.2, EPS[1] + 1.2, z + 0.8, 0.4, 0.25, 0.6)], st, ST["em"], None, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED"}); link(riser_em, ELP, "비상전원")
    RPT = make("IfcUnitaryControlElement", f"RPT-{name} 층 중계기", [box(EPS[0] + 0.7, EPS[1] + 1.2, z + 1.6, 0.3, 0.15, 0.3)], st, ST["fa"], None, "ALARMPANEL", {"Status": "NORMAL"}); link(RPT, riser_fa, "화재감지")
    IDF = make("IfcCommunicationsAppliance", f"IDF-{name} 층 통신단자함", [box(EPS[0] + 0.7, EPS[1] + 0.3, z + 1.6, 0.4, 0.2, 0.6)], st, ST["comm"], None, "NETWORKHUB", {"Status": "ONLINE"}); link(riser_comm, IDF, "통신"); link(ELP, IDF, "비상전원")
    DDC = make("IfcController", f"DDC-{name} 층 제어반", [box(EPS[0] + 0.2, EPS[1] + 1.6, z + 2.2, 0.35, 0.15, 0.35)], st, ST["comm"], None, "PROGRAMMABLE", {"Status": "ONLINE"}); link(BMS, DDC, "통신"); link(IDF, DDC, "통신")
    AV = make("IfcValve", f"AV-{name} 알람밸브", [box(px + 0.15, py + 0.5, z + 1.0, 0.3, 0.3, 0.3)], st, ST["fp"], None, "ISOLATION", {"Status": "NORMAL", "Open": True, "Pressure": 0.55}); link(riser_fp, AV, "소방")
    FD = make("IfcDamper", f"FD-{name} 방화댐퍼", [box(dx - 0.5, dy - 0.4, z + 3.0, 1.0, 0.8, 0.15)], st, ST["vent"], None, "FIREDAMPER", {"Status": "NORMAL", "Open": True}); link(duct_riser, FD, "공조"); link(RPT, FD, "화재감지")
    SD = make("IfcDamper", f"SD-{name} 제연댐퍼", [box(dx + 0.2, dy - 0.4, z + 2.6, 0.5, 0.8, 0.15)], st, ST["vent"], None, "SMOKEDAMPER", {"Status": "NORMAL", "Open": False}); link(SD, ex_riser, "환기"); link(RPT, SD, "화재감지")
    ERV = make("IfcAirToAirHeatRecovery", f"ERV-{name} 전열교환기", [box(dx + 1.2, dy - 0.6, z + 2.7, 1.2, 1.0, 0.5)], st, ST["vent"], None, "FIXEDPLATECOUNTERFLOWEXCHANGER", {"Status": "RUNNING"}); link(ELP, ERV, "비상전원"); link(ERV, ex_riser, "환기")
    HB = make("IfcDamper", f"CD-{name} 층 풍량조절댐퍼", [box(dx - 0.5, dy + 0.5, z + 3.0, 1.0, 0.3, 0.15)], st, ST["vent"], None, "CONTROLDAMPER", {"Status": "NORMAL", "OpenPercent": 70.0}); link(FD, HB, "공조"); link(DDC, HB, "통신")
    WSB = make("IfcPipeSegment", f"{name} 급수 분기관", [pipe([(px - 0.3, py, z + 3.0), (px - 0.3, 3.0, z + 3.0), (2, 3.0, z + 3.0)], 0.04), pipe([(px - 0.3, 3.0, z + 3.0), (W - 2, 3.0, z + 3.0)], 0.04)], st, ST["ws"], None, "RIGIDSEGMENT"); link(riser_ws, WSB, "급수")
    HWSB = make("IfcPipeSegment", f"{name} 급탕 분기관", [pipe([(px - 0.5, py, z + 3.1), (px - 0.5, 2.8, z + 3.1), (2, 2.8, z + 3.1)], 0.03), pipe([(px - 0.5, 2.8, z + 3.1), (W - 2, 2.8, z + 3.1)], 0.03)], st, ST["hw"], None, "RIGIDSEGMENT"); link(riser_hw, HWSB, "급탕")
    WWB = make("IfcPipeSegment", f"{name} 배수 횡주관", [pipe([(2, 13.0, z + 0.15), (px, 13.0, z + 0.15), (px, py - 0.3, z + 0.15)], 0.05), pipe([(W - 2, 13.0, z + 0.15), (px, 13.0, z + 0.15)], 0.05)], st, ST["ww"], None, "RIGIDSEGMENT"); link(WWB, riser_ww, "배수")
    FPB = make("IfcPipeSegment", f"{name} 스프링클러 주관", [pipe([(px + 0.3, py + 0.5, z + h - 0.3), (2, py + 0.5, z + h - 0.3)], 0.04), pipe([(px + 0.3, py + 0.5, z + h - 0.3), (W - 2, py + 0.5, z + h - 0.3)], 0.04)], st, ST["fp"], None, "RIGIDSEGMENT"); link(AV, FPB, "소방")
    CHWB = make("IfcPipeSegment", f"{name} 냉온수 분기관", [pipe([(px + 0.5, py + 0.5, z + 3.05), (px + 0.5, 6.0, z + 3.05), (2, 6.0, z + 3.05)], 0.035), pipe([(px + 0.5, 6.0, z + 3.05), (W - 2, 6.0, z + 3.05)], 0.035)], st, ST["chw"], None, "RIGIDSEGMENT"); link(riser_chw, CHWB, "냉난방수")
    SPK = make("IfcAudioVisualAppliance", f"{name} 비상방송 스피커", [box(EPS[0] - 0.5, EPS[1] + 0.8, z + 2.6, 0.25, 0.15, 0.25)], st, ST["comm"], None, "SPEAKER", {"Status": "ONLINE"}); link(PA, SPK, "화재감지")
    CAM = make("IfcAudioVisualAppliance", f"CCTV-{name} 복도 카메라", [sb.sphere(radius=0.12, center=V(ELV[0] - 0.5, ELV[1] - 0.3, z + 3.0))], st, ST["comm"], None, "CAMERA", {"Status": "ONLINE"}); link(IDF, CAM, "통신")
    ACR = make("IfcUnitaryControlElement", f"ACR-{name} 출입 카드리더", [box(ELV[0] + ELV[2] + 0.3, ELV[1] - 0.2, z + 1.2, 0.1, 0.1, 0.15)], st, ST["comm"], None, "CONTROLPANEL", {"Status": "ONLINE"}); link(IDF, ACR, "통신"); link(ACS, ACR, "통신")
    ctx_ = {"lp": LP, "lcp": LCP, "elp": ELP, "rpt": RPT, "fpb": FPB, "hc": riser_fp, "wsb": WSB, "hwsb": HWSB, "wwb": WWB, "chwb": CHWB, "hb": HB, "ddc": DDC, "tx": ex, "my": py + 0.5}
    excl = ([ESC_OPEN] if name == "2F" else []) + ([DW_OPEN] if name in ("2F", "3F") else [])
    for zname, x, y, w, d in PLAN[kind]:
        fit_zone(spaces[f"{name}-{zname}"], x, y, w, d, z, h, x < 13, ctx_, (name, zname), excl)
```

기존 층별 `HC-{name} 옥내소화전`(330행)은 실별 소화전으로 옮겨졌으므로 삭제한다.

- [ ] **Step 9: 쓰기·자기 검사·카운트(361~363행) 교체**

```python
# ---------- 자기 검사 · 쓰기 · 카운트 ----------
for s in systems.values():   # 계통 배정 요소는 흐름 연결이 1개 이상
    for rel in s.IsGroupedBy:
        for el in rel.RelatedObjects:
            assert el.ConnectedTo or el.ConnectedFrom, f"연결 없는 계통 요소: {el.Name}"
for el in f.by_type("IfcElement"):   # 개구부 외 모든 요소는 실 또는 층에 직접 소속 (개구부는 호스트를 통해 간접 소속)
    if not el.is_a("IfcOpeningElement"):
        c_ = ue.get_container(el); assert c_ is not None and c_.is_a() in ("IfcSpace", "IfcBuildingStorey"), f"소속 없는 요소: {el.Name}"
names_ = [s.Name for s in f.by_type("IfcSpace")] + [s.Name for s in f.by_type("IfcBuildingStorey")]
assert len(names_) == len(set(names_)), "실·층 이름 중복"
f.write(args.out)
els, ops = f.by_type("IfcElement"), f.by_type("IfcOpeningElement")
print(f"ifc: elements={len(els)} openings={len(ops)} distribution_systems={len(f.by_type('IfcDistributionSystem'))}")   # 원시 IFC
print(f"db: elements={len(els) - len(ops)} systems={len(f.by_type('IfcSystem'))} connections={len(f.by_type('IfcRelConnectsElements'))}")   # 워커 적재 기준 — DB 와 비교하는 값
```

`spot_occ` 로 PCS 집계 갱신은 부속동 뒤에 와야 하므로 자기 검사 바로 앞에 둔다(Task 3 에서 부속동 호출을 이 줄 앞에 넣는다):

```python
set_status(PCS, {"Capacity": len(spot_occ), "Occupied": sum(spot_occ)}); set_status(DISP, {"Text": f"여유 {len(spot_occ) - sum(spot_occ)}"})
```

- [ ] **Step 10: 컨테이너에서 테스트 통과 확인**

Run:
```bash
cd /Users/hubilon_map/orca/projects/bim-platform
docker compose cp samples/gen ifc-worker:/tmp/gen && docker compose exec ifc-worker sh -c 'cd /tmp/gen && python -m unittest test_gen_mep -v && python gen_mep.py /tmp/gen/a0.ifc --annex 0'
```
Expected: `Ran 3 tests … OK`, 이어 `ifc: …` / `db: …` 두 줄. AssertionError 가 나면 메시지의 요소 이름으로 연결·소속 누락을 고친다(검사를 완화하지 않는다). `--annex 1` 기본값은 아직 부속동 함수가 없으므로 이 단계에선 `--annex 0` 만 쓴다.

- [ ] **Step 11: 커밋**

```bash
git add samples/gen/gen_mep.py samples/gen/test_gen_mep.py
git commit -m "samples: gen_mep 매개변수화 — --floors/--density, 층별 층고(1F 5.0), PLAN 기반 실·fit_zone 말단 격자, 자기 검사·카운트 2줄"
```

---

### Task 3: 부속동 ① 주차타워 `annex_parking()`

**Files:**
- Modify: `samples/gen/gen_mep.py` (Task 2 Step 9 의 `set_status(PCS…)` 줄 앞에 삽입)
- Test: `samples/gen/test_gen_mep.py` (케이스 추가)

**Interfaces:**
- Consumes: `site, storeys, make, link, box, pipe, cyl, ramp, void, ST, MDB, EMDB, MDF, FACP, PCS, riser_fp, spot_occ, args`
- Produces: IfcBuilding `주차타워`, 층 `P1F/P2F/P3F`, `annex_parking() -> None`

- [ ] **Step 1: 테스트 추가**

`GenMepTest` 에 추가:

```python
    def test_annex_parking(self):
        r, out = gen("--annex", "1", "--floors", "3")
        self.assertEqual(r.returncode, 0, r.stderr)
        f = ifcopenshell.open(out)
        self.assertEqual({b.Name for b in f.by_type("IfcBuilding")}, {"업무동", "주차타워"})
        st = {s.Name: s for s in f.by_type("IfcBuildingStorey")}
        self.assertTrue({"P1F", "P2F", "P3F"} <= set(st)); self.assertAlmostEqual(st["P2F"].Elevation, 3.0)
        self.assertEqual(st["P1F"].Decomposes[0].RelatingObject.Name, "주차타워")   # IfcSite 아래 별도 IfcBuilding
        by = {e.Name: e for e in f.by_type("IfcElement")}
        cable = by["지중 케이블 (본동→P동)"]
        self.assertEqual(cable.ConnectedFrom[0].RelatingElement.Name, "MDB 저압 배전반")
        self.assertEqual(cable.ConnectedTo[0].RelatedElement.Name, "LP-P1F 분전반")
        self.assertEqual(by["RPT-P2F 중계기"].ConnectedTo[0].RelatedElement.Name, "FACP 화재수신기 (R형)")
        self.assertGreaterEqual(len([e for e in f.by_type("IfcSensor") if e.Name.startswith("P-P")]), 36)
```

- [ ] **Step 2: 실패 확인**

Run: 위 Task 2 Step 10 의 컨테이너 명령.
Expected: `test_annex_parking` FAIL(`주차타워` 없음).

- [ ] **Step 3: `annex_parking()` 구현**

Task 2 Step 9 의 `set_status(PCS…)` 줄 바로 앞에:

```python
# ---------- 부속동 ----------
def underground(name, cls, ptype, st_, p0, p1, r, sysname, up, style_):
    """지중 매설 구간(z −1.0): 본동 원천 → 부속동 1F 장비. 본동 1F 층 소속"""
    seg = make(cls, name, [pipe([p0, p1], r)], storeys["1F"], style_, None, ptype); link(up, seg, sysname); return seg

def annex_parking():
    """주차타워 P: x 44~64, y 0~16 (본동 동쪽 8 m 이격), 지상 3층 층고 3.0. 전기·비상전원·소방·통신은 지중으로 본동에서, 감지기는 본동 FACP 로, 주차면은 본동 PCS 가 관제"""
    PX, PY, PW, PD, PH = 44.0, 0.0, 20.0, 16.0, 3.0
    b = api.root.create_entity(f, ifc_class="IfcBuilding", name="주차타워"); api.aggregate.assign_object(f, relating_object=site, products=[b])
    ug_el = underground("지중 케이블 (본동→P동)", "IfcCableCarrierSegment", "CABLELADDERSEGMENT", None, (ex, ey, -1.0), (PX + 0.5, PY + 7.0, -1.0), 0.08, "전기", MDB, ST["tray"])
    ug_em = underground("지중 비상 케이블 (본동→P동)", "IfcCableCarrierSegment", "CABLELADDERSEGMENT", None, (ex - 0.5, ey, -1.0), (PX + 0.5, PY + 8.0, -1.0), 0.06, "비상전원", EMDB, ST["em"])
    ug_fp = underground("지중 소화배관 (본동→P동)", "IfcPipeSegment", "RIGIDSEGMENT", None, (px + 0.3, py, -1.0), (PX + 0.5, PY + 9.0, -1.0), 0.065, "소방", riser_fp, ST["fp"])
    ug_comm = underground("지중 광케이블 (본동→P동)", "IfcCableSegment", "FIBERSEGMENT", None, (ex + 0.4, ey - 0.6, -1.0), (PX + 0.5, PY + 10.0, -1.0), 0.02, "통신", MDF, ST["comm"])
    AVP = None; prev = {"lp": ug_el, "elp": ug_em, "idf": ug_comm}
    sl = {}
    for n in (1, 2, 3):
        name, z = f"P{n}F", (n - 1) * PH
        st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name=name); st.Elevation = z
        api.aggregate.assign_object(f, relating_object=b, products=[st]); storeys[name] = st
        sl[n] = make("IfcSlab", f"{name} 바닥", [box(PX, PY, z - 0.2, PW, PD, 0.2)], st, ST["slab"], ptype="FLOOR")
        walls = [(PX, PY + PD - 0.2, PW, 0.2), (PX, PY, 0.2, PD), (PX + PW - 0.2, PY, 0.2, PD)] + ([(PX, PY, 3.0, 0.2), (PX + 9.0, PY, PW - 9.0, 0.2)] if n == 1 else [(PX, PY, PW, 0.2)])   # P1F 남벽 x 47~53 출입구
        make("IfcWall", f"{name} 외벽", [box(x, y, z, w, d, PH) for x, y, w, d in walls], st, ST["wall"])
        if n < 3:   # 층간 램프(동측 x 61.2~63.8, +y 방향 run 13 m) + 윗층 슬래브 개구부(머리높이 2.1 m 확보 지점부터)
            make("IfcRamp", f"RP-P{n} 램프 {name}→P{n + 1}F", [ramp(PX + 17.2, PY + 0.5, z, 2.6, 2.0, 13.0, PH)], st, ST["slab"], None, "STRAIGHT_RUN_RAMP")
        if n > 1:
            y0 = PY + 0.5 + 13.0 * (PH - 2.1) / PH
            void(sl[n], PX + 17.0, y0, z - 0.25, 3.0, PY + 15.5 - y0, 0.3, f"{name} 램프 개구부")
        LP = make("IfcElectricDistributionBoard", f"LP-{name} 분전반", [box(PX + 0.3, PY + 6.5, z + 0.8, 0.6, 0.25, 1.0)], st, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 150.0}}, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 20.0}); link(prev["lp"], LP, "전기")
        ELP = make("IfcElectricDistributionBoard", f"ELP-{name} 비상분전반", [box(PX + 0.3, PY + 7.5, z + 0.8, 0.4, 0.25, 0.6)], st, ST["em"], None, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED"}); link(prev["elp"], ELP, "비상전원")
        IDF = make("IfcCommunicationsAppliance", f"IDF-{name} 통신단자함", [box(PX + 0.3, PY + 8.5, z + 1.6, 0.4, 0.2, 0.6)], st, ST["comm"], None, "NETWORKHUB", {"Status": "ONLINE"}); link(prev["idf"], IDF, "통신"); link(ELP, IDF, "비상전원")
        RPT = make("IfcUnitaryControlElement", f"RPT-{name} 중계기", [box(PX + 0.3, PY + 9.5, z + 1.6, 0.3, 0.15, 0.3)], st, ST["fa"], None, "ALARMPANEL", {"Status": "NORMAL"}); link(RPT, FACP, "화재감지"); link(ELP, RPT, "비상전원")
        prev = {"lp": LP, "elp": ELP, "idf": IDF}
        for i, (lx, ly) in enumerate(place("light", PX, PY, 16.0, PD, "mid")):
            L = make("IfcLightFixture", f"{name} 조명 {i + 1}", [box(lx - 0.6, ly - 0.15, z + PH - 0.35, 1.2, 0.3, 0.08)], st, ST["light"], None, "POINTSOURCE", {"Status": "NORMAL", "On": True}); link(LP, L, "전기")
        for i, lx in enumerate((PX + 5.0, PX + 12.0)):
            EL = make("IfcLightFixture", f"{name} 비상조명 {i + 1}", [box(lx - 0.15, PY + 7.85, z + 2.4, 0.3, 0.3, 0.15)], st, ST["em"], None, "EMERGENCY", {"Status": "NORMAL", "BatteryLevel": 100.0}); link(ELP, EL, "비상전원")
        for i, (hx, hy) in enumerate(place("det", PX, PY, 16.0, PD, "mid")):
            DET = make("IfcSensor", f"{name} 열감지기 {i + 1}", [cyl(hx, hy, z + PH - 0.4, 0.06, 0.05), sb.sphere(radius=0.07, center=V(hx, hy, z + PH - 0.4))], st, ST["fa"], None, "HEATSENSOR", {"Status": "NORMAL", "LastTest": "2026-07-15"}); link(DET, RPT, "화재감지")
        if AVP is None:
            AVP = make("IfcValve", "AV-P 알람밸브", [box(PX + 0.5, PY + 11.0, z + 1.0, 0.3, 0.3, 0.3)], st, ST["fp"], None, "ISOLATION", {"Status": "NORMAL", "Open": True, "Pressure": 0.55}); link(ug_fp, AVP, "소방")
        main_ = make("IfcPipeSegment", f"{name} 스프링클러 주관", [pipe([(PX + 0.8, PY + 8.0, z + PH - 0.3), (PX + 16.0, PY + 8.0, z + PH - 0.3)], 0.05)], st, ST["fp"], None, "RIGIDSEGMENT"); link(AVP, main_, "소방")
        for i, (sx, sy) in enumerate(place("spr", PX, PY, 16.0, PD, "mid")):
            SPR = make("IfcFireSuppressionTerminal", f"{name} 스프링클러 {i + 1}", [pipe([(sx, PY + 8.0, z + PH - 0.3), (sx, sy, z + PH - 0.3)], 0.015), sb.sphere(radius=0.08, center=V(sx, sy, z + PH - 0.3))], st, ST["fp"], None, "SPRINKLER"); link(main_, SPR, "소방")
        JF = make("IfcFan", f"JF-{name} 제트팬", [cyl(PX + 8.0, PY + 8.0, z + PH - 0.5, 0.3, 0.9)], st, ST["vent"], None, "TUBEAXIAL", {"Status": "STANDBY", "COppm": 6}); link(LP, JF, "전기")
        CO = make("IfcSensor", f"CO-{name} 일산화탄소 센서", [box(PX + 10.0, PY + 7.5, z + 1.5, 0.15, 0.1, 0.2)], st, ST["vent"], None, "GASSENSOR", {"Status": "NORMAL", "COppm": 6}); link(IDF, CO, "통신"); link(CO, JF, "환기")
        for j, (sx, sy) in enumerate([(PX + 0.5 + 2.5 * k, yy) for yy in (PY + 0.5, PY + 10.5) for k in range(6)]):   # 주차면 2.5×5 m, 12면/층
            occ = len(spot_occ) % 3 != 1; spot_occ.append(occ)
            S_ = make("IfcSensor", f"P-{name}{j + 1:02d} 주차면 센서", [box(sx + 0.1, sy + 0.1, z, 2.3, 4.8, 0.02), cyl(sx + 1.25, sy + 2.5, z + PH - 0.4, 0.06, 0.05)], st, ST["park"] if occ else ST["mark"], None, "MOVEMENTSENSOR", {"Status": "NORMAL", "Occupied": occ}); link(PCS, S_, "주차관제")
    BGP = make("IfcActuator", "BG-P 주차타워 입구 차단기", [box(PX + 3.5, PY + 0.3, 0.0, 0.4, 0.4, 1.0), box(PX + 3.9, PY + 0.45, 0.9, 2.3, 0.08, 0.08)], storeys["P1F"], ST["park"], None, "ELECTRICACTUATOR", {"Status": "NORMAL", "Open": False, "Cycles": 12040}); link(PCS, BGP, "주차관제")

if args.annex >= 1: annex_parking()
```

`underground()` 의 `st_` 인자는 쓰지 않으니 시그니처에서 빼도 된다 — 넣었다면 호출과 맞춘다.

- [ ] **Step 4: 통과 확인**

Run: Task 2 Step 10 명령 + `python gen_mep.py /tmp/gen/a1.ifc`(기본 인자).
Expected: `Ran 4 tests … OK`, 기본 인자 생성 성공, `db: elements=` 가 약 3천 근처(실측을 기록).

- [ ] **Step 5: 커밋**

```bash
git add samples/gen/gen_mep.py samples/gen/test_gen_mep.py
git commit -m "samples: 부속동 주차타워(P1F~P3F) — 지중 전기·비상·소방·통신, 램프·개구부, 주차면 36, 본동 FACP·PCS 연계"
```

---

### Task 4: 부속동 ② 후생동 `annex_welfare()`

**Files:**
- Modify: `samples/gen/gen_mep.py` (`if args.annex >= 1` 줄 아래)
- Test: `samples/gen/test_gen_mep.py`

**Interfaces:**
- Consumes: Task 2 `fit_zone`, `underground`, `SP, GASR, riser_ws, riser_fp, MDB, EMDB, MDF, FACP`
- Produces: IfcBuilding `후생동`, 층 `W1F/W2F`, 실 `W1F-식당·W1F-주방·W2F-체력단련실`

- [ ] **Step 1: 테스트 추가**

```python
    def test_annex_welfare(self):
        r, out = gen("--annex", "2", "--floors", "3", "--density", "high")
        self.assertEqual(r.returncode, 0, r.stderr)
        f = ifcopenshell.open(out)
        self.assertEqual({b.Name for b in f.by_type("IfcBuilding")}, {"업무동", "주차타워", "후생동"})
        sp = {s.Name for s in f.by_type("IfcSpace")}
        self.assertTrue({"W1F-식당", "W1F-주방", "W2F-체력단련실"} <= sp)
        by = {e.Name: e for e in f.by_type("IfcElement")}
        self.assertEqual(by["지중 배수관 (후생동→본동)"].ConnectedTo[0].RelatedElement.Name, "SP-1 집수정")
        self.assertEqual(by["GV-W 주방 가스 긴급차단밸브"].ConnectedFrom[0].RelatingElement.ConnectedFrom[0].RelatingElement.Name, "GR-1 가스 정압기")
        self.assertIn("IDU-W2F-체력단련실-1 실내기", by); self.assertNotIn("FCU-W2F-체력단련실-1 팬코일", by); self.assertNotIn("VAV-W2F-체력단련실", by)
        self.assertTrue(any(n.startswith("W1F-식당 콘센트") for n in by))
        self.assertEqual(by["W1F-식당 위생기구 1"].ConnectedTo[0].RelatedElement.Name, "W1F 배수 횡주관")
```

- [ ] **Step 2: 실패 확인**

Run: 컨테이너 명령. Expected: `test_annex_welfare` FAIL(`후생동` 없음).

- [ ] **Step 3: `annex_welfare()` 구현**

```python
def annex_welfare():
    """후생동 W: x 0~20, y 26~38 (본동 북쪽, 옥외 램프 y 16.5~20.5 회피), 지상 2층 층고 3.5. W1F 식당·주방, W2F 체력단련실.
    말단은 축소판(fit_zone 에 lcp·hwsb·chwb·hb·ddc 없음) — 냉난방수·공조 계통을 동 밖으로 끌지 않고 실외기→실내기"""
    WX, WY, WW, WD, WH = 0.0, 26.0, 20.0, 12.0, 3.5
    b = api.root.create_entity(f, ifc_class="IfcBuilding", name="후생동"); api.aggregate.assign_object(f, relating_object=site, products=[b])
    ug_el = underground("지중 케이블 (본동→후생동)", "IfcCableCarrierSegment", "CABLELADDERSEGMENT", None, (ex, ey, -1.0), (WX + 1.0, WY + 0.5, -1.0), 0.08, "전기", MDB, ST["tray"])
    ug_em = underground("지중 비상 케이블 (본동→후생동)", "IfcCableCarrierSegment", "CABLELADDERSEGMENT", None, (ex - 0.5, ey, -1.0), (WX + 1.0, WY + 1.0, -1.0), 0.06, "비상전원", EMDB, ST["em"])
    ug_fp = underground("지중 소화배관 (본동→후생동)", "IfcPipeSegment", "RIGIDSEGMENT", None, (px + 0.3, py, -1.0), (WX + 1.0, WY + 1.5, -1.0), 0.065, "소방", riser_fp, ST["fp"])
    ug_ws = underground("지중 급수관 (본동→후생동)", "IfcPipeSegment", "RIGIDSEGMENT", None, (px - 0.3, py, -1.0), (WX + 1.0, WY + 2.0, -1.0), 0.05, "급수", riser_ws, ST["ws"])
    ug_comm = underground("지중 광케이블 (본동→후생동)", "IfcCableSegment", "FIBERSEGMENT", None, (ex + 0.4, ey - 0.6, -1.0), (WX + 1.0, WY + 2.5, -1.0), 0.02, "통신", MDF, ST["comm"])
    ug_ww = make("IfcPipeSegment", "지중 배수관 (후생동→본동)", [pipe([(WX + 2.0, WY + 0.2, -0.5), (px, py - 0.3, -0.5), (px, py - 0.3, z2 + 0.3), (8.5, 7.8, z2 + 0.3)], 0.075)], storeys["1F"], ST["ww"], None, "RIGIDSEGMENT"); link(ug_ww, SP, "배수")
    gp_w = make("IfcPipeSegment", "가스 배관 (본동 옥탑→후생동)", [pipe([(34.7, 2.6, RF + 0.8), (34.7, D + 0.5, RF + 0.8), (34.7, D + 0.5, 3.0), (WX + 19.5, WY + 0.5, 3.0)], 0.03)], rf, ST["gas"], None, "RIGIDSEGMENT"); link(GASR, gp_w, "가스")
    fl = [("W1F", 0.0), ("W2F", WH)]; st_ = {}
    for name, z in fl:
        st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name=name); st.Elevation = z
        api.aggregate.assign_object(f, relating_object=b, products=[st]); storeys[name] = st; st_[name] = st
        make("IfcSlab", f"{name} 바닥", [box(WX, WY, z - 0.2, WW, WD, 0.2)], st, ST["slab"], ptype="FLOOR")
        make("IfcWall", f"{name} 외벽", [box(WX, WY, z, WW, 0.2, WH), box(WX, WY + WD - 0.2, z, WW, 0.2, WH), box(WX, WY, z, 0.2, WD, WH), box(WX + WW - 0.2, WY, z, 0.2, WD, WH)], st, ST["wall"])
        rooms = [("식당", WX, WY, 12.0, WD), ("주방", WX + 12.0, WY, 8.0, WD)] if name == "W1F" else [("체력단련실", WX, WY, WW, WD)]
        for zname, x, y, w, d in rooms:
            sp = api.root.create_entity(f, ifc_class="IfcSpace", name=f"{name}-{zname}")
            api.geometry.assign_representation(f, product=sp, representation=rep([box(x + 0.2, y + 0.2, z, w - 0.4, d - 0.4, WH - 0.3)], ST["space"]))
            api.geometry.edit_object_placement(f, product=sp); api.aggregate.assign_object(f, relating_object=st, products=[sp]); spaces[f"{name}-{zname}"] = sp
    make("IfcSlab", "후생동 지붕", [box(WX, WY, 2 * WH, WW, WD, 0.2)], st_["W2F"], ST["slab"], None, "ROOF")
    w1 = st_["W1F"]
    LPW = make("IfcElectricDistributionBoard", "LP-W1F 분전반", [box(WX + 0.3, WY + 0.5, 0.8, 0.6, 0.25, 1.0)], w1, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 150.0}}, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 25.0}); link(ug_el, LPW, "전기")
    ELPW = make("IfcElectricDistributionBoard", "ELP-W 비상분전반", [box(WX + 0.3, WY + 1.0, 0.8, 0.4, 0.25, 0.6)], w1, ST["em"], None, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED"}); link(ug_em, ELPW, "비상전원")
    RPTW = make("IfcUnitaryControlElement", "RPT-W 중계기", [box(WX + 0.3, WY + 1.5, 1.6, 0.3, 0.15, 0.3)], w1, ST["fa"], None, "ALARMPANEL", {"Status": "NORMAL"}); link(RPTW, FACP, "화재감지"); link(ELPW, RPTW, "비상전원")
    AVW = make("IfcValve", "AV-W 알람밸브", [box(WX + 0.5, WY + 2.0, 1.0, 0.3, 0.3, 0.3)], w1, ST["fp"], None, "ISOLATION", {"Status": "NORMAL", "Open": True, "Pressure": 0.55}); link(ug_fp, AVW, "소방")
    VW = make("IfcValve", "V-W 급수밸브", [box(WX + 0.5, WY + 2.5, 2.85, 0.3, 0.3, 0.3)], w1, ST["ws"], None, "ISOLATION", {"Status": "NORMAL", "Open": True}); link(ug_ws, VW, "급수")
    IDFW = make("IfcCommunicationsAppliance", "IDF-W 통신단자함", [box(WX + 0.3, WY + 3.0, 1.6, 0.4, 0.2, 0.6)], w1, ST["comm"], None, "NETWORKHUB", {"Status": "ONLINE"}); link(ug_comm, IDFW, "통신"); link(ELPW, IDFW, "비상전원")
    ODUW = make("IfcUnitaryEquipment", "ODU-W 실외기 (EHP)", [box(WX + 2.0, WY + 2.0, 2 * WH + 0.2, 1.2, 0.5, 1.2)], st_["W2F"], ST["hvac"], None, "SPLITSYSTEM", {"Status": "RUNNING"}); link(LPW, ODUW, "전기")
    KEF = make("IfcFan", "KEF-W 주방 배기팬", [box(WX + 17.0, WY + 10.0, WH - 0.9, 0.8, 0.8, 0.6)], spaces["W1F-주방"], ST["vent"], None, "CENTRIFUGALBACKWARDINCLINEDCURVED", {"Status": "RUNNING", "SpeedPercent": 50.0}); link(LPW, KEF, "전기"); api.system.assign_system(f, products=[KEF], system=systems["환기"])
    GVW = make("IfcValve", "GV-W 주방 가스 긴급차단밸브", [box(WX + 19.3, WY + 0.5, 1.2, 0.4, 0.4, 0.4)], spaces["W1F-주방"], ST["gas"], None, "ISOLATION", {"Status": "NORMAL", "Open": True}); link(gp_w, GVW, "가스")
    gp_k = make("IfcPipeSegment", "주방 가스 배관", [pipe([(WX + 19.5, WY + 0.9, 1.2), (WX + 19.5, WY + 6.0, 1.2), (WX + 14.0, WY + 6.0, 1.2)], 0.02)], spaces["W1F-주방"], ST["gas"], None, "RIGIDSEGMENT"); link(GVW, gp_k, "가스")
    for name, z in fl:
        st = st_[name]
        WSB = make("IfcPipeSegment", f"{name} 급수 분기관", [pipe([(WX + 0.65, WY + 2.65, z + 3.0), (WX + 0.65, WY + 3.0, z + 3.0), (WX + WW - 1.0, WY + 3.0, z + 3.0)], 0.04)], st, ST["ws"], None, "RIGIDSEGMENT"); link(VW, WSB, "급수")
        WWB = make("IfcPipeSegment", f"{name} 배수 횡주관", [pipe([(WX + WW - 1.0, WY + WD - 3.0, z + 0.15), (WX + 2.0, WY + WD - 3.0, z + 0.15), (WX + 2.0, WY + 0.2, z + 0.15), (WX + 2.0, WY + 0.2, -0.5)], 0.05)], st, ST["ww"], None, "RIGIDSEGMENT"); link(WWB, ug_ww, "배수")
        FPB = make("IfcPipeSegment", f"{name} 스프링클러 주관", [pipe([(WX + 0.65, WY + 2.15, z + WH - 0.3), (WX + 0.65, WY + WD / 2, z + WH - 0.3), (WX + WW - 1.0, WY + WD / 2, z + WH - 0.3)], 0.04)], st, ST["fp"], None, "RIGIDSEGMENT"); link(AVW, FPB, "소방")
        ctx_ = {"lp": LPW, "elp": ELPW, "rpt": RPTW, "fpb": FPB, "hc": AVW, "wsb": WSB, "wwb": WWB, "odu": ODUW, "tx": WX + 0.6, "my": WY + WD / 2}
        rooms = [("식당", WX, WY, 12.0, WD, True), ("주방", WX + 12.0, WY, 8.0, WD, False)] if name == "W1F" else [("체력단련실", WX, WY, WW, WD, True)]
        for zname, x, y, w, d, west in rooms:
            fit_zone(spaces[f"{name}-{zname}"], x, y, w, d, z, WH, west, ctx_, (name, zname))

if args.annex >= 2: annex_welfare()
```

`fit_zone` 의 트레이 y 는 후생동(`fl[0] == "W"`)이면 실 중앙(`y + d/2`)을 쓰도록 Task 2 Step 8 에 이미 넣었다. 후생동 실은 코어 제외 영역(`EXCL_CORE`, y 0~16)과 겹치지 않아 격자에 영향 없다.

- [ ] **Step 4: 통과 확인**

Run: 컨테이너 명령 + 조합 4개 생성:
```bash
docker compose exec ifc-worker sh -c 'cd /tmp/gen && python -m unittest test_gen_mep -v && for a in "mep-building.ifc" "a0.ifc --annex 0" "a2.ifc --annex 2"; do python gen_mep.py $a; done && time python gen_mep.py large.ifc --floors 20 --annex 2 --density high && ls -la *.ifc'
```
Expected: `Ran 5 tests … OK`, 4개 파일, 각 `db:` 줄 출력. 대형의 `real` 시간과 파일 크기를 메모(Task 8 README 에 쓴다).

- [ ] **Step 5: 커밋**

```bash
git add samples/gen/gen_mep.py samples/gen/test_gen_mep.py
git commit -m "samples: 부속동 후생동(W1F 식당·주방, W2F 체력단련실) — 자체 공급원 ctx, 실외기→실내기, 지중 배수→집수정, 가스 정압기→주방 차단밸브"
```

---

### Task 5: 모니터 API `building` 열

**Files:**
- Modify: `api/src/main/java/com/bim/api/MonitorController.java:24-43`
- Test: `api/src/test/java/com/bim/api/MonitorTests.java`

**Interfaces:**
- Produces: `GET /api/models/{id}/monitor` 행에 `building: string|null` (층의 부모 IfcBuilding 이름)

- [ ] **Step 1: 테스트 수정**

`seed()` 에서 층을 동 아래에 두고, 배관 하나는 층에 직접 소속시킨다:

```java
		long bd = db.sql("INSERT INTO spatial_node (model_id, global_id, ifc_class, name) VALUES (:m, 'BD1', 'IfcBuilding', '업무동') RETURNING id").param("m", mid).query(Long.class).single();
		long st = db.sql("INSERT INTO spatial_node (model_id, parent_id, global_id, ifc_class, name, elevation) VALUES (:m, :p, 'ST1', 'IfcBuildingStorey', 'B1', -3.5) RETURNING id").param("m", mid).param("p", bd).query(Long.class).single();
```

요소 루프에서 `PIPE` 만 `st` 에:

```java
			long eid = db.sql("INSERT INTO element (model_id, global_id, ifc_class, name, spatial_node_id) VALUES (:m, :g, :c, :n, :s) RETURNING id")
				.param("m", mid).param("g", e[0]).param("c", e[1]).param("n", e[2]).param("s", e[0].equals("PIPE") ? st : sp).query(Long.class).single();
```

테스트 본문 끝에:

```java
		assertThat(pump.get("building")).isEqualTo("업무동");   // 실 소속 → 층 → 동
		var pipe = all.stream().filter(r -> "PIPE".equals(r.get("globalId"))).findFirst().orElseThrow();
		assertThat(pipe.get("storey")).isEqualTo("B1"); assertThat(pipe.get("zone")).isNull(); assertThat(pipe.get("building")).isEqualTo("업무동");   // 층 직접 소속 → 동
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test --tests com.bim.api.MonitorTests -q; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: FAIL — `building` 이 null.

- [ ] **Step 3: SQL 수정**

`MonitorController.monitor` 의 SELECT 첫 줄과 JOIN·GROUP BY:

```java
			SELECT e.global_id "globalId", e.ifc_class "ifcClass", e.name, coalesce(st.elevation, sn.elevation) elevation, bd.name building,
```
`Sql.STOREY_ZONE_JOIN` 다음 줄에:
```java
			  LEFT JOIN spatial_node bd ON bd.id = coalesce(st.parent_id, sn.parent_id) AND bd.ifc_class = 'IfcBuilding'
```
GROUP BY:
```java
			 GROUP BY e.id, sn.id, st.id, bd.id, a.id
```
메서드 javadoc 에 한 줄: `building 은 층의 부모 동 이름 — 화면 층 단면이 같은 동의 다음 층을 상한으로 쓴다(부속동은 본동과 표고가 겹친다)`.

- [ ] **Step 4: 통과 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/api && ./gradlew test -q; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: 전체 통과(12+ 테스트). 유령 컴파일 오류가 나면 `./gradlew clean test`.

- [ ] **Step 5: 커밋**

```bash
git add api/src/main/java/com/bim/api/MonitorController.java api/src/test/java/com/bim/api/MonitorTests.java
git commit -m "api: 모니터 행에 building(층의 부모 동) — 부속동 층 단면용"
```

---

### Task 6: 화면 층 단면 — 같은 동의 다음 층

**Files:**
- Modify: `web/src/monitor.ts` (`Row` 타입, `Storey`, `storeyClipZ`)
- Modify: `web/src/MonitorPage.tsx:66-67,87`
- Test: `web/src/monitor.test.ts`

**Interfaces:**
- Consumes: Task 5 의 `Row.building`
- Produces: `type Storey = { name: string; z: number; building: string | null }`, `storeyClipZ(list: Storey[], name: string): [number, number]` — `[층 표고, 상한]`, 상한 = 같은 동에서 바로 위 층 표고, 없으면 `z + 3.5`

- [ ] **Step 1: 테스트 추가**

`web/src/monitor.test.ts` import 에 `storeyClipZ, type Storey` 추가, 끝에:

```ts
describe('storeyClipZ — 층 단면 상한은 같은 동의 다음 층', () => {
  const list: Storey[] = [{ name: '2F', z: 5, building: '업무동' }, { name: 'P3F', z: 6, building: '주차타워' }, { name: 'P2F', z: 3, building: '주차타워' }, { name: '1F', z: 0, building: '업무동' }, { name: 'P1F', z: 0, building: '주차타워' }]
  it('본동 1F: 사이에 낀 P2F(3m) 를 무시하고 2F(5m) 까지', () => expect(storeyClipZ(list, '1F')).toEqual([0, 5]))
  it('P1F: 표고가 같은 본동 1F 가 아니라 P2F 까지', () => expect(storeyClipZ(list, 'P1F')).toEqual([0, 3]))
  it('같은 동 최상층은 +3.5', () => expect(storeyClipZ(list, 'P3F')).toEqual([6, 9.5]))
  it('동 정보가 없는 모델(실무 IFC)은 전체를 한 동으로', () => expect(storeyClipZ([{ name: 'L1', z: 0, building: null }, { name: 'L2', z: 4, building: null }], 'L1')).toEqual([0, 4]))
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npx vitest run src/monitor.test.ts; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: 컴파일/실행 실패 — `storeyClipZ` 없음.

- [ ] **Step 3: `monitor.ts` 구현**

`Row` 타입의 `elevation: number | null;` 뒤에 `building: string | null;` 추가. 파일 끝에:

```ts
/** 층 목록 항목 — 모니터 행에서 층 이름별 첫 행의 표고·동 */
export type Storey = { name: string; z: number; building: string | null }
/** 층 단면 z 범위 [표고, 상한]. 상한은 같은 동에서 바로 위 층의 표고 — 부속동은 본동과 표고가 겹치고 층고가 달라 전체 정렬로는 엉뚱한 높이를 자른다. 같은 동에 위가 없으면 +3.5 */
export const storeyClipZ = (list: Storey[], name: string): [number, number] => {
  const s = list.find(e => e.name === name)!
  const above = list.filter(e => e.building === s.building && e.z > s.z).sort((a, b) => a.z - b.z)[0]
  return [s.z, above ? above.z : s.z + 3.5]
}
```

- [ ] **Step 4: `MonitorPage.tsx` 수정**

import 줄에 `storeyClipZ, type Storey` 추가. 66~67행:

```ts
  const storeyList = useMemo(() => { const m = new Map<string, Storey>(); rows.forEach(r => { if (r.storey && !m.has(r.storey)) m.set(r.storey, { name: r.storey, z: r.elevation ?? 0, building: r.building }) }); return [...m.values()].sort((a, b) => b.z - a.z) }, [rows])
  const storeys = storeyList.map(e => e.name).filter(s => !storeyF || s === storeyF)
```
87행:
```ts
  const storeyClip = (st: string) => { const [z0, z1] = storeyClipZ(storeyList, st); return `#/models/${modelId}?clip=-999,999,-999,999,${(z0 - 0.3).toFixed(1)},${(z1 - 0.05).toFixed(1)}` }
```

- [ ] **Step 5: 통과 확인**

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && npm test && npm run lint && npx tsc -b; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: vitest 전부 통과, oxlint 경고 0, tsc 오류 0.

- [ ] **Step 6: 커밋**

```bash
git add web/src/monitor.ts web/src/monitor.test.ts web/src/MonitorPage.tsx
git commit -m "web: 층 단면 링크 상한을 같은 동의 다음 층으로 (storeyClipZ) — 부속동 표고 겹침 대응"
```

---

### Task 7: 통합 검증 — 컨테이너 생성 → 업로드 → API·화면 확인 → 대형 측정

**Files:**
- 스크립트는 scratchpad 에만(저장소 미포함): `/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/7e3e2202-5cd9-4fd6-bd1a-45021d9937b6/scratchpad/verify-mep.sh`
- 산출: 측정표(Task 8 문서에 기록)

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: 기본·대형 모델 id(`scratchpad/mep_mid.txt`, `mep_large_mid.txt`), 측정 수치

- [ ] **Step 1: 서비스 재빌드**

```bash
cd /Users/hubilon_map/orca/projects/bim-platform
docker compose up -d --build --force-recreate api web
until curl -sf localhost:8080/actuator/health >/dev/null 2>&1 || curl -sf localhost:8080/api/projects >/dev/null; do sleep 2; done
```

- [ ] **Step 2: 생성 + 업로드 스크립트 작성·실행**

`scratchpad/verify-mep.sh`(GlobalId 의 `$` 때문에 bash 파일로):

```bash
#!/bin/bash
set -e
cd /Users/hubilon_map/orca/projects/bim-platform
SC=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/7e3e2202-5cd9-4fd6-bd1a-45021d9937b6/scratchpad
API=http://localhost:8080/api
docker compose cp samples/gen ifc-worker:/tmp/gen
docker compose exec ifc-worker sh -c 'cd /tmp/gen && python gen_mep.py mep-building.ifc | tee gen-default.txt && python gen_mep.py a0.ifc --annex 0 >/dev/null && python gen_mep.py a2.ifc --annex 2 >/dev/null && /usr/bin/time -p python gen_mep.py large.ifc --floors 20 --annex 2 --density high 2>&1 | tee gen-large.txt && ls -l *.ifc'
docker compose cp ifc-worker:/tmp/gen/mep-building.ifc samples/mep-building.ifc
docker compose cp ifc-worker:/tmp/gen/large.ifc "$SC/mep-large.ifc"
PID=$(curl -s $API/projects | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')
up() { curl -s -F "file=@$1" $API/projects/$PID/models | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'; }
wait_ready() { local t0=$(date +%s); while :; do s=$(curl -s $API/models/$1 | python3 -c 'import sys,json; print(json.load(sys.stdin)["status"])'); [ "$s" = READY ] && { echo "READY in $(( $(date +%s) - t0 ))s"; return; }; [ "$s" = FAILED ] && { echo FAILED; exit 1; }; sleep 2; done; }
MID=$(up samples/mep-building.ifc); echo $MID > "$SC/mep_mid.txt"; echo "default $MID"; wait_ready $MID
LID=$(up "$SC/mep-large.ifc"); echo $LID > "$SC/mep_large_mid.txt"; echo "large $LID"; wait_ready $LID
# DB 적재 기준 카운트 (gen 의 db: 줄과 비교)
for M in $MID $LID; do docker compose exec -T postgis psql -U bim -d bim -tAc "select (select count(*) from element where model_id='$M'), (select count(*) from system where model_id='$M'), (select count(*) from connection where model_id='$M')"; done
curl -s $API/models/$MID/spatial | python3 -c 'import sys,json; n=[r["name"] for r in json.load(sys.stdin) if r["ifcClass"]=="IfcBuildingStorey"]; print("storeys", n); assert "P1F" in n'
curl -s $API/models/$MID/monitor | python3 -c 'import sys,json; d=json.load(sys.stdin); b={(r["storey"],r["building"]) for r in d["rows"] if r["storey"] in ("1F","P1F")}; print(b); assert ("P1F","주차타워") in b and ("1F","업무동") in b'
```

Run: `bash "$SC/verify-mep.sh"` (SC 는 위 경로). Expected: 두 모델 READY, psql 카운트 3개가 각 `db:` 줄의 `elements/systems/connections` 와 일치, 층 목록에 `P1F`, 모니터 행에 동 이름.

- [ ] **Step 3: 계통 추적·정전·자산·시뮬레이터**

`scratchpad/verify-mep2.sh`:

```bash
#!/bin/bash
set -e
API=http://localhost:8080/api; SC=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/7e3e2202-5cd9-4fd6-bd1a-45021d9937b6/scratchpad
MID=$(cat $SC/mep_mid.txt)
gid() { curl -s "$API/models/$MID/elements" | python3 -c "import sys,json,urllib.parse; print(urllib.parse.quote(next(r['globalId'] for r in json.load(sys.stdin) if r['name']=='$1')))"; }
MDB=$(gid 'MDB 저압 배전반'); DET=$(gid 'P2F 열감지기 1')
curl -s "$API/models/$MID/elements/$MDB/route?dir=down" | python3 -c 'import sys,json; n=[x["name"] for x in json.load(sys.stdin)["nodes"]]; assert "LP-P1F 분전반" in n, n[:20]; print("MDB down →", len(n), "nodes, LP-P1F 포함")'
curl -s "$API/models/$MID/elements/$DET/route?dir=down" | python3 -c 'import sys,json; n=[x["name"] for x in json.load(sys.stdin)["nodes"]]; assert any(x.startswith("FACP") for x in n), n; print("P2F 감지기 down → FACP 도달")'
curl -s -X POST "$API/models/$MID/power?source=GENERATOR" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("unpowered", len(d["unpowered"]))'
curl -s "$API/models/$MID/power" > $SC/pw.json
curl -s "$API/models/$MID/elements" | python3 -c '
import sys,json; rows=json.load(sys.stdin); un=set(json.load(open(sys.argv[1]))["unpowered"])
lit=[r for r in rows if r["name"]=="P2F 조명 1"][0]["globalId"]; em=[r for r in rows if r["name"]=="P2F 비상조명 1"][0]["globalId"]
assert lit in un and em not in un, ("일반 조명 무전원·비상조명 유지 실패", lit in un, em in un); print("정전: 부속동 일반 조명 무전원, 비상조명 유지")' $SC/pw.json
curl -s -X POST "$API/models/$MID/power?source=UTILITY" | python3 -c 'import sys,json; assert json.load(sys.stdin)["unpowered"]==[]; print("복전 OK")'
curl -s -X POST "$API/models/$MID/assets/bulk" | python3 -c 'import sys,json; print("bulk", json.load(sys.stdin))'
python3 /Users/hubilon_map/orca/projects/bim-platform/samples/gen/bms_sim.py $MID --seed 1 --ticks 5 --interval 0.2
```

Run: `bash $SC/verify-mep2.sh`. Expected: 4개 `print` 전부 출력, bulk 등록 수, 시뮬레이터 5틱 로그. 이 스크립트는 정전을 걸었다가 복전하므로 끝에 반드시 `UTILITY` 가 찍혀야 한다.

- [ ] **Step 4: 화면 — 층 단면 링크·격자 열(헤드리스)**

`scratchpad/clip.mjs`(puppeteer-core, 기존 `scratchpad/readme-shots.mjs` 의 launch 옵션 재사용 — 없으면 `NODE_EXTRA_CA_CERTS=/tmp/claude-ca.pem npm i --no-save puppeteer-core` 를 web 에서):

```js
import puppeteer from 'puppeteer-core'
import { readFileSync } from 'node:fs'
const SC = '/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/7e3e2202-5cd9-4fd6-bd1a-45021d9937b6/scratchpad'
const mid = readFileSync(`${SC}/mep_mid.txt`, 'utf8').trim()
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--no-sandbox'] })
const p = await b.newPage(); await p.setViewport({ width: 1500, height: 950 })
await p.goto(`http://localhost:5173/#/models/${mid}/monitor?mode=all`, { waitUntil: 'networkidle0' })
await p.waitForFunction(() => document.body.innerText.includes('P1F'))
const links = await p.$$eval('a[title="뷰어에서 이 층 단면"]', as => as.map(a => [a.closest('tr,div')?.innerText.split('\n')[0], a.getAttribute('href')]))
const of = n => links.find(l => l[0]?.startsWith(n))?.[1]
console.log('1F', of('1F'), '\nP1F', of('P1F'), '\nP3F', of('P3F'))
const zr = h => h.split('clip=')[1].split(',').slice(4).map(Number)
const [a, c, d] = [zr(of('1F')), zr(of('P1F')), zr(of('P3F'))]
if (!(a[0] === -0.3 && a[1] === 4.95 && c[0] === -0.3 && c[1] === 2.95 && d[1] === 9.45)) { console.error('FAIL', a, c, d); process.exit(1) }
await p.screenshot({ path: `${SC}/monitor-annex.png` }); console.log('PASS')
await b.close()
```

Run: `cd /Users/hubilon_map/orca/projects/bim-platform/web && node $SC/clip.mjs; cd /Users/hubilon_map/orca/projects/bim-platform`
Expected: `PASS`, 스크린샷에 층 × 분야 격자 열로 `P1F~P3F` 표시. 링크 셀렉터가 행 이름을 못 잡으면 `MonitorPage.tsx:167` 주변 마크업을 보고 `closest` 대상을 맞춘다(화면 코드는 바꾸지 않는다).

- [ ] **Step 5: 대형 모델 측정(② 3D Tiles 기준선)**

```bash
LID=$(cat $SC/mep_large_mid.txt)
docker compose exec -T postgis psql -U bim -d bim -tAc "select extract(epoch from (finished_at - started_at)) from conversion_job where model_id='$LID' order by id desc limit 1"   # 열 이름이 다르면 \d conversion_job 으로 확인
docker compose exec -T minio sh -c 'ls -l /data/bim/glb/' 2>/dev/null || curl -sI localhost:5173/files/bim/glb/$LID.glb | grep -i content-length
```
뷰어 초기 로드: `scratchpad/measure.mjs` 가 남아 있으면 `LID` 로 실행(병합 렌더 켜짐/꺼짐 각 1회), 없으면 `clip.mjs` 를 복제해 `#/models/${LID}` 로 가서 `performance.now()` 로 `.stats` 텍스트가 나타날 때까지 시간을 잰다. 기록 항목: 생성 시간(`gen-large.txt` 의 `real`), 변환 시간, IFC/GLB 크기, 뷰어 로드(켜짐/꺼짐), 측정 환경(Mac 모델·Chrome 헤드리스 swiftshader).

- [ ] **Step 6: 상태 정리**

`bms_sim` 이 남긴 경보는 데모용이라 두되, 전원은 `UTILITY` 인지 `curl -s $API/models/$MID/power` 로 확인. 구 mep 모델(있다면)은 `DELETE $API/models/{구 id}` 로 정리 — 삭제 전 `GET /models/{id}` 로 이름을 확인해 대상이 맞는지 본다.

---

### Task 8: 문서 갱신

**Files:**
- Modify: `samples/README.md` (`## mep-building.ifc (생성)` 절)
- Modify: `README.md:65` (가상 건물 절), `README.md:150` 근처 규모 측정 표
- Modify: `docs/screen-design.md:78`

**Interfaces:**
- Consumes: Task 7 실측(요소·연결·계통 수, 대형 측정표)

- [ ] **Step 1: `samples/README.md` 절 교체**

```markdown
## mep-building.ifc (생성)

`gen/gen_mep.py` 가 IfcOpenShell API 로 만든 가상 건물. 지리참조 없음, 상대좌표. 호스트 python 에 IfcOpenShell 이 없어 워커 컨테이너에서 실행한다(`gen/` 디렉터리째 복사 — `mep_plan.py` 를 import 한다).

```bash
docker compose cp samples/gen ifc-worker:/tmp/gen
docker compose exec ifc-worker sh -c 'cd /tmp/gen && python gen_mep.py mep-building.ifc'                                   # 기본: 지상 10층 + 주차타워, 격자 4 m
docker compose exec ifc-worker sh -c 'cd /tmp/gen && python gen_mep.py large.ifc --floors 20 --annex 2 --density high'    # 대형: 3D Tiles·규모 측정용
docker compose cp ifc-worker:/tmp/gen/mep-building.ifc samples/
```

| 인자 | 기본 | 의미 |
|---|---|---|
| `--floors N` | 10 | 지상 층수(3 이상). 지하 2층·옥탑은 고정 |
| `--annex K` | 1 | 0 없음 / 1 주차타워(P1F~P3F) / 2 +후생동(W1F~W2F) |
| `--density` | `mid` | `low` 고정 좌표 / `mid` 격자 4 m / `high` 격자 2.5 m + 콘센트 |

생성 끝에 두 줄을 찍는다 — `ifc:` 원시 IFC 개수(개구부 포함), `db:` 워커 적재 기준(개구부 제외 요소·IfcSystem 포함 계통·연결). 검증은 `db:` 줄과 DB 를 비교한다. 기본 인자 실측: 14계통 **N요소 M연결**(Task 7 값). 자기 검사(연결 없는 계통 요소·소속 없는 요소·이름 중복)는 AssertionError 로 멈춘다.

테스트: 호스트 `python3 -m unittest samples/gen/test_mep_plan.py`(배치 로직), 컨테이너 `docker compose exec ifc-worker sh -c 'cd /tmp/gen && python -m unittest test_gen_mep -v'`(생성·연결).

`gen/bms_sim.py <modelId>` — 상태 API 시뮬레이터. `--interval 3 --ticks 0` 기본(무한), `--seed` 로 재현.
```

(코드 블록 안 백틱은 실제 파일에선 그대로 fenced 로 쓴다.)

- [ ] **Step 2: `README.md` 가상 건물 절·규모 측정 표**

65행 문장을 실측으로: `36×16 m 업무동(지상 10층·지하 2층·옥탑)과 주차타워(3층)`, `14계통 N요소 M연결`, 끝에 한 문장 — `gen_mep.py --floors/--annex/--density 로 층수·부속동·말단 밀도를 바꿀 수 있고, 대형 인자(20층·후생동·격자 2.5 m)는 3D Tiles 기준선으로 쓴다.`

규모 측정 표(150행)에 행 추가:
```markdown
| 가상 건물 대형 (IFC4, --floors 20 --annex 2 --density high) | {IFC MB} | {요소} | {변환 s} | {GLB MB} | {로드 s, 병합 끔} | {draw calls → 병합} |
```
표 아래 한 줄: 생성 시간·측정 환경(Task 7 Step 5).

- [ ] **Step 3: `docs/screen-design.md:78`**

`층 단면 링크.` → `층 단면 링크(상한은 같은 동의 다음 층 표고 — 모니터 API 의 building 열 기준).`

- [ ] **Step 4: 링크·수치 점검 후 커밋**

Run: `grep -n "474\|404요소\|470연결" README.md samples/README.md docs/screen-design.md` → 옛 숫자가 남아 있으면 갱신.

```bash
git add samples/README.md README.md docs/screen-design.md
git commit -m "docs: 가상 건물 확장 — 생성 인자·실측 요소 수·대형 측정(3D Tiles 기준선)·층 단면 설명"
```

- [ ] **Step 5: 메모리 갱신**

`~/.claude/projects/-Users-hubilon-map-orca-projects-bim-platform/memory/bim-platform-status.md` 의 2026-09-07 항목에 ① 완료 사실·실측 숫자·모델 id 파일 경로를 한 문단 추가하고, `MEMORY.md` 의 상태 줄을 갱신한다.

---

## Self-Review

**Spec coverage** — 설계 §1 인자(T2 Step 3, 오류 종료 T2 테스트) · §2 층 표고/층고·RF/RF_TOP(T1 floor_spec, T2 Step 3~6) · §3 PLAN·fit_zone·격자·제외 영역·감지기 인덱스 0·콘센트·스위치 제외·low 고정 좌표·det_status 키·에스컬레이터 컨테이너(T1, T2 Step 8) · §4 주차타워(T3)·후생동 자체 공급원·축소 말단·동 간 계통 9종(T3·T4 — 전기·비상·급수·소방·화재감지·배수·통신·주차관제·가스) · §5 코드 구조·자기 검사 3종·카운트 2줄(T2 Step 9) · §6 IFC 미커밋·samples/README·4조합 생성·업로드 확인·추적·정전·bulk·bms_sim·대형 측정·README(T7·T8) · §7 building 열·storeyClip(T5·T6). 검토 문서 1.1~1.7 은 각각 T6, T1(지하 3.5 고정), T2(스위치 없음 테스트), T4(ctx), T1(제외 영역 테스트), T7(dir=down), T2 Step 9(카운트 2줄·간접 소속)에 대응.

**Placeholder scan** — 없음. T7 Step 5 의 `conversion_job` 열 이름만 실행 시 `\d` 로 확인하도록 명시.

**Type consistency** — `fit_zone(sp, x, y, w, d, z, h, west, c, key, excl=())` 는 T2 정의·T2 루프·T4 호출이 같다. `ctx` 키 `lp lcp elp rpt fpb hc wsb hwsb wwb chwb hb ddc odu tx my` 는 T2 본동(전부)·T4 후생동(lcp·hwsb·chwb·hb·ddc 생략) 일치. `underground(name, cls, ptype, st_, p0, p1, r, sysname, up, style_)` 는 T3 정의·T3/T4 호출 인자 수 10개 일치(`st_` 미사용). `storeyClipZ` 반환 `[z, 상한]` 원값이고 −0.3/−0.05 는 MonitorPage 가 붙인다(T6 테스트·T7 clip.mjs 기대값 −0.3/4.95 정합). `Row.building` 은 T5 SQL 별칭 `building` 과 같다.
