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
        fault = next(e for e in f.by_type("IfcSensor") if e.Name == "3F-사무A 열감지기 4")
        self.assertEqual(ue.get_pset(fault, "Pset_BimStatus")["Status"], "FAULT")
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


if __name__ == "__main__":
    unittest.main()
