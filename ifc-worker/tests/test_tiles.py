"""3D Tiles 분할기(worker/tiles.py) — 합성 GLB 로. 순수 파이썬이라 호스트에서도 돈다(ifcopenshell·DB 불필요)"""
import json
import struct
import unittest

from worker import tiles

ZUP_TO_YUP = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0]   # IfcOpenShell 노드 행렬: (x,y,z) → (x,z,-y)


def box_node(bin_: bytearray, g: dict, gid: str, lo, hi, material: int):
    """축 정렬 상자 하나(정점 8·삼각형 12)를 노드·메시·접근자 3개·버퍼뷰 3개로 추가 — IfcOpenShell 출력과 같은 모양"""
    verts = [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
    idx = [0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6, 0, 2, 4, 2, 6, 4, 1, 5, 3, 3, 5, 7]
    parts = [(struct.pack(f"<{len(idx)}I", *idx), 34963, None), (struct.pack("<24f", *[c for v in verts for c in v]), 34962, 12), (struct.pack("<24f", *([0.0, 0.0, 1.0] * 8)), 34962, 12)]
    views = []
    for data, target, stride in parts:
        bv = {"buffer": 0, "byteOffset": len(bin_), "byteLength": len(data), "target": target}
        if stride:
            bv["byteStride"] = stride
        views.append(len(g["bufferViews"])); g["bufferViews"].append(bv); bin_.extend(data)
    a0 = len(g["accessors"])
    g["accessors"] += [{"bufferView": views[0], "byteOffset": 0, "componentType": 5125, "count": len(idx), "type": "SCALAR", "min": [0], "max": [7]},
                       {"bufferView": views[1], "byteOffset": 0, "componentType": 5126, "count": 8, "type": "VEC3", "min": list(lo), "max": list(hi)},
                       {"bufferView": views[2], "byteOffset": 0, "componentType": 5126, "count": 8, "type": "VEC3", "min": [0, 0, 1], "max": [0, 0, 1]}]
    g["meshes"].append({"primitives": [{"attributes": {"POSITION": a0 + 1, "NORMAL": a0 + 2}, "indices": a0, "material": material, "mode": 4}]})
    g["nodes"].append({"name": gid, "mesh": len(g["meshes"]) - 1, "matrix": ZUP_TO_YUP})
    g["scenes"][0]["nodes"].append(len(g["nodes"]) - 1)


def synthetic(boxes):
    """boxes = [(gid, lo, hi, material)] → GLB. 재질 2개"""
    g = {"asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "accessors": [], "bufferViews": [],
         "materials": [{"name": "m0"}, {"name": "m1"}]}
    bin_ = bytearray()
    for gid, lo, hi, mat in boxes:
        box_node(bin_, g, gid, lo, hi, mat)
    g["buffers"] = [{"byteLength": len(bin_)}]
    return tiles.write_glb(g, bytes(bin_))


def chunks(glb: bytes):
    """(전체 길이, JSON 길이, BIN 길이, JSON) — 헤더·청크 구조 검사용"""
    magic, ver, length = struct.unpack_from("<4sII", glb, 0)
    assert magic == b"glTF" and ver == 2
    jl, jt = struct.unpack_from("<I4s", glb, 12)
    bl, bt = struct.unpack_from("<I4s", glb, 20 + jl)
    assert (jt, bt) == (b"JSON", b"BIN\0")
    return length, jl, bl, json.loads(glb[20:20 + jl])


A, B, C = "A" * 22, "B" * 22, "C" * 22
GLB = synthetic([(A, (0, 0, 0), (10, 5, 3), 0), (B, (0, 0, 3), (10, 5, 6), 1), (C, (20, 0, 0), (21, 1, 1), 0)])


class SplitTest(unittest.TestCase):
    def test_each_group_is_a_valid_minimal_glb(self):
        out = tiles.split_glb(GLB, {"ac": [A, C], "b": [B]})
        for key, n in (("ac", 2), ("b", 1)):
            glb = out[key]
            length, jl, bl, g = chunks(glb)
            self.assertEqual(length, len(glb))
            self.assertEqual((jl % 4, bl % 4), (0, 0))                       # 청크 4바이트 정렬
            self.assertEqual(len(g["nodes"]), n)
            self.assertEqual(len(g["accessors"]), 3 * n)                    # 인덱스·POSITION·NORMAL
            self.assertEqual(len(g["bufferViews"]), 3 * n)
            self.assertEqual(g["buffers"][0]["byteLength"], bl)
            self.assertTrue(all(bv["byteOffset"] % 4 == 0 and bv["byteOffset"] + bv["byteLength"] <= bl for bv in g["bufferViews"]))
            self.assertEqual(g["scenes"][0]["nodes"], list(range(n)))
        self.assertEqual([n["name"] for n in chunks(out["ac"])[3]["nodes"]], [A, C])   # GlobalId 이름·순서 보존
        self.assertEqual([m["name"] for m in chunks(out["ac"])[3]["materials"]], ["m0"])   # 쓰인 재질만
        self.assertEqual(chunks(out["b"])[3]["meshes"][0]["primitives"][0]["material"], 0)   # 재질 인덱스 재매핑(원본 1 → 0)

    def test_geometry_bytes_are_copied_intact(self):
        src, sbin = tiles.read_glb(GLB)
        g, bin_ = tiles.read_glb(tiles.split_glb(GLB, {"c": [C]})["c"])

        def pos(gl, b, node):
            bv = gl["bufferViews"][gl["accessors"][gl["meshes"][gl["nodes"][node]["mesh"]]["primitives"][0]["attributes"]["POSITION"]]["bufferView"]]
            return b[bv["byteOffset"]:bv["byteOffset"] + bv["byteLength"]]
        self.assertEqual(pos(g, bin_, 0), pos(src, sbin, 2))

    def test_unknown_gid_gives_empty_but_valid_glb(self):
        length, _, bl, g = chunks(tiles.split_glb(GLB, {"x": ["nope"]})["x"])
        self.assertEqual((g["nodes"], bl), ([], 0))


class BoundsTest(unittest.TestCase):
    def test_zup_positions_through_yup_matrix_come_back_zup(self):
        self.assertEqual(tiles.bounds(GLB), [0, 0, 0, 21, 5, 6])
        self.assertEqual(tiles.bounds(tiles.split_glb(GLB, {"b": [B]})["b"]), [0, 0, 3, 10, 5, 6])

    def test_translation_in_node_matrix_is_applied(self):
        g, b = tiles.read_glb(tiles.split_glb(GLB, {"a": [A]})["a"])
        g["nodes"][0]["matrix"] = ZUP_TO_YUP[:12] + [100.0, 7.0, -3.0, 1.0]   # Y-up 이동 (100, 7, -3) = Z-up (100, 3, 7)
        self.assertEqual(tiles.bounds(tiles.write_glb(g, b)), [100, 3, 7, 110, 8, 10])

    def test_empty(self):
        self.assertIsNone(tiles.bounds(tiles.split_glb(GLB, {"x": []})["x"]))


class TilesetTest(unittest.TestCase):
    SITE = [0, 0, 0, 30, 40, 0]   # 대각선 50

    def test_tree_refine_and_errors(self):
        ts = tiles.tileset(self.SITE, [{"gid": "BLD", "name": "업무동", "uri": "b0.glb", "box": [0, 0, 0, 10, 5, 6],
                                        "storeys": [{"gid": "S1", "name": "1F", "uri": "b0s0.glb", "box": [0, 0, 0, 10, 5, 3]}]}], "site.glb")
        self.assertEqual(ts["asset"]["version"], "1.1")
        r = ts["root"]
        self.assertEqual((r["refine"], r["geometricError"], r["content"]["uri"]), ("ADD", 5.0, "site.glb"))
        b = r["children"][0]
        self.assertEqual((b["refine"], b["geometricError"], b["content"]["uri"], b["extras"]["globalId"]), ("REPLACE", 2.5, "b0.glb", "BLD"))
        self.assertEqual(b["boundingVolume"]["box"], [5, 2.5, 3, 5, 0, 0, 0, 2.5, 0, 0, 0, 3])
        s = b["children"][0]
        self.assertEqual((s["geometricError"], s["content"]["uri"], s["extras"]["globalId"]), (0, "b0s0.glb", "S1"))
        self.assertNotIn("refine", s)

    def test_no_site_content_and_shell_less_building(self):
        ts = tiles.tileset(self.SITE, [{"gid": "B", "name": None, "uri": None, "box": self.SITE, "storeys": []}])
        self.assertNotIn("content", ts["root"])
        self.assertNotIn("content", ts["root"]["children"][0])


class BuildTest(unittest.TestCase):
    """A(슬래브, 1F) · B(펌프, 1F 안 공간 SP) · C(층 없음 → site.glb)"""
    SPATIAL = [("SITE", None, "IfcSite", "대지", None), ("BLD", "SITE", "IfcBuilding", "업무동", None),
               ("F2", "BLD", "IfcBuildingStorey", "2F", 4.0), ("F1", "BLD", "IfcBuildingStorey", "1F", 0.0),
               ("SP", "F1", "IfcSpace", "기계실", None)]
    ELEMS = [(A, "IfcSlab", "S", "F1", {}), (B, "IfcPump", "P", "SP", {}), (C, "IfcPump", "X", None, {})]

    def test_groups_files_and_tileset(self):
        out = tiles.build(GLB, self.SPATIAL, self.ELEMS)
        self.assertEqual(sorted(out), ["b0.glb", "b0s0.glb", "site.glb", "tileset.json"])   # 빈 층(2F)은 타일 없음
        names = lambda k: [n["name"] for n in tiles.read_glb(out[k])[0]["nodes"]]
        self.assertEqual(names("b0s0.glb"), [A, B])   # 공간 안 요소도 그 층으로
        self.assertEqual(names("b0.glb"), [A])        # 외피 = 건축 요소만
        self.assertEqual(names("site.glb"), [C])
        ts = json.loads(out["tileset.json"])
        b = ts["root"]["children"][0]
        self.assertEqual((b["extras"]["globalId"], [s["extras"]["globalId"] for s in b["children"]]), ("BLD", ["F1"]))
        self.assertEqual(b["boundingVolume"]["box"], [5, 2.5, 3, 5, 0, 0, 0, 2.5, 0, 0, 0, 3])   # 층 상자들의 합

    def test_no_geometry_no_tiles(self):
        self.assertEqual(tiles.build(tiles.split_glb(GLB, {"x": []})["x"], self.SPATIAL, self.ELEMS), {})


if __name__ == "__main__":
    unittest.main()
