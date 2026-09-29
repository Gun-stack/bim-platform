"""GLB → 3D Tiles 1.1 (대지 → 동 외피 → 층). 순수 파이썬(json·struct) — 재테셀레이션·새 의존성 없음.

전제(IfcOpenShell 0.8.5 glTF 출력): 루트 노드 = 요소 1개(name = GlobalId, matrix = Z-up→Y-up), 자식 없음, 텍스처 없음, 버퍼 1개.
tileset.json 상자는 3D Tiles 규약대로 Z-up(= IFC 월드), 타일 GLB 는 원본 노드 행렬(Y-up) 그대로 — 런타임이 Y→Z 로 돌리는 표준 관례."""
import itertools
import json
import math
import re
import struct

# 뷰어 xray.ts tier() 의 수평(Slab|Roof|Covering)·수직과 같은 분류 — 외피 = 이 클래스들
ARCH = re.compile(r"^Ifc(Slab|Roof|Covering|Wall|CurtainWall|Window|Door|Column|Beam|Stair|Ramp|Railing|Plate|Member)")
IDENTITY = [1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0, 0, 0, 0, 0, 1.0]


def read_glb(glb: bytes) -> tuple[dict, bytes]:
    """GLB → (glTF JSON, BIN 청크 바이트)"""
    magic, version, length = struct.unpack_from("<4sII", glb, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError("not a glTF 2.0 binary")
    jlen, _ = struct.unpack_from("<I4s", glb, 12)
    gltf = json.loads(glb[20:20 + jlen])
    off, bin_ = 20 + jlen, b""
    if off < length:
        blen, _ = struct.unpack_from("<I4s", glb, off)
        bin_ = glb[off + 8:off + 8 + blen]
    return gltf, bin_


def write_glb(gltf: dict, bin_: bytes) -> bytes:
    """JSON 청크는 공백, BIN 청크는 0 으로 4바이트 정렬"""
    j = json.dumps(gltf, separators=(",", ":"), ensure_ascii=False).encode()
    j += b" " * (-len(j) % 4)
    b = bin_ + b"\0" * (-len(bin_) % 4)
    return (struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(j) + 8 + len(b))
            + struct.pack("<I4s", len(j), b"JSON") + j + struct.pack("<I4s", len(b), b"BIN\0") + b)


def split_glb(glb: bytes, groups: dict[str, list[str]]) -> dict[str, bytes]:
    """그룹 이름 → 노드 GlobalId 목록. 고른 노드의 메시 → 접근자 → 버퍼뷰만 새 BIN 에 4바이트 정렬로 복사하고 인덱스를 다시 매긴다. 재질은 쓰인 것만"""
    src, bin_ = read_glb(glb)
    by_name: dict[str, list[int]] = {}
    for i, n in enumerate(src.get("nodes", [])):
        by_name.setdefault(n.get("name"), []).append(i)
    out = {}
    for key, gids in groups.items():
        g = {"asset": src["asset"], "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [], "accessors": [], "bufferViews": [], "materials": []}
        blob = bytearray()
        remap: dict[str, dict[int, int]] = {k: {} for k in ("meshes", "accessors", "bufferViews", "materials")}

        def take(kind, i, copy):
            if i not in remap[kind]:
                remap[kind][i] = len(g[kind])
                g[kind].append(copy(i))
            return remap[kind][i]

        def view(i):
            bv = dict(src["bufferViews"][i])
            start = bv.get("byteOffset", 0)
            blob.extend(b"\0" * (-len(blob) % 4))
            bv["buffer"], bv["byteOffset"] = 0, len(blob)
            blob.extend(bin_[start:start + bv["byteLength"]])
            return bv

        def accessor(i):
            a = dict(src["accessors"][i])
            if "bufferView" in a:
                a["bufferView"] = take("bufferViews", a["bufferView"], view)
            return a

        def mesh(i):
            m = dict(src["meshes"][i])
            prims = []
            for p in m["primitives"]:
                p = dict(p)
                p["attributes"] = {k: take("accessors", v, accessor) for k, v in p["attributes"].items()}
                if "indices" in p:
                    p["indices"] = take("accessors", p["indices"], accessor)
                if "material" in p:
                    p["material"] = take("materials", p["material"], lambda j: src["materials"][j])
                prims.append(p)
            m["primitives"] = prims
            return m

        for gid in gids:
            for i in by_name.get(gid, ()):
                n = {k: v for k, v in src["nodes"][i].items() if k != "children"}   # ponytail: 자식 노드 없음 전제(IfcOpenShell 출력). 계층 GLB 면 여기서 재귀
                if "mesh" in n:
                    n["mesh"] = take("meshes", n["mesh"], mesh)
                g["scenes"][0]["nodes"].append(len(g["nodes"]))
                g["nodes"].append(n)
        blob.extend(b"\0" * (-len(blob) % 4))
        g["buffers"] = [{"byteLength": len(blob)}]
        if not g["materials"]:
            del g["materials"]
        out[key] = write_glb(g, bytes(blob))
    return out


def bounds(glb: bytes) -> list[float] | None:
    """[minx,miny,minz,maxx,maxy,maxz] IFC 월드(Z-up). POSITION min/max 상자 8모서리 × 노드 행렬(→ Y-up) 을 Z-up 으로 되돌린다: (x,y,z)_yup → (x,-z,y). 노드 없으면 None"""
    g, _ = read_glb(glb)
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for n in g.get("nodes", []):
        if "mesh" not in n:
            continue
        m = n.get("matrix", IDENTITY)   # ponytail: TRS 노드는 항등으로 본다 — IfcOpenShell 은 matrix 만 쓴다
        for p in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][p["attributes"]["POSITION"]]
            for c in itertools.product(*zip(a["min"], a["max"])):
                x, y, z = (sum(m[r + 4 * k] * v for k, v in enumerate((*c, 1.0))) for r in range(3))   # glTF 행렬은 열 우선
                for i, v in enumerate((x, -z, y)):
                    lo[i], hi[i] = min(lo[i], v), max(hi[i], v)
    return None if lo[0] == math.inf else lo + hi


def _box12(b: list[float]) -> list[float]:
    """[min3, max3] → 3D Tiles boundingVolume.box (중심 + 축 정렬 반축 3개)"""
    c = [(b[i] + b[i + 3]) / 2 for i in range(3)]
    h = [(b[i + 3] - b[i]) / 2 for i in range(3)]
    return c + [h[0], 0, 0, 0, h[1], 0, 0, 0, h[2]]


def _union(boxes):
    return [min(b[i] for b in boxes) for i in range(3)] + [max(b[i] for b in boxes) for i in range(3, 6)]


def tileset(site_box: list[float], buildings: list[dict], site: str | None = None) -> dict:
    """루트(대지, ADD: 루트 콘텐츠는 동·층 밖 잔여 요소라 자식이 대체하지 않는다) → 동(외피, REPLACE) → 층(잎).
    buildings = [{gid, name, uri|None, box, storeys: [{gid, name, uri, box}]}], box = [min3, max3] Z-up.
    geometricError: 루트 = 대지 대각선/10, 동 = 대지 대각선/20, 층 = 0. 동을 '대지' 대각선으로 잡는 이유: 홈 뷰에서 뒤쪽 작은 부속동까지 층으로 정제
    (SSE 16px·FOV 60° 에서 거리 < 2.57×대지 대각선 @950px, 1.9× @700px. 홈 뷰 = 1.1×, 가장 먼 동 상자까지 ≈ 1.33×)"""
    d = math.dist(site_box[:3], site_box[3:])
    root = {"boundingVolume": {"box": _box12(site_box)}, "geometricError": d / 10, "refine": "ADD", "children": []}
    if site:
        root["content"] = {"uri": site}
    for b in buildings:
        t = {"boundingVolume": {"box": _box12(b["box"])}, "geometricError": d / 20, "refine": "REPLACE",
             "extras": {"globalId": b["gid"], "name": b["name"]},
             "children": [{"boundingVolume": {"box": _box12(s["box"])}, "geometricError": 0, "content": {"uri": s["uri"]},
                           "extras": {"globalId": s["gid"], "name": s["name"]}} for s in b["storeys"]]}
        if b.get("uri"):
            t["content"] = {"uri": b["uri"]}
        root["children"].append(t)
    return {"asset": {"version": "1.1"}, "geometricError": d / 10, "root": root}


def build(glb: bytes, spatial, elems) -> dict[str, bytes]:
    """변환 결과 → {파일명: 바이트}: tileset.json · site.glb(동·층 밖) · b{i}.glb(동 외피) · b{i}s{j}.glb(층, 고도 순). 빈 그룹은 만들지 않는다.
    spatial = [(gid, parent_gid, class, name, elev)], elems = [(gid, class, name, container_gid, psets)] — extract.py 와 같은 모양(DB 에서 만든 행도 됨)"""
    site_box = bounds(glb)
    if site_box is None:
        return {}
    parent = {r[0]: r[1] for r in spatial}
    cls = {r[0]: r[2] for r in spatial}
    name = {r[0]: r[3] for r in spatial}

    def up(g, want):   # g(자기 포함)에서 부모로 올라가며 want 클래스인 첫 공간 요소
        while g is not None and cls.get(g) != want:
            g = parent.get(g)
        return g

    where = {r[0]: r[3] for r in elems}                              # 요소 → 담는 공간
    where.update({r[0]: r[0] for r in spatial if r[2] == "IfcSpace"})   # 공간 형상 → 자기 자신(부모가 층)
    arch = {r[0] for r in elems if ARCH.match(r[1] or "")}
    storeys = sorted((r for r in spatial if r[2] == "IfcBuildingStorey"), key=lambda r: (r[4] is None, r[4] or 0))
    levels: dict[str, list[str]] = {r[0]: [] for r in storeys}
    shells: dict[str, list[str]] = {r[0]: [] for r in spatial if r[2] == "IfcBuilding"}
    rest: list[str] = []
    gltf, _ = read_glb(glb)
    for n in gltf.get("nodes", []):
        gid = n.get("name")
        s = up(where.get(gid), "IfcBuildingStorey")
        b = up(s, "IfcBuilding")
        if s is None or b is None:
            rest.append(gid)   # 개구부·대지 요소·층 없이 동에 바로 담긴 요소
            continue
        levels[s].append(gid)
        if gid in arch:
            shells[b].append(gid)
    groups, tree = {}, []
    if rest:
        groups["site.glb"] = rest
    for i, b in enumerate(shells):
        mine = [r for r in storeys if up(r[0], "IfcBuilding") == b and levels[r[0]]]
        if not mine:
            continue
        if shells[b]:
            groups[f"b{i}.glb"] = shells[b]
        for j, r in enumerate(mine):
            groups[f"b{i}s{j}.glb"] = levels[r[0]]
        tree.append((i, b, mine))
    out = split_glb(glb, groups)
    box = {k: bounds(v) for k, v in out.items()}
    buildings = []
    for i, b, mine in tree:
        st = [{"gid": r[0], "name": r[3], "uri": f"b{i}s{j}.glb", "box": box[f"b{i}s{j}.glb"]} for j, r in enumerate(mine)]
        buildings.append({"gid": b, "name": name.get(b), "uri": f"b{i}.glb" if f"b{i}.glb" in out else None, "box": _union([s["box"] for s in st]), "storeys": st})
    out["tileset.json"] = json.dumps(tileset(site_box, buildings, "site.glb" if "site.glb" in out else None), ensure_ascii=False).encode()
    return out
