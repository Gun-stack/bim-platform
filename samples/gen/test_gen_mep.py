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
