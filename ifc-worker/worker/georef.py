"""IFC 지리참조 → EPSG:4326 풋프린트. 실행: python -m worker.georef in.ifc
우선순위: IfcMapConversion(IFC4+) > IfcSite.RefLatitude/RefLongitude > 없음(None).
"""
import math
import sys

import ifcopenshell
import ifcopenshell.util.unit as uu
from pyproj import CRS, Transformer

WGS84 = CRS.from_epsg(4326)


def dms(t):
    """IFC 각도 튜플 (도, 분, 초[, 백만분의 초]) → 십진 도. 부호는 첫 항 기준"""
    if not t:
        return None
    d, m, s = t[0], t[1], t[2]
    us = t[3] if len(t) > 3 else 0
    sign = -1 if d < 0 or m < 0 or s < 0 or us < 0 else 1
    return sign * (abs(d) + abs(m) / 60 + (abs(s) + abs(us) / 1e6) / 3600)


def read(f):
    """지리참조 원본값. 없으면 None. 단위는 미터로 정규화."""
    scale = uu.calculate_unit_scale(f)  # 프로젝트 길이단위 → m
    if f.schema != "IFC2X3":
        for mc in f.by_type("IfcMapConversion"):
            crs = mc.TargetCRS
            return {"source": "IfcMapConversion", "crs": crs.Name, "eastings": mc.Eastings * scale, "northings": mc.Northings * scale,
                    "height": (mc.OrthogonalHeight or 0) * scale, "x_abscissa": mc.XAxisAbscissa or 1.0, "x_ordinate": mc.XAxisOrdinate or 0.0,
                    "scale": mc.Scale or 1.0}
    for site in f.by_type("IfcSite"):
        lat, lon = dms(site.RefLatitude), dms(site.RefLongitude)
        if lat is not None and lon is not None:
            return {"source": "IfcSite", "lat": lat, "lon": lon, "elevation": site.RefElevation}
    return None


def to_wgs84(g, xy):
    """모델 로컬 XY(m, Z-up) 점들 → [(lon, lat)]"""
    if g["source"] == "IfcMapConversion":
        a, b, s = g["x_abscissa"], g["x_ordinate"], g["scale"]
        n = math.hypot(a, b) or 1.0
        a, b = a / n, b / n
        tr = Transformer.from_crs(CRS.from_user_input(g["crs"]), WGS84, always_xy=True)
        pts = [(g["eastings"] + s * (a * x - b * y), g["northings"] + s * (b * x + a * y)) for x, y in xy]
        return [tr.transform(e, nn) for e, nn in pts]
    # Site 위경도만: 원점 = 위경도, 로컬 x=동, y=북 (m) 로 가정. 회전 정보 없음 (LoGeoRef 20 수준)
    lat0, lon0 = g["lat"], g["lon"]
    m_per_deg_lat = 111_320.0
    m_per_deg_lon = 111_320.0 * math.cos(math.radians(lat0))
    return [(lon0 + x / m_per_deg_lon, lat0 + y / m_per_deg_lat) for x, y in xy]


def footprint_wkt(g, bbox):
    """bbox = (minx, miny, maxx, maxy) 로컬 m → WKT POLYGON (lon lat). 지리참조 없으면 None"""
    if not g or not bbox:
        return None
    x0, y0, x1, y1 = bbox
    ring = to_wgs84(g, [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)])
    return "POLYGON((" + ", ".join(f"{lon:.7f} {lat:.7f}" for lon, lat in ring) + "))"


if __name__ == "__main__":
    f = ifcopenshell.open(sys.argv[1])
    g = read(f)
    print("georef:", g)
    if g:
        c = to_wgs84(g, [(0, 0)])[0]
        print(f"origin → lon {c[0]:.6f}, lat {c[1]:.6f}")
        assert -180 <= c[0] <= 180 and -90 <= c[1] <= 90
        print("footprint(10x10 box):", footprint_wkt(g, (0, 0, 10, 10))[:80], "…")
