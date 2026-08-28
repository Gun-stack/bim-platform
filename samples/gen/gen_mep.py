"""가상 건물 + 공용부 설비 계통(MEP) IFC4 생성. 실행: python gen_mep.py out.ifc
건물: 24 x 12 m, 지하1층(변전실·펌프실·수조) + 지상 3층. 층마다 A/B 구역(IfcSpace), 코어에 EPS(전기)·PS(배관) 샤프트.
계통(IfcDistributionSystem) 4개와 흐름 방향 연결(IfcRelConnectsElements: relating=상류, related=하류):
  전기  변압기 TR → 메인분전반 MDB → 입상 트레이 → 층 분전반 LP-nF → 구역 분전반 LP-nF-A/B → 조명
  급수  저수조 WT → 급수펌프 WP → 입상관 → 층 분기관 → 구역 밸브 → 위생기구
  배수  위생기구 → 배수관 → 입상관 → 집수정 SP (지하)
  소방  소화수조 FT → 소화펌프 FP → 입상관 → 층 알람밸브 AV → 구역 스프링클러
좌표는 건물 남서 모서리 원점의 상대좌표(m). 지리참조 없음 (지도에는 수동 배치).
"""
import sys
import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.api.root, ifcopenshell.api.unit, ifcopenshell.api.context, ifcopenshell.api.project
import ifcopenshell.api.geometry, ifcopenshell.api.spatial, ifcopenshell.api.aggregate, ifcopenshell.api.system, ifcopenshell.api.pset, ifcopenshell.api.style, ifcopenshell.api.material
from ifcopenshell.util.shape_builder import ShapeBuilder, V

W, D, H = 24.0, 12.0, 3.5          # 건물 폭·깊이·층고
FLOORS = [("B1", -3.5), ("1F", 0.0), ("2F", 3.5), ("3F", 7.0)]
EPS = (11.0, 5.0, 1.2, 2.0)         # 전기 샤프트 x,y,w,d (코어)
PS = (12.4, 5.0, 1.2, 2.0)          # 배관 샤프트

f = api.project.create_file(version="IFC4")
proj = api.root.create_entity(f, ifc_class="IfcProject", name="가상 업무동 — 공용부 설비 계통 예시")
api.unit.assign_unit(f, length={"is_metric": True, "raw": "METERS"})  # 기본은 mm — 미터로
ctx = api.context.add_context(f, context_type="Model")
body = api.context.add_context(f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
sb = ShapeBuilder(f)

site = api.root.create_entity(f, ifc_class="IfcSite", name="대지")
bld = api.root.create_entity(f, ifc_class="IfcBuilding", name="업무동")
api.aggregate.assign_object(f, relating_object=proj, products=[site])
api.aggregate.assign_object(f, relating_object=site, products=[bld])

styles = {}
def style(name, rgb, alpha=1.0):
    if name not in styles:
        s = api.style.add_style(f, name=name)
        api.style.add_surface_style(f, style=s, ifc_class="IfcSurfaceStyleShading",
                                    attributes={"SurfaceColour": {"Name": None, "Red": rgb[0], "Green": rgb[1], "Blue": rgb[2]}, "Transparency": 1 - alpha})
        styles[name] = s
    return styles[name]

def rep(items, st=None):
    r = sb.get_representation(context=body, items=items)
    if st:
        api.style.assign_representation_styles(f, shape_representation=r, styles=[st])
    return r

def box(x, y, z, w, d, h):
    return sb.extrude(sb.rectangle(size=V(w, d), position=V(x, y)), magnitude=h, position=V(0, 0, z))

def pipe(points, r=0.05):
    return sb.create_swept_disk_solid(sb.polyline([V(*p) for p in points]), r)

count = {}
def make(cls, name, items, container, st=None, psets=None, ptype=None):
    el = api.root.create_entity(f, ifc_class=cls, name=name, predefined_type=ptype)
    api.geometry.assign_representation(f, product=el, representation=rep(items, st))
    api.geometry.edit_object_placement(f, product=el)
    api.spatial.assign_container(f, relating_structure=container, products=[el])
    for pn, props in (psets or {}).items():
        api.pset.edit_pset(f, pset=api.pset.add_pset(f, product=el, name=pn), properties=props)
    return el

systems = {}
def system(name, ptype):
    s = api.system.add_system(f, ifc_class="IfcDistributionSystem")
    s.Name, s.PredefinedType = name, ptype
    systems[name] = s
    return s
S_EL, S_WS, S_WW, S_FP = system("전기", "ELECTRICAL"), system("급수", "DOMESTICCOLDWATER"), system("배수", "WASTEWATER"), system("소방", "FIREPROTECTION")
S_EM, S_FA = system("비상전원", "ELECTRICAL"), system("화재감지", "SIGNAL")

def link(up, down, sysname):
    """상류 → 하류 흐름 연결 + 양쪽 계통 소속"""
    api.geometry.connect_element(f, relating_element=up, related_element=down, description="FLOW")
    for el in (up, down):
        api.system.assign_system(f, products=[el], system=systems[sysname])

# ---------- 스타일 ----------
ST = {"slab": style("slab", (0.75, 0.75, 0.75)), "wall": style("wall", (0.85, 0.85, 0.82), 0.35), "space": style("space", (0.6, 0.75, 1.0), 0.15),
      "el": style("electrical", (0.95, 0.65, 0.1)), "tray": style("tray", (0.8, 0.5, 0.1)), "light": style("light", (1.0, 0.95, 0.6)),
      "ws": style("water", (0.2, 0.5, 0.95)), "ww": style("waste", (0.45, 0.35, 0.25)), "fp": style("fire", (0.9, 0.2, 0.2)), "tank": style("tank", (0.3, 0.6, 0.8), 0.6),
      "shaft": style("shaft", (0.5, 0.5, 0.5), 0.3), "em": style("emergency", (0.85, 0.3, 0.05)), "fa": style("firealarm", (0.6, 0.2, 0.7)), "gen": style("generator", (0.4, 0.4, 0.45))}

# ---------- 구조: 층·슬래브·외벽·샤프트·구역 ----------
storeys, spaces = {}, {}
for name, z in FLOORS:
    st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name=name); st.Elevation = z
    api.aggregate.assign_object(f, relating_object=bld, products=[st]); storeys[name] = st
    make("IfcSlab", f"{name} 바닥", [box(0, 0, z - 0.2, W, D, 0.2)], st, ST["slab"], ptype="FLOOR")
    for (x, y, w, d) in [(0, 0, W, 0.2), (0, D - 0.2, W, 0.2), (0, 0, 0.2, D), (W - 0.2, 0, 0.2, D)]:
        make("IfcWall", f"{name} 외벽", [box(x, y, z, w, d, H)], st, ST["wall"])
    for label, (x, y, w, d) in (("EPS", EPS), ("PS", PS)):
        make("IfcWall", f"{name} {label} 샤프트", [box(x, y, z, w, 0.1, H), box(x, y + d, z, w, 0.1, H), box(x, y, z, 0.1, d, H), box(x + w, y, z, 0.1, d, H)], st, ST["shaft"])
    zones = [("변전실", 0, 0, 6, 8), ("방재실", 0, 8, 6, D - 8), ("펌프실", 6, 0, 5, D), ("수조실", 13.6, 0, W - 13.6, D)] if name == "B1" else [("A", 0, 0, 11, D), ("B", 13.6, 0, W - 13.6, D)]
    for zname, x, y, w, d in zones:
        sp = api.root.create_entity(f, ifc_class="IfcSpace", name=f"{name}-{zname}")
        api.geometry.assign_representation(f, product=sp, representation=rep([box(x + 0.2, y + 0.2, z, w - 0.4, d - 0.4, H - 0.3)], ST["space"]))
        api.geometry.edit_object_placement(f, product=sp)
        api.aggregate.assign_object(f, relating_object=st, products=[sp])
        spaces[f"{name}-{zname}"] = sp
make("IfcSlab", "옥상 바닥", [box(0, 0, 10.5 - 0.2, W, D, 0.2)], storeys["3F"], ST["slab"], ptype="ROOF")

# ---------- 지하 원천 설비 ----------
b1 = storeys["B1"]; zb = FLOORS[0][1]
TR = make("IfcTransformer", "TR-1 변압기 22.9kV/380V", [box(1, 4, zb, 2, 3, 2.2)], spaces["B1-변전실"], ST["el"], {"Pset_TransformerTypeCommon": {"PrimaryVoltage": 22900.0, "SecondaryVoltage": 380.0}}, "VOLTAGE")
MDB = make("IfcElectricDistributionBoard", "MDB 메인분전반", [box(4, 4.5, zb, 0.8, 2, 2.0)], spaces["B1-변전실"], ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 1600.0}}, "SWITCHBOARD")
link(TR, MDB, "전기")
WT = make("IfcTank", "WT-1 저수조 30t", [box(14, 1, zb, 4, 4, 2.5)], spaces["B1-수조실"], ST["tank"], {"Pset_TankTypeCommon": {"NominalCapacity": 30.0}}, "STORAGE")
WP = make("IfcPump", "WP-1 급수펌프", [box(7, 1.5, zb, 1, 1, 1.2)], spaces["B1-펌프실"], ST["ws"], {"Pset_PumpTypeCommon": {"NominalCapacity": 0.0083}}, "ENDSUCTION")
link(WT, WP, "급수")
FT = make("IfcTank", "FT-1 소화수조 40t", [box(19, 1, zb, 4, 4, 2.5)], spaces["B1-수조실"], ST["tank"], {"Pset_TankTypeCommon": {"NominalCapacity": 40.0}}, "STORAGE")
FP = make("IfcPump", "FP-1 소화펌프", [box(9, 1.5, zb, 1, 1, 1.4)], spaces["B1-펌프실"], ST["fp"], None, "ENDSUCTION")
link(FT, FP, "소방")
# ---------- 비상전원: 발전기 → ATS → 비상분전반 ----------
GEN = make("IfcElectricGenerator", "EG-1 비상발전기 500kW", [box(1, 0.5, zb, 3, 1.6, 1.8), box(1.2, 2.3, zb, 1.0, 1.0, 1.0)], spaces["B1-변전실"], ST["gen"],
           {"Pset_ElectricGeneratorTypeCommon": {"MaximumPowerOutput": 500000.0}, "Pset_BimStatus": {"Status": "STANDBY", "FuelLevel": 82.0, "LastTest": "2026-08-01"}}, "CHP")
ATS = make("IfcSwitchingDevice", "ATS-1 자동절체개폐기", [box(4, 2.2, zb, 0.6, 0.8, 1.6)], spaces["B1-변전실"], ST["em"], {"Pset_BimStatus": {"Status": "NORMAL", "Source": "UTILITY"}}, "TRANSFERSWITCH")
EMDB = make("IfcElectricDistributionBoard", "EMDB 비상분전반", [box(4, 7.0, zb, 0.8, 0.8, 2.0)], spaces["B1-변전실"], ST["em"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 400.0}}, "SWITCHBOARD")
link(GEN, ATS, "비상전원"); link(MDB, ATS, "비상전원"); link(ATS, EMDB, "비상전원")
# ---------- 화재감지: 수신기(방재실) ----------
FACP = make("IfcUnitaryControlElement", "FACP 화재수신기 (P형)", [box(1, 9.5, zb + 0.8, 0.7, 0.3, 1.0)], spaces["B1-방재실"], ST["fa"], {"Pset_BimStatus": {"Status": "NORMAL", "ActiveAlarms": 1, "Faults": 1}}, "ALARMPANEL")
link(EMDB, FACP, "비상전원"); link(EMDB, FP, "비상전원")   # 소화펌프는 비상전원
SP = make("IfcTank", "SP-1 집수정", [box(7, 8, zb - 0.2, 2, 2, 1.0)], spaces["B1-펌프실"], ST["ww"], None, "BASIN")

# 지하 수평 배관: 수조 → 펌프 → 샤프트, 펌프실 → 샤프트
ex, ey = EPS[0] + EPS[2] / 2, EPS[1] + EPS[3] / 2   # EPS 중심
px, py = PS[0] + PS[2] / 2, PS[1] + PS[3] / 2       # PS 중심
p = make("IfcPipeSegment", "급수 흡입관", [pipe([(16, 2, zb + 0.5), (8, 2, zb + 0.5)], 0.06)], b1, ST["ws"], {"Pset_PipeSegmentTypeCommon": {"NominalDiameter": 100.0}}, "RIGIDSEGMENT"); link(WT, p, "급수"); link(p, WP, "급수")
p = make("IfcPipeSegment", "급수 토출관", [pipe([(7.5, 2.5, zb + 1.2), (7.5, 2.5, zb + 3.0), (px - 0.3, py, zb + 3.0)], 0.05)], b1, ST["ws"], None, "RIGIDSEGMENT"); link(WP, p, "급수"); WS_B1 = p
p = make("IfcPipeSegment", "소화 흡입관", [pipe([(21, 2, zb + 0.5), (10, 2, zb + 0.5)], 0.075)], b1, ST["fp"], None, "RIGIDSEGMENT"); link(FT, p, "소방"); link(p, FP, "소방")
p = make("IfcPipeSegment", "소화 토출관", [pipe([(9.5, 2.5, zb + 1.4), (9.5, 2.5, zb + 3.1), (px + 0.3, py, zb + 3.1)], 0.065)], b1, ST["fp"], None, "RIGIDSEGMENT"); link(FP, p, "소방"); FP_B1 = p
t = make("IfcCableCarrierSegment", "B1 케이블트레이", [box(4.8, 5.3, zb + 2.8, ex - 4.8, 0.3, 0.1)], b1, ST["tray"], None, "CABLETRAYSEGMENT"); link(MDB, t, "전기"); EL_B1 = t
p = make("IfcPipeSegment", "배수 집수관", [pipe([(px, py - 0.3, zb + 0.3), (8, 9, zb + 0.3)], 0.075)], b1, ST["ww"], None, "RIGIDSEGMENT"); link(p, SP, "배수"); WW_B1 = p

# ---------- 입상 (B1 → 3F) ----------
top = FLOORS[-1][1] + H
riser_el = make("IfcCableCarrierSegment", "EPS 입상 트레이", [box(ex - 0.15, ey - 0.15, zb + 2.8, 0.3, 0.3, top - zb - 2.8)], b1, ST["tray"], None, "CABLELADDERSEGMENT"); link(EL_B1, riser_el, "전기")
riser_em = make("IfcCableCarrierSegment", "EPS 비상 입상 트레이", [box(ex - 0.5, ey - 0.15, zb + 2.8, 0.25, 0.3, top - zb - 2.8)], b1, ST["em"], None, "CABLELADDERSEGMENT")
t = make("IfcCableCarrierSegment", "B1 비상 트레이", [box(4.8, 7.3, zb + 2.8, ex - 0.5 - 4.8, 0.25, 0.1)], b1, ST["em"], None, "CABLETRAYSEGMENT"); link(EMDB, t, "비상전원"); link(t, riser_em, "비상전원")
riser_fa = make("IfcCableSegment", "화재감지 간선 (입상)", [pipe([(1.35, 9.65, zb + 1.8), (1.35, 9.65, zb + 3.0), (ex + 0.4, ey + 0.6, zb + 3.0), (ex + 0.4, ey + 0.6, top)], 0.02)], b1, ST["fa"], None, "CABLESEGMENT"); link(riser_fa, FACP, "화재감지")
riser_ws = make("IfcPipeSegment", "급수 입상관", [pipe([(px - 0.3, py, zb + 3.0), (px - 0.3, py, top)], 0.05)], b1, ST["ws"], None, "RIGIDSEGMENT"); link(WS_B1, riser_ws, "급수")
riser_fp = make("IfcPipeSegment", "소화 입상관", [pipe([(px + 0.3, py, zb + 3.1), (px + 0.3, py, top)], 0.065)], b1, ST["fp"], None, "RIGIDSEGMENT"); link(FP_B1, riser_fp, "소방")
riser_ww = make("IfcPipeSegment", "배수 입상관", [pipe([(px, py - 0.3, top), (px, py - 0.3, zb + 0.3)], 0.075)], b1, ST["ww"], None, "RIGIDSEGMENT"); link(riser_ww, WW_B1, "배수")

# ---------- 층별 ----------
for name, z in FLOORS[1:]:
    st = storeys[name]
    LP = make("IfcElectricDistributionBoard", f"LP-{name} 층 분전반", [box(EPS[0] + 0.2, EPS[1] + 0.3, z + 0.8, 0.6, 0.25, 1.0)], st, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 250.0}}, "DISTRIBUTIONBOARD")
    link(riser_el, LP, "전기")
    ELP = make("IfcElectricDistributionBoard", f"ELP-{name} 층 비상분전반", [box(EPS[0] + 0.2, EPS[1] + 1.2, z + 0.8, 0.4, 0.25, 0.6)], st, ST["em"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 220.0, "RatedCurrent": 63.0}}, "DISTRIBUTIONBOARD")
    link(riser_em, ELP, "비상전원")
    RPT = make("IfcUnitaryControlElement", f"RPT-{name} 층 중계기", [box(EPS[0] + 0.7, EPS[1] + 1.2, z + 1.6, 0.3, 0.15, 0.3)], st, ST["fa"], {"Pset_BimStatus": {"Status": "NORMAL"}}, "ALARMPANEL")
    link(RPT, riser_fa, "화재감지")
    AV = make("IfcValve", f"AV-{name} 알람밸브", [box(px + 0.15, py + 0.5, z + 1.0, 0.3, 0.3, 0.3)], st, ST["fp"], None, "ISOLATION")
    link(riser_fp, AV, "소방")
    WSB = make("IfcPipeSegment", f"{name} 급수 분기관", [pipe([(px - 0.3, py, z + 3.0), (px - 0.3, 3.0, z + 3.0), (2, 3.0, z + 3.0)], 0.04), pipe([(px - 0.3, 3.0, z + 3.0), (W - 2, 3.0, z + 3.0)], 0.04)], st, ST["ws"], None, "RIGIDSEGMENT")
    link(riser_ws, WSB, "급수")
    WWB = make("IfcPipeSegment", f"{name} 배수 횡주관", [pipe([(2, 9.0, z + 0.15), (px, 9.0, z + 0.15), (px, py - 0.3, z + 0.15)], 0.05), pipe([(W - 2, 9.0, z + 0.15), (px, 9.0, z + 0.15)], 0.05)], st, ST["ww"], None, "RIGIDSEGMENT")
    link(WWB, riser_ww, "배수")
    FPB = make("IfcPipeSegment", f"{name} 스프링클러 주관", [pipe([(px + 0.3, py + 0.5, z + 3.2), (2, py + 0.5, z + 3.2)], 0.04), pipe([(px + 0.3, py + 0.5, z + 3.2), (W - 2, py + 0.5, z + 3.2)], 0.04)], st, ST["fp"], None, "RIGIDSEGMENT")
    link(AV, FPB, "소방")
    for zname, x0, x1 in (("A", 0.0, 11.0), ("B", 13.6, W)):
        sp = spaces[f"{name}-{zname}"]
        # 전기: 트레이 → 구역 분전반 → 조명 4개
        tx0, tx1 = (ex - 0.15, x0 + 1.0) if zname == "A" else (ex + 0.15, x1 - 1.0)
        tray = make("IfcCableCarrierSegment", f"{name}-{zname} 트레이", [box(min(tx0, tx1), ey - 0.1, z + 3.05, abs(tx1 - tx0), 0.2, 0.1)], sp, ST["tray"], None, "CABLETRAYSEGMENT")
        link(LP, tray, "전기")
        ZP = make("IfcElectricDistributionBoard", f"LP-{name}-{zname} 구역 분전반", [box(x0 + 0.3 if zname == "A" else x1 - 0.55, ey - 0.3, z + 1.2, 0.25, 0.6, 0.8)], sp, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 220.0, "RatedCurrent": 100.0}}, "DISTRIBUTIONBOARD")
        link(tray, ZP, "전기")
        for i, (lx, ly) in enumerate([(x0 + 3, 3), (x0 + 3, 9), (x0 + 7, 3), (x0 + 7, 9)] if zname == "A" else [(x0 + 2.5, 3), (x0 + 2.5, 9), (x0 + 7, 3), (x0 + 7, 9)]):
            L = make("IfcLightFixture", f"{name}-{zname} 조명 {i + 1}", [box(lx - 0.6, ly - 0.15, z + H - 0.35, 1.2, 0.3, 0.08)], sp, ST["light"], None, "POINTSOURCE")
            link(ZP, L, "전기")
        # 비상전원: 층 비상분전반 → 비상조명(피난유도등) 2개
        for i, (lx, ly) in enumerate([(x0 + 1.0, 6.0), (x1 - 1.0, 6.0)] if zname == "A" else [(x0 + 1.0, 6.0), (x1 - 1.0, 6.0)]):
            EL = make("IfcLightFixture", f"{name}-{zname} 비상조명 {i + 1}", [box(lx - 0.15, ly - 0.15, z + 2.4, 0.3, 0.3, 0.15)], sp, ST["em"], {"Pset_BimStatus": {"Status": "NORMAL", "BatteryLevel": 100.0}}, "EMERGENCY")
            link(ELP, EL, "비상전원")
        # 화재감지: 중계기 ← 연기감지기 3 + 열감지기 1 (신호는 감지기 → 중계기 → 수신기 방향 = 상류가 수신기)
        det_status = {("2F", "B", 0): ("ALARM", "2026-08-28T13:42"), ("3F", "A", 3): ("FAULT", None)}
        for i, (dx, dy, kind) in enumerate([(x0 + 3, 4.5, "SMOKE"), (x0 + 3, 7.5, "SMOKE"), (x0 + 7.5, 4.5, "SMOKE"), (x0 + 7.5, 7.5, "HEAT")] if zname == "A" else [(x0 + 2.5, 4.5, "SMOKE"), (x0 + 2.5, 7.5, "SMOKE"), (x0 + 7.5, 4.5, "SMOKE"), (x0 + 7.5, 7.5, "HEAT")]):
            status, at = det_status.get((name, zname, i), ("NORMAL", None))
            DET = make("IfcSensor", f"{name}-{zname} {'연기' if kind == 'SMOKE' else '열'}감지기 {i + 1}", [pipe([(dx, dy, z + H - 0.35), (dx, dy, z + H - 0.3)], 0.06), sb.sphere(radius=0.07, center=V(dx, dy, z + H - 0.4))], sp, ST["fa"],
                       {"Pset_BimStatus": {"Status": status, "AlarmAt": at or "", "LastTest": "2026-07-15"}}, "SMOKESENSOR" if kind == "SMOKE" else "HEATSENSOR")
            link(DET, RPT, "화재감지")
        # 급수: 분기관 → 구역 밸브 → 위생기구 2개, 배수: 위생기구 → 횡주관
        vx = x0 + 2.5 if zname == "A" else x1 - 2.5
        VL = make("IfcValve", f"V-{name}-{zname} 구역 급수밸브", [box(vx - 0.15, 2.85, z + 2.85, 0.3, 0.3, 0.3)], sp, ST["ws"], None, "ISOLATION")
        link(WSB, VL, "급수")
        for i in range(2):
            fx = vx + (i * 1.5 if zname == "A" else -i * 1.5)
            SAN = make("IfcSanitaryTerminal", f"{name}-{zname} 위생기구 {i + 1}", [box(fx - 0.3, 0.4, z, 0.6, 0.7, 0.4), pipe([(fx, 0.7, z + 0.4), (fx, 3.0, z + 3.0)], 0.02), pipe([(fx, 0.75, z), (fx, 9.0, z + 0.15)], 0.03)], sp, ST["ws"], None, "TOILETPAN")
            link(VL, SAN, "급수"); link(SAN, WWB, "배수")
        # 소방: 주관 → 스프링클러 6개
        for i, (sx, sy) in enumerate([(x0 + 2 + j * 3.5, yy) for yy in (3, 9) for j in range(3)] if zname == "A" else [(x0 + 1.5 + j * 3.5, yy) for yy in (3, 9) for j in range(3)]):
            SPR = make("IfcFireSuppressionTerminal", f"{name}-{zname} 스프링클러 {i + 1}", [pipe([(sx, py + 0.5, z + 3.2), (sx, sy, z + 3.2), (sx, sy, z + H - 0.3)], 0.015), sb.sphere(radius=0.08, center=V(sx, sy, z + H - 0.3))], sp, ST["fp"], None, "SPRINKLER")
            link(FPB, SPR, "소방")

f.write(sys.argv[1] if len(sys.argv) > 1 else "mep-building.ifc")
n = {c: len(f.by_type(c)) for c in ("IfcElement", "IfcSpace", "IfcDistributionSystem", "IfcRelConnectsElements", "IfcSensor")}
print("written:", n)
