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
        spr = place("spr", 0, 0, 13, D, "mid", exclude=[st1])   # 사무A: 피치 4, 오프셋 2 → (10.8,10.8),(10.8,14.8) 은 ST1 안
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
