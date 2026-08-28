"""가상 업무동 + 공용부 설비 계통(MEP) IFC4 생성. 실행: python gen_mep.py out.ifc
건물 36 x 16 m, B2(변전·발전기·펌프·기계·수조·오폐수처리실 + 주차) / B1(주차장 + 방재·통신·주차관제실) / 지상 3층(A/B 구역) / 옥상(RF, 옥탑 보일러실). 코어에 EPS·PS·DS 샤프트, 엘리베이터, 계단실 2. 램프 17%(옥외 지상→B1, 내부 B1→B2).
계통(IfcDistributionSystem)과 흐름 연결(IfcRelConnectsElements: relating=상류, related=하류). 좌표는 남서 모서리 원점 상대좌표(m), 지리참조 없음.
운영 상태는 Pset_BimStatus(프로젝트 Pset) — 실제론 BMS 연동값이 API 로 갱신한다.
"""
import sys
import ifcopenshell
import ifcopenshell.api as api
import ifcopenshell.api.root, ifcopenshell.api.unit, ifcopenshell.api.context, ifcopenshell.api.project
import ifcopenshell.api.geometry, ifcopenshell.api.spatial, ifcopenshell.api.aggregate, ifcopenshell.api.system, ifcopenshell.api.pset, ifcopenshell.api.style, ifcopenshell.api.feature
from ifcopenshell.util.shape_builder import ShapeBuilder, V

W, D, H = 36.0, 16.0, 3.5
FLOORS = [("B2", -7.0), ("B1", -3.5), ("1F", 0.0), ("2F", 3.5), ("3F", 7.0)]
ST1 = (10.4, 10.0, 2.6, 4.6)          # 계단실 1 (코어 서쪽)
ST2 = (33.0, 0.3, 2.6, 4.6)           # 계단실 2 (동남)
RF = 10.5                              # 옥상 슬래브 상단
EPS = (16.0, 7.0, 1.2, 2.0)           # 전기 샤프트 x,y,w,d
PS = (17.4, 7.0, 1.2, 2.0)            # 배관 샤프트
DS = (18.8, 7.0, 1.6, 2.0)            # 덕트 샤프트
ELV = (13.2, 7.0, 2.4, 2.4)           # 엘리베이터 승강로
ex, ey = EPS[0] + EPS[2] / 2, EPS[1] + EPS[3] / 2
px, py = PS[0] + PS[2] / 2, PS[1] + PS[3] / 2
dx, dy = DS[0] + DS[2] / 2, DS[1] + DS[3] / 2

f = api.project.create_file(version="IFC4")
proj = api.root.create_entity(f, ifc_class="IfcProject", name="가상 업무동 — 공용부 설비 계통 예시")
api.unit.assign_unit(f, length={"is_metric": True, "raw": "METERS"})
ctx = api.context.add_context(f, context_type="Model")
body = api.context.add_context(f, context_type="Model", context_identifier="Body", target_view="MODEL_VIEW", parent=ctx)
sb = ShapeBuilder(f)
site = api.root.create_entity(f, ifc_class="IfcSite", name="대지")
bld = api.root.create_entity(f, ifc_class="IfcBuilding", name="업무동")
api.aggregate.assign_object(f, relating_object=proj, products=[site]); api.aggregate.assign_object(f, relating_object=site, products=[bld])

_styles = {}
def style(name, rgb, alpha=1.0):
    if name not in _styles:
        s = api.style.add_style(f, name=name)
        api.style.add_surface_style(f, style=s, ifc_class="IfcSurfaceStyleShading", attributes={"SurfaceColour": {"Name": None, "Red": rgb[0], "Green": rgb[1], "Blue": rgb[2]}, "Transparency": 1 - alpha})
        _styles[name] = s
    return _styles[name]
ST = {k: style(k, *v) for k, v in {
    "slab": ((0.75, 0.75, 0.75),), "wall": ((0.85, 0.85, 0.82), 0.35), "space": ((0.6, 0.75, 1.0), 0.15), "shaft": ((0.5, 0.5, 0.5), 0.3),
    "el": ((0.95, 0.65, 0.1),), "tray": ((0.8, 0.5, 0.1),), "light": ((1.0, 0.95, 0.6),), "em": ((0.85, 0.3, 0.05),), "gen": ((0.4, 0.4, 0.45),),
    "ws": ((0.2, 0.5, 0.95),), "ww": ((0.45, 0.35, 0.25),), "hw": ((0.9, 0.45, 0.45),), "fp": ((0.9, 0.2, 0.2),), "tank": ((0.3, 0.6, 0.8), 0.6), "fa": ((0.6, 0.2, 0.7),),
    "hvac": ((0.2, 0.7, 0.65),), "duct": ((0.65, 0.8, 0.8), 0.7), "chw": ((0.1, 0.55, 0.85),), "vent": ((0.5, 0.7, 0.5),), "gas": ((0.95, 0.8, 0.2),),
    "comm": ((0.3, 0.35, 0.7),), "trans": ((0.55, 0.5, 0.45),), "pv": ((0.15, 0.2, 0.4),), "park": ((0.2, 0.55, 0.45),), "mark": ((0.95, 0.95, 0.9),),
}.items()}

def rep(items, st=None):
    r = sb.get_representation(context=body, items=items)
    if st: api.style.assign_representation_styles(f, shape_representation=r, styles=[st])
    return r
def box(x, y, z, w, d, h): return sb.extrude(sb.rectangle(size=V(w, d), position=V(x, y)), magnitude=h, position=V(0, 0, z))
def pipe(points, r=0.05): return sb.create_swept_disk_solid(sb.polyline([V(*p) for p in points]), r)
def cyl(x, y, z, r, h): return sb.extrude(sb.circle(radius=r, center=V(x, y)), magnitude=h, position=V(0, 0, z))
def ramp(x, y, z, w, d, run, rise, rx=0.0):
    """경사 부재: 바닥 직사각형(w×d)을 (rx, run, rise) 방향으로 밀어낸 평행육면체(에스컬레이터 트러스·난간, 차량 램프). rx 주면 x 방향 경사"""
    L = (rx ** 2 + run ** 2 + rise ** 2) ** 0.5
    return sb.extrude(sb.rectangle(size=V(w, d), position=V(x, y)), magnitude=L, position=V(0, 0, z), extrusion_vector=V(rx / L, run / L, rise / L))
def void(host, x, y, z, w, d, h, name="개구부"):
    """슬래브 개구부(IfcOpeningElement + IfcRelVoidsElement). 변환기(geom.iterator)가 호스트에서 빼 준다"""
    op = api.root.create_entity(f, ifc_class="IfcOpeningElement", name=name)
    api.geometry.assign_representation(f, product=op, representation=rep([box(x, y, z, w, d, h)]))
    api.geometry.edit_object_placement(f, product=op); api.feature.add_feature(f, feature=op, element=host)

def make(cls, name, items, container, st=None, psets=None, ptype=None, status=None):
    el = api.root.create_entity(f, ifc_class=cls, name=name, predefined_type=ptype)
    api.geometry.assign_representation(f, product=el, representation=rep(items, st))
    api.geometry.edit_object_placement(f, product=el)
    api.spatial.assign_container(f, relating_structure=container, products=[el])
    ps = dict(psets or {})
    if status: ps["Pset_BimStatus"] = status
    for pn, props in ps.items():
        api.pset.edit_pset(f, pset=api.pset.add_pset(f, product=el, name=pn), properties=props)
    return el

systems = {}
def system(name, ptype):
    # 수송(엘리베이터 등)은 IfcDistributionElement 가 아니라 IfcDistributionSystem 에 못 넣는다 → 일반 IfcSystem
    if ptype == "USERDEFINED":
        s = api.system.add_system(f, ifc_class="IfcSystem"); s.Name = name
    else:
        s = api.system.add_system(f, ifc_class="IfcDistributionSystem"); s.Name, s.PredefinedType = name, ptype
    systems[name] = s
for n, t in [("전기", "ELECTRICAL"), ("비상전원", "ELECTRICAL"), ("화재감지", "SIGNAL"), ("급수", "DOMESTICCOLDWATER"), ("배수", "WASTEWATER"), ("소방", "FIREPROTECTION"),
             ("공조", "AIRCONDITIONING"), ("냉난방수", "CHILLEDWATER"), ("환기", "VENTILATION"), ("급탕", "DOMESTICHOTWATER"), ("가스", "GAS"), ("통신", "DATA"), ("수송", "USERDEFINED"), ("주차관제", "CONTROL")]:
    system(n, t)
def link(up, down, sysname):
    api.geometry.connect_element(f, relating_element=up, related_element=down, description="FLOW")
    for el in (up, down): api.system.assign_system(f, products=[el], system=systems[sysname])
def chain(sysname, *els):
    for a, b in zip(els, els[1:]): link(a, b, sysname)

NORMAL = {"Status": "NORMAL"}
# ---------- 구조 ----------
# 층 구성(실무 관행): B1 주차장 + 방재·통신·주차관제실 / B2 주차 일부 + 변전·발전기·펌프·기계·수조·오폐수처리실 / 옥탑 보일러실(가스는 지상 위로만).
# 램프: 지상→B1 은 북측 옥외 램프(17%, 20.6m), B1→B2 는 남측 장변을 따라 건물 안 램프(17%). 계단실 2개소 전 층.
storeys, spaces, slabs = {}, {}, {}
SHAFTS = (("EPS", EPS), ("PS", PS), ("DS", DS), ("EV", ELV), ("ST1", ST1), ("ST2", ST2))
for name, z in FLOORS + [("RF", RF)]:
    st = api.root.create_entity(f, ifc_class="IfcBuildingStorey", name=name); st.Elevation = z
    api.aggregate.assign_object(f, relating_object=bld, products=[st]); storeys[name] = st
    slabs[name] = make("IfcSlab", f"{name} 바닥", [box(0, 0, z - 0.2, W, D, 0.2)], st, ST["slab"], ptype="ROOF" if name == "RF" else "FLOOR")
    if name != "B2":   # 샤프트(EPS·PS·DS·EV)·계단실은 슬래브를 관통 → 개구부
        for label, (x, y, w, d) in SHAFTS:
            void(slabs[name], x, y, z - 0.25, w, d, 0.3, f"{name} {label} 개구부")
    if name == "RF":
        make("IfcWall", "옥상 파라펫", [box(0, 0, z, W, 0.2, 1.0), box(0, D - 0.2, z, W, 0.2, 1.0), box(0, 0, z, 0.2, D, 1.0), box(W - 0.2, 0, z, 0.2, D, 1.0)], st, ST["wall"])
        continue
    for (x, y, w, d) in [(0, 0, W, 0.2), (0, D - 0.2, W, 0.2), (0, 0, 0.2, D), (W - 0.2, 0, 0.2, D)]:
        if name == "B1" and y == D - 0.2:   # B1 북벽: 옥외 진입 램프 출입구 (x 30~35.5) 개구
            make("IfcWall", f"{name} 외벽", [box(0, y, z, 30.0, 0.2, H), box(35.5, y, z, 0.5, 0.2, H)], st, ST["wall"]); continue
        make("IfcWall", f"{name} 외벽", [box(x, y, z, w, d, H)], st, ST["wall"])
    for label, (x, y, w, d) in SHAFTS:
        make("IfcWall", f"{name} {label} {'계단실' if label.startswith('ST') else '샤프트'}", [box(x, y, z, w, 0.1, H), box(x, y + d, z, w, 0.1, H), box(x, y, z, 0.1, d, H), box(x + w, y, z, 0.1, d, H)], st, ST["shaft"])
    zones = [("변전실", 0, 4, 7, 6.5), ("발전기실", 0, 10.5, 7, 5.5), ("펌프실", 7, 4, 5.5, 5), ("주차C", 7, 9, 13.6, 7), ("기계실", 20.6, 4, 8.4, 12), ("수조실", 29, 4, 7, 6), ("오폐수처리실", 29, 10, 7, 6), ("램프", 5, 0, 25, 3.8)] if name == "B2" \
        else [("주차A", 0, 0, 9.4, 8), ("방재실", 0, 8, 7, 4), ("통신실", 0, 12, 7, 4), ("주차관제실", 7, 12, 3.2, 4), ("램프", 9.4, 0, 20.6, 3.8), ("주차B", 20.6, 3.8, 15.4, 12.2)] if name == "B1" \
        else [("A", 0, 0, 13, D), ("B", 20.6, 0, W - 20.6, D)]
    for zname, x, y, w, d in zones:
        sp = api.root.create_entity(f, ifc_class="IfcSpace", name=f"{name}-{zname}")
        api.geometry.assign_representation(f, product=sp, representation=rep([box(x + 0.2, y + 0.2, z, w - 0.4, d - 0.4, H - 0.3)], ST["space"]))
        api.geometry.edit_object_placement(f, product=sp); api.aggregate.assign_object(f, relating_object=st, products=[sp]); spaces[f"{name}-{zname}"] = sp
rf = storeys["RF"]; b1 = storeys["B1"]; b2 = storeys["B2"]; zb = -3.5; z2 = -7.0; top = FLOORS[-1][1] + H
for zname, x, y, w, d, h in (("옥상", 0.2, 0.2, W - 0.4, D - 0.4, 3.0), ("보일러실", 27, 0.5, 8.5, 6, 3.0)):
    sp = api.root.create_entity(f, ifc_class="IfcSpace", name=f"RF-{zname}")
    api.geometry.assign_representation(f, product=sp, representation=rep([box(x, y, RF, w, d, h)], ST["space"])); api.geometry.edit_object_placement(f, product=sp); api.aggregate.assign_object(f, relating_object=rf, products=[sp]); spaces[f"RF-{zname}"] = sp
make("IfcWall", "옥탑 보일러실 벽", [box(27, 0.5, RF, 8.5, 0.15, 3.0), box(27, 6.35, RF, 8.5, 0.15, 3.0), box(27, 0.5, RF, 0.15, 6, 3.0), box(35.35, 0.5, RF, 0.15, 6, 3.0)], rf, ST["wall"])
make("IfcSlab", "옥탑 보일러실 지붕", [box(27, 0.5, RF + 3.0, 8.5, 6, 0.15)], rf, ST["slab"], None, "ROOF")
def S(k): return spaces[k]
# 계단: 반층 절환(2단, 단당 run 2.0 / rise 1.75 — 경사판으로 근사). 각 층 → 윗층. 계단실 벽·개구부는 위 SHAFTS 루프
for label, (sx, sy, sw, sd) in (("ST-1", ST1), ("ST-2", ST2)):
    for (name, z), (nxt, _) in zip(FLOORS, FLOORS[1:] + [("RF", RF)]):
        make("IfcStair", f"{label} 계단 {name}→{nxt}", [ramp(sx + 0.1, sy + 0.3, z, 1.15, 0.6, 2.0, 1.75), box(sx + 0.1, sy + 2.3, z + 1.75, sw - 0.2, 1.0, 0.15), ramp(sx + sw - 1.25, sy + 2.7, z + 1.75, 1.15, 0.6, -2.0, 1.75)],
             storeys[name], ST["slab"], None, "HALF_TURN_STAIR")
# 차량 램프
RUN = 3.5 / 0.17   # 17% → 20.6 m
RP1 = make("IfcRamp", "RP-1 진입 램프 지상→B1 (옥외, 북측)", [ramp(5.0, 16.5, 0.0, 0.8, 3.0, 0, -3.5, rx=RUN)], b1, ST["slab"], None, "STRAIGHT_RUN_RAMP")
make("IfcSlab", "옥외 램프 하부 참", [box(5.0 + RUN, 16.2, zb - 0.2, 35.8 - 5.0 - RUN, 4.1, 0.2)], b1, ST["slab"], None, "LANDING")
make("IfcWall", "옥외 램프 옹벽", [box(5.0, 20.3, zb, 30.8, 0.2, H), box(35.8, D, zb, 0.2, 4.5, H)], b1, ST["wall"])
RP2 = make("IfcRamp", "RP-2 램프 B1→B2 (건물 내, 남측)", [ramp(29.2, 0.5, zb, 0.8, 3.0, 0, -3.5, rx=-RUN)], b2, ST["slab"], None, "STRAIGHT_RUN_RAMP")
make("IfcWall", "내부 램프 측벽", [box(30.0 - RUN, 3.6, z2, RUN, 0.15, 3.3)], b2, ST["wall"])
void(slabs["B1"], 30.0 - RUN * (3.5 - 2.1) / 3.5, 0.2, zb - 0.25, RUN * (3.5 - 2.1) / 3.5, 3.6, 0.3, "B1 램프 개구부")   # 램프 위 머리높이 2.1m 미만 구간

# ---------- 전기: 수변전 (B2 변전실) · 발전기실 ----------
HV = make("IfcElectricDistributionBoard", "HV-1 고압수전반 22.9kV", [box(0.5, 4.5, z2, 0.9, 2.5, 2.3)], S("B2-변전실"), ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 22900.0}}, "SWITCHBOARD", {"Status": "NORMAL", "Breaker": "CLOSED"})
METER = make("IfcFlowMeter", "WHM-1 전력량계", [box(1.6, 4.5, z2 + 1.2, 0.4, 0.3, 0.5)], S("B2-변전실"), ST["el"], None, "ENERGYMETER", {"Status": "NORMAL", "kWh": 1834520.0, "DemandKW": 212.0})
TR = make("IfcTransformer", "TR-1 변압기 22.9kV/380V 500kVA", [box(2.5, 4.5, z2, 2, 2.5, 2.2)], S("B2-변전실"), ST["el"], {"Pset_TransformerTypeCommon": {"PrimaryVoltage": 22900.0, "SecondaryVoltage": 380.0}}, "VOLTAGE", {"Status": "NORMAL", "LoadPercent": 48.0, "OilTemp": 52.0})
MDB = make("IfcElectricDistributionBoard", "MDB 저압 배전반", [box(5.2, 4.5, z2, 0.9, 2.5, 2.0)], S("B2-변전실"), ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 800.0}}, "SWITCHBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 48.0})
MCC = make("IfcElectricDistributionBoard", "MCC-1 동력제어반", [box(5.2, 7.5, z2, 0.9, 2.0, 2.0)], S("B2-변전실"), ST["el"], None, "MOTORCONTROLCENTRE", {"Status": "NORMAL", "Breaker": "CLOSED"})
chain("전기", HV, METER, TR, MDB); link(MDB, MCC, "전기")
LPS = make("IfcProtectiveDevice", "LPS-1 피뢰·접지 단자함", [box(6.3, 4.5, z2 + 0.5, 0.3, 0.3, 0.5)], S("B2-변전실"), ST["el"], None, "EARTHINGSWITCH", {"Status": "NORMAL", "EarthOhm": 3.2})
GEN = make("IfcElectricGenerator", "EG-1 비상발전기 200kW", [box(0.5, 11.0, z2, 3, 1.6, 1.8), box(0.7, 12.8, z2, 1.0, 1.0, 1.0)], S("B2-발전기실"), ST["gen"], {"Pset_ElectricGeneratorTypeCommon": {"MaximumPowerOutput": 200000.0}}, "CHP", {"Status": "STANDBY", "FuelLevel": 82.0, "LastTest": "2026-08-01"})
FUEL = make("IfcTank", "FT-0 발전기 연료탱크 1000L", [box(0.5, 14.3, z2, 1.5, 0.8, 1.0)], S("B2-발전기실"), ST["gen"], None, "STORAGE", {"Status": "NORMAL", "LevelPercent": 82.0}); link(FUEL, GEN, "비상전원")
ATS = make("IfcSwitchingDevice", "ATS-1 자동절체개폐기", [box(4.5, 11.0, z2, 0.6, 0.8, 1.6)], S("B2-발전기실"), ST["em"], None, "TRANSFERSWITCH", {"Status": "NORMAL", "Source": "UTILITY"})
EMDB = make("IfcElectricDistributionBoard", "EMDB 비상분전반", [box(4.5, 13.0, z2, 0.8, 0.8, 2.0)], S("B2-발전기실"), ST["em"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 400.0}}, "SWITCHBOARD", {"Status": "NORMAL", "Breaker": "CLOSED"})
link(GEN, ATS, "비상전원"); link(MDB, ATS, "비상전원"); link(ATS, EMDB, "비상전원")
# 통신실 (B1): UPS·배터리·MDF·BMS·FMS
UPS = make("IfcElectricFlowStorageDevice", "UPS-1 무정전전원 30kVA", [box(0.5, 12.5, zb, 0.8, 1.0, 1.9)], S("B1-통신실"), ST["em"], None, "UPS", {"Status": "NORMAL", "LoadPercent": 41.0, "OnBattery": False})
BAT = make("IfcElectricFlowStorageDevice", "BAT-1 축전지 뱅크", [box(1.6, 12.5, zb, 1.2, 1.0, 1.2)], S("B1-통신실"), ST["em"], None, "BATTERY", {"Status": "NORMAL", "ChargePercent": 100.0})
chain("비상전원", EMDB, UPS); link(BAT, UPS, "비상전원")
MDF = make("IfcCommunicationsAppliance", "MDF 주배선반", [box(3.2, 12.5, zb, 0.6, 1.0, 2.0)], S("B1-통신실"), ST["comm"], None, "NETWORKHUB", {"Status": "ONLINE", "Uplink": "1Gbps"})
BMS = make("IfcController", "BMS 주장치 (DDC 서버)", [box(4.2, 12.5, zb, 0.6, 0.8, 2.0)], S("B1-통신실"), ST["comm"], None, "PROGRAMMABLE", {"Status": "ONLINE", "Points": 1240})
FMS = make("IfcCommunicationsAppliance", "FMS 서버", [box(5.2, 12.5, zb, 0.6, 0.8, 2.0)], S("B1-통신실"), ST["comm"], None, "COMPUTER", {"Status": "ONLINE"})
chain("비상전원", UPS, MDF); link(UPS, BMS, "비상전원"); link(UPS, FMS, "비상전원")
link(MDF, BMS, "통신"); link(MDF, FMS, "통신")
# 방재실 (B1): 화재수신기·비상방송 앰프·CCTV NVR·출입통제·가스계 소화약제
FACP = make("IfcUnitaryControlElement", "FACP 화재수신기 (R형)", [box(0.5, 11.5, zb + 0.8, 0.7, 0.3, 1.0)], S("B1-방재실"), ST["fa"], None, "ALARMPANEL", {"Status": "NORMAL", "ActiveAlarms": 1, "Faults": 1})
PA = make("IfcAudioVisualAppliance", "PA-1 비상방송 앰프", [box(1.5, 11.5, zb + 0.8, 0.6, 0.3, 0.8)], S("B1-방재실"), ST["comm"], None, "AMPLIFIER", {"Status": "ONLINE"})
NVR = make("IfcCommunicationsAppliance", "NVR CCTV 녹화장치", [box(2.4, 11.5, zb + 0.8, 0.6, 0.3, 0.8)], S("B1-방재실"), ST["comm"], None, "COMPUTER", {"Status": "ONLINE", "Cameras": 14})
ACS = make("IfcUnitaryControlElement", "출입통제 주장치", [box(3.3, 11.5, zb + 0.8, 0.5, 0.3, 0.8)], S("B1-방재실"), ST["comm"], None, "CONTROLPANEL", {"Status": "ONLINE"})
link(EMDB, FACP, "비상전원"); link(UPS, PA, "비상전원"); link(UPS, NVR, "비상전원"); link(UPS, ACS, "비상전원")
link(MDF, NVR, "통신"); link(MDF, ACS, "통신"); link(FACP, PA, "화재감지")
# 태양광(옥상) → 인버터(변전실) → MDB
PV = make("IfcSolarDevice", "PV-1 태양광 패널 50kW", [box(2, 2, RF + 0.8, 14, 6, 0.1)], S("RF-옥상"), ST["pv"], None, "SOLARPANEL", {"Status": "NORMAL", "OutputKW": 31.5})
INV = make("IfcTransformer", "INV-1 태양광 인버터", [box(5.2, 9.8, z2 + 0.5, 0.6, 0.4, 0.9)], S("B2-변전실"), ST["el"], None, "INVERTER", {"Status": "NORMAL", "OutputKW": 31.5})
chain("전기", PV, INV, MDB)

# ---------- 급수·배수·소방 (B2 펌프실·수조실·오폐수처리실) ----------
WT = make("IfcTank", "WT-1 저수조 50t", [box(30, 5.0, z2, 5, 2.3, 2.5)], S("B2-수조실"), ST["tank"], {"Pset_TankTypeCommon": {"NominalCapacity": 50.0}}, "STORAGE", {"Status": "NORMAL", "LevelPercent": 76.0})
FT = make("IfcTank", "FT-1 소화수조 60t", [box(30, 7.5, z2, 5, 2.3, 2.5)], S("B2-수조실"), ST["tank"], {"Pset_TankTypeCommon": {"NominalCapacity": 60.0}}, "STORAGE", {"Status": "NORMAL", "LevelPercent": 98.0})
FIL = make("IfcFilter", "WF-1 정수·연수장치", [cyl(8.0, 5.5, z2, 0.4, 1.6)], S("B2-펌프실"), ST["ws"], None, "WATERFILTER", {"Status": "NORMAL", "DiffPressure": 0.12})
WP = make("IfcPump", "WP-1 부스터 급수펌프", [box(9.0, 5.0, z2, 1.2, 1.0, 1.2)], S("B2-펌프실"), ST["ws"], {"Pset_PumpTypeCommon": {"NominalCapacity": 0.0083}}, "ENDSUCTION", {"Status": "RUNNING", "RunHours": 4120.0})
p = make("IfcPipeSegment", "급수 흡입관", [pipe([(32, 6.2, z2 + 0.5), (8.4, 6.2, z2 + 0.5)], 0.06)], b2, ST["ws"], None, "RIGIDSEGMENT"); chain("급수", WT, p, FIL, WP)
WS_B1 = make("IfcPipeSegment", "급수 토출관", [pipe([(9.6, 6.0, z2 + 1.2), (9.6, 6.0, z2 + 3.0), (px - 0.3, py, z2 + 3.0)], 0.05)], b2, ST["ws"], None, "RIGIDSEGMENT"); link(WP, WS_B1, "급수")
FP = make("IfcPump", "FP-1 소화 주펌프", [box(10.5, 5.0, z2, 1.2, 1.0, 1.4)], S("B2-펌프실"), ST["fp"], None, "ENDSUCTION", {"Status": "STANDBY", "LastTest": "2026-08-10"})
p = make("IfcPipeSegment", "소화 흡입관", [pipe([(32, 8.7, z2 + 0.5), (11.1, 8.7, z2 + 0.5), (11.1, 6.2, z2 + 0.5)], 0.075)], b2, ST["fp"], None, "RIGIDSEGMENT"); chain("소방", FT, p, FP)
FP_B1 = make("IfcPipeSegment", "소화 토출관", [pipe([(11.1, 5.5, z2 + 1.4), (11.1, 5.5, z2 + 3.1), (px + 0.3, py, z2 + 3.1)], 0.065)], b2, ST["fp"], None, "RIGIDSEGMENT"); link(FP, FP_B1, "소방")
link(EMDB, FP, "비상전원"); link(MCC, WP, "전기")
GASFS = make("IfcTank", "GS-1 가스계 소화약제 용기 (통신실·변전실·발전기실)", [cyl(5.0, 8.6, zb, 0.25, 1.5), cyl(5.7, 8.6, zb, 0.25, 1.5), cyl(6.4, 8.6, zb, 0.25, 1.5)], S("B1-방재실"), ST["fp"], None, "PRESSUREVESSEL", {"Status": "NORMAL", "PressureMPa": 4.2})
for room, (gx, gy, gz) in (("B1-통신실", (3.5, 14.0, zb)), ("B2-변전실", (3.5, 7.0, z2)), ("B2-발전기실", (3.5, 13.5, z2))):
    noz = make("IfcFireSuppressionTerminal", f"가스계 소화 노즐 ({room.split('-')[1]})", [sb.sphere(radius=0.1, center=V(gx, gy, gz + H - 0.4))], S(room), ST["fp"], None, "SPRINKLER"); link(GASFS, noz, "소방"); link(FACP, GASFS, "화재감지")
SP = make("IfcTank", "SP-1 집수정", [box(7.5, 7.0, z2 - 0.2, 2, 1.8, 1.0)], S("B2-펌프실"), ST["ww"], None, "BASIN", {"Status": "NORMAL", "LevelPercent": 12.0})
SPP = make("IfcPump", "SPP-1 오배수 펌프", [box(9.8, 7.5, z2, 0.6, 0.6, 0.8)], S("B2-펌프실"), ST["ww"], None, "SUBMERSIBLEPUMP", {"Status": "STANDBY"})
STP = make("IfcTank", "STP-1 오수처리조", [box(29.3, 10.5, z2 - 1.0, 5, 1.6, 1.8)], S("B2-오폐수처리실"), ST["ww"], None, "STORAGE", {"Status": "NORMAL", "LevelPercent": 41.0})
RWT = make("IfcTank", "RWT-1 우수 저류조 20t", [box(29.3, 12.5, z2 - 1.0, 5, 1.8, 1.5)], S("B2-오폐수처리실"), ST["tank"], None, "STORAGE", {"Status": "NORMAL", "LevelPercent": 34.0})
GT = make("IfcInterceptor", "GT-1 그리스트랩", [box(11.0, 7.8, z2 - 0.3, 0.8, 0.6, 0.6)], S("B2-펌프실"), ST["ww"], None, "GREASE", {"Status": "NORMAL"})
chain("배수", SP, SPP, STP); link(GT, SP, "배수"); link(MCC, SPP, "전기")
WW_B1 = make("IfcPipeSegment", "배수 집수관", [pipe([(px, py - 0.3, z2 + 0.3), (8.5, 7.8, z2 + 0.3)], 0.075)], b2, ST["ww"], None, "RIGIDSEGMENT"); link(WW_B1, SP, "배수")

# ---------- 기계실 (B2): 냉동기·히트펌프·열교환기·AHU / 옥탑 보일러실: 온수·급탕 보일러·가스 / 옥상: 냉각탑·실외기·팬·고가수조 ----------
CH = make("IfcChiller", "CH-1 터보냉동기 150RT", [box(21, 5, z2, 3.5, 1.8, 2.0)], S("B2-기계실"), ST["hvac"], None, "WATERCOOLED", {"Status": "RUNNING", "LoadPercent": 62.0, "CHWSupplyTemp": 7.1})
CT = make("IfcCoolingTower", "CT-1 냉각탑 175RT", [box(22, 9, RF, 4, 4, 3.2)], S("RF-옥상"), ST["hvac"], None, "OPENCIRCUIT", {"Status": "RUNNING", "FanSpeed": 70.0})
CHWP = make("IfcPump", "CHWP-1 냉수 순환펌프", [box(25.5, 5.5, z2, 0.8, 0.8, 1.0)], S("B2-기계실"), ST["chw"], None, "ENDSUCTION", {"Status": "RUNNING", "RunHours": 2210.0})
CWP = make("IfcPump", "CWP-1 냉각수 펌프", [box(26.8, 5.5, z2, 0.8, 0.8, 1.0)], S("B2-기계실"), ST["chw"], None, "ENDSUCTION", {"Status": "RUNNING"})
HP = make("IfcUnitaryEquipment", "HP-1 지열 히트펌프", [box(21, 8.5, z2, 1.5, 1.5, 1.6)], S("B2-기계실"), ST["hvac"], None, "AIRCONDITIONINGUNIT", {"Status": "RUNNING", "COP": 4.1})
HX = make("IfcHeatExchanger", "HX-1 판형 열교환기", [box(23.5, 8.5, z2, 1.0, 0.5, 1.4)], S("B2-기계실"), ST["chw"], None, "PLATE", {"Status": "NORMAL", "DeltaT": 5.2})
EXT = make("IfcTank", "ET-1 팽창탱크", [cyl(25.5, 8.8, z2, 0.4, 1.4)], S("B2-기계실"), ST["chw"], None, "EXPANSION", {"Status": "NORMAL", "PressureBar": 2.1})
BLR = make("IfcBoiler", "B-1 온수보일러 300kW", [box(27.5, 1.0, RF, 2.0, 1.8, 2.0)], S("RF-보일러실"), ST["hw"], None, "WATER", {"Status": "STANDBY", "OutletTemp": 45.0})
HWCP = make("IfcPump", "HWP-2 온수 순환펌프", [box(28.0, 3.8, RF, 0.8, 0.8, 1.0)], S("RF-보일러실"), ST["hw"], None, "ENDSUCTION", {"Status": "STANDBY"})
HWB = make("IfcBoiler", "HWB-1 급탕보일러 150kW", [box(30.0, 1.0, RF, 1.5, 1.5, 1.8)], S("RF-보일러실"), ST["hw"], None, "WATER", {"Status": "RUNNING", "OutletTemp": 62.0})
HWT = make("IfcTank", "HWT-1 저탕조 3t", [cyl(32.5, 1.8, RF, 0.8, 2.2)], S("RF-보일러실"), ST["hw"], None, "STORAGE", {"Status": "NORMAL", "Temp": 60.0, "LevelPercent": 90.0})
HWP = make("IfcPump", "HWP-1 급탕 순환펌프", [box(33.5, 3.8, RF, 0.6, 0.6, 0.8)], S("RF-보일러실"), ST["hw"], None, "CIRCULATOR", {"Status": "RUNNING"})
GASR = make("IfcValve", "GR-1 가스 정압기", [box(34.5, 1.0, RF + 0.6, 0.6, 0.4, 0.6)], S("RF-보일러실"), ST["gas"], None, "PRESSUREREDUCING", {"Status": "NORMAL", "OutletKPa": 2.5})
GASV = make("IfcValve", "GV-1 가스 긴급차단밸브", [box(34.5, 2.2, RF + 0.6, 0.4, 0.4, 0.4)], S("RF-보일러실"), ST["gas"], None, "ISOLATION", {"Status": "NORMAL", "Open": True})
gp = make("IfcPipeSegment", "가스 배관 (옥탑)", [pipe([(34.7, 2.6, RF + 0.8), (34.7, 3.2, RF + 0.8), (28.5, 3.2, RF + 0.8)], 0.03)], rf, ST["gas"], None, "RIGIDSEGMENT"); chain("가스", GASR, GASV, gp, HWB); link(gp, BLR, "가스")
chain("급탕", WP, HWB, HWT, HWP)
HW_RF = make("IfcPipeSegment", "급탕 토출관 (옥탑→입상)", [pipe([(33.8, 4.4, RF + 0.8), (px - 0.5, py, RF + 0.8)], 0.04)], rf, ST["hw"], None, "RIGIDSEGMENT"); link(HWP, HW_RF, "급탕")
riser_hot = make("IfcPipeSegment", "온수 입상관 (옥탑→기계실)", [pipe([(28.4, 4.2, RF + 1.0), (px + 0.7, py - 0.5, RF + 1.0), (px + 0.7, py - 0.5, z2 + 1.4), (24.0, 8.7, z2 + 1.4)], 0.05)], b2, ST["hw"], None, "RIGIDSEGMENT")
chain("냉난방수", CT, CWP, CH); chain("냉난방수", CH, CHWP, HX); chain("냉난방수", BLR, HWCP, riser_hot, HX); link(HP, HX, "냉난방수"); link(EXT, CHWP, "냉난방수")
for m in (CH, CHWP, CWP, HWCP, HP, HWP): link(MCC, m, "전기")
riser_chw = make("IfcPipeSegment", "냉온수 입상관", [pipe([(24.0, 8.7, z2 + 1.4), (px + 0.5, py + 0.5, z2 + 3.0), (px + 0.5, py + 0.5, top)], 0.06)], b2, ST["chw"], None, "RIGIDSEGMENT"); link(HX, riser_chw, "냉난방수")
AHU = make("IfcUnitaryEquipment", "AHU-1 공조기 (전층)", [box(21, 11, z2, 5, 2.4, 2.2)], S("B2-기계실"), ST["hvac"], None, "AIRHANDLER", {"Status": "RUNNING", "SupplyTemp": 16.5, "FanSpeed": 65.0})
OAU = make("IfcUnitaryEquipment", "OAU-1 외기처리기", [box(2, 9, RF, 3, 2, 1.8)], S("RF-옥상"), ST["hvac"], None, "AIRHANDLER", {"Status": "RUNNING"})
HUM = make("IfcHumidifier", "HU-1 가습기", [box(26.5, 13.8, z2, 0.6, 0.6, 1.0)], S("B2-기계실"), ST["hvac"], None, "STEAMINJECTION", {"Status": "STANDBY"})
link(HX, AHU, "냉난방수"); link(HUM, AHU, "공조"); link(OAU, AHU, "공조"); link(MCC, AHU, "전기"); link(MCC, OAU, "전기")
duct_riser = make("IfcDuctSegment", "급기 덕트 입상", [box(dx - 0.5, dy - 0.4, z2 + 2.3, 1.0, 0.8, top - z2 - 2.3)], b2, ST["duct"], None, "RIGIDSEGMENT")
dm = make("IfcDuctSegment", "AHU 급기 주덕트", [box(dx - 0.5, 11.0, z2 + 2.3, 1.0, 0.8, 0.8), box(dx - 0.5, dy + 0.4, z2 + 2.3, 1.0, 11.0 - dy - 0.4, 0.8)], b2, ST["duct"], None, "RIGIDSEGMENT"); chain("공조", AHU, dm, duct_riser)
SF = make("IfcFan", "SF-1 급기팬", [box(8, 2, RF, 1.5, 1.2, 1.2)], S("RF-옥상"), ST["vent"], None, "CENTRIFUGALFORWARDCURVED", {"Status": "RUNNING", "SpeedPercent": 60.0})
EF = make("IfcFan", "EF-1 배기팬", [box(10.5, 2, RF, 1.5, 1.2, 1.2)], S("RF-옥상"), ST["vent"], None, "CENTRIFUGALBACKWARDINCLINEDCURVED", {"Status": "RUNNING", "SpeedPercent": 55.0})
SEF = make("IfcFan", "SEF-1 제연·배연팬", [box(13, 2, RF, 1.8, 1.4, 1.4)], S("RF-옥상"), ST["vent"], None, "CENTRIFUGALAIRFOIL", {"Status": "STANDBY", "LastTest": "2026-07-20"})
JF = make("IfcFan", "JF-1 주차장 제트팬", [cyl(8.0, 6.5, zb + 2.6, 0.3, 0.9), cyl(26.0, 11.0, zb + 2.6, 0.3, 0.9)], S("B1-주차A"), ST["vent"], None, "TUBEAXIAL", {"Status": "STANDBY", "COppm": 8})
ODU = make("IfcUnitaryEquipment", "ODU-1 실외기 (EHP)", [box(16, 2, RF, 1.2, 0.5, 1.2), box(17.6, 2, RF, 1.2, 0.5, 1.2)], S("RF-옥상"), ST["hvac"], None, "SPLITSYSTEM", {"Status": "RUNNING"})
HWT2 = make("IfcTank", "HT-1 고가수조 10t", [box(32, 10, RF, 3, 3, 2.0)], S("RF-옥상"), ST["tank"], None, "STORAGE", {"Status": "NORMAL", "LevelPercent": 88.0})
for fan in (SF, EF, SEF, JF, ODU): link(MCC, fan, "전기")
link(EMDB, SEF, "비상전원"); link(FACP, SEF, "화재감지")
ex_riser = make("IfcDuctSegment", "배기·제연 덕트 입상", [box(dx + 0.2, dy - 0.4, top, 0.5, 0.8, RF - top + 1.2)], rf, ST["duct"], None, "RIGIDSEGMENT"); link(ex_riser, EF, "환기"); link(ex_riser, SEF, "환기")
riser_ws_top = make("IfcPipeSegment", "고가수조 급수관", [pipe([(px - 0.3, py, top), (px - 0.3, py, RF + 1.0), (32.5, 11.5, RF + 1.0)], 0.05)], rf, ST["ws"], None, "RIGIDSEGMENT"); link(riser_ws_top, HWT2, "급수"); link(riser_ws_top, HWB, "급탕")

# ---------- 입상 (B2 → 옥상) ----------
riser_el = make("IfcCableCarrierSegment", "EPS 입상 트레이", [box(ex - 0.15, ey - 0.15, z2 + 2.8, 0.3, 0.3, top - z2 - 2.8)], b2, ST["tray"], None, "CABLELADDERSEGMENT")
t = make("IfcCableCarrierSegment", "B2 케이블트레이", [box(6.1, 5.5, z2 + 2.8, ex - 6.1, 0.3, 0.1)], b2, ST["tray"], None, "CABLETRAYSEGMENT"); chain("전기", MDB, t, riser_el)
riser_em = make("IfcCableCarrierSegment", "EPS 비상 입상 트레이", [box(ex - 0.5, ey - 0.15, z2 + 2.8, 0.25, 0.3, top - z2 - 2.8)], b2, ST["em"], None, "CABLELADDERSEGMENT")
t = make("IfcCableCarrierSegment", "B2 비상 트레이", [box(5.3, 13.4, z2 + 2.8, ex - 0.5 - 5.3, 0.25, 0.1)], b2, ST["em"], None, "CABLETRAYSEGMENT"); chain("비상전원", EMDB, t, riser_em)
riser_fa = make("IfcCableSegment", "화재감지 간선 (입상)", [pipe([(0.85, 11.65, zb + 1.8), (0.85, 11.65, zb + 3.0), (ex + 0.4, ey + 0.6, zb + 3.0), (ex + 0.4, ey + 0.6, top)], 0.02)], b1, ST["fa"], None, "CABLESEGMENT"); link(riser_fa, FACP, "화재감지")
riser_comm = make("IfcCableSegment", "통신 간선 (광케이블 입상)", [pipe([(3.5, 13.0, zb + 2.0), (3.5, 13.0, zb + 3.05), (ex + 0.4, ey - 0.6, zb + 3.05), (ex + 0.4, ey - 0.6, top)], 0.02)], b1, ST["comm"], None, "FIBERSEGMENT"); link(MDF, riser_comm, "통신")
riser_ws = make("IfcPipeSegment", "급수 입상관", [pipe([(px - 0.3, py, z2 + 3.0), (px - 0.3, py, top)], 0.05)], b2, ST["ws"], None, "RIGIDSEGMENT"); link(WS_B1, riser_ws, "급수"); link(riser_ws, riser_ws_top, "급수")
riser_hw = make("IfcPipeSegment", "급탕 입상관 (하향)", [pipe([(px - 0.5, py, RF + 0.8), (px - 0.5, py, z2 + 3.1)], 0.04)], rf, ST["hw"], None, "RIGIDSEGMENT"); link(HW_RF, riser_hw, "급탕")
riser_fp = make("IfcPipeSegment", "소화 입상관", [pipe([(px + 0.3, py, z2 + 3.1), (px + 0.3, py, top)], 0.065)], b2, ST["fp"], None, "RIGIDSEGMENT"); link(FP_B1, riser_fp, "소방")
riser_ww = make("IfcPipeSegment", "배수 입상관", [pipe([(px, py - 0.3, top), (px, py - 0.3, z2 + 0.3)], 0.075)], b2, ST["ww"], None, "RIGIDSEGMENT"); link(riser_ww, WW_B1, "배수")
# 수송
ELEV = make("IfcTransportElement", "EL-1 승객용 엘리베이터 15인승", [box(ELV[0] + 0.3, ELV[1] + 0.3, z2, ELV[2] - 0.6, ELV[3] - 0.6, RF - z2 + 1.5)], b2, ST["trans"], None, "ELEVATOR", {"Status": "NORMAL", "Floor": "1F", "Direction": "IDLE", "RunCount": 184320})
# 에스컬레이터: 1F 로비 → 2F 식당·회의 층 (업무동엔 드문 장비지만 계통 예시로 유지). 1F(z=0) y=7.5 → 2F(z=3.5) y=13.5, 경사 30°. 상·하행 2대. 2F 슬래브 개구부(머리 높이 2.1m 확보 지점부터)
ESC_RUN, ESC_RISE, ESC_Y = 6.0, H, 7.5
esc_items = []
for x in (2.0, 3.4):
    esc_items += [ramp(x, ESC_Y, -0.3, 1.2, 0.8, ESC_RUN, ESC_RISE),                       # 트러스(디딤판 포함, 두께 0.4)
                  ramp(x, ESC_Y, 0.9, 0.06, 0.8, ESC_RUN, ESC_RISE), ramp(x + 1.14, ESC_Y, 0.9, 0.06, 0.8, ESC_RUN, ESC_RISE),   # 양쪽 난간
                  box(x, ESC_Y - 1.2, 0.0, 1.2, 1.2, 0.05), box(x, ESC_Y + ESC_RUN + 0.8, ESC_RISE, 1.2, 1.0, 0.05)]           # 하부·상부 랜딩
ESC = make("IfcTransportElement", "ES-1 에스컬레이터 1F↔2F", esc_items, S("1F-A"), ST["trans"], None, "ESCALATOR", {"Status": "RUNNING"})
esc_y0 = ESC_Y + ESC_RUN * (ESC_RISE - 2.1) / ESC_RISE
void(slabs["2F"], 1.7, esc_y0, H - 0.25, 3.2, ESC_Y + ESC_RUN + 1.8 - esc_y0, 0.3, "2F 에스컬레이터 개구부")
DW = make("IfcTransportElement", "DW-1 덤웨이터 (2F 식당용)", [box(ELV[0] - 1.2, ELV[1] + 0.6, 0.0, 0.9, 0.9, top - 0.0)], storeys["1F"], ST["trans"], None, "ELEVATOR", {"Status": "NORMAL"})
for n_ in ("2F", "3F"): void(slabs[n_], ELV[0] - 1.2, ELV[1] + 0.6, storeys[n_].Elevation - 0.25, 0.9, 0.9, 0.3, f"{n_} 덤웨이터 개구부")
for m in (ELEV, ESC, DW): link(EMDB if m is ELEV else MDB, m, "수송")
ELMR = make("IfcElectricDistributionBoard", "EL-1 기계실 제어반", [box(ELV[0], ELV[1] - 0.8, RF, 1.0, 0.5, 1.6)], S("RF-옥상"), ST["trans"], None, "DISTRIBUTIONBOARD", {"Status": "NORMAL"}); link(ELMR, ELEV, "수송"); link(EMDB, ELMR, "비상전원")

# ---------- 지하 주차장 (B1·B2): 분전반·통신·조명·감지·준비작동식 스프링클러·소화전·환기 + 주차관제(수송팀) ----------
PLP, PIDF = {}, {}
for name, z, lights, dets, sprs in (("B1", zb, [(4, 3), (4, 6.5), (10, 6.5), (24, 2), (30, 2), (24, 11), (30, 11), (33, 14)], [(4, 4), (4, 10), (26, 6), (32, 12)], [(4, 3), (7, 3), (24, 3), (30, 3), (24, 12), (30, 12), (3, 6), (15, 6), (27, 6), (33, 9)]),
                                    ("B2", z2, [(4, 8), (10, 12), (16, 12), (24, 8), (33, 8)], [(4, 8), (10, 12), (25, 8), (32, 12)], [(8, 12), (14, 12), (18, 12), (23, 14), (27, 14), (33, 14)])):
    st = storeys[name]
    LP = make("IfcElectricDistributionBoard", f"LP-{name} 지하 분전반", [box(EPS[0] + 0.2, EPS[1] + 0.3, z + 0.8, 0.6, 0.25, 1.0)], st, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 380.0, "RatedCurrent": 150.0}}, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 28.0}); link(MDB, LP, "전기"); PLP[name] = LP
    ELP = make("IfcElectricDistributionBoard", f"ELP-{name} 지하 비상분전반", [box(EPS[0] + 0.2, EPS[1] + 1.2, z + 0.8, 0.4, 0.25, 0.6)], st, ST["em"], None, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED"}); link(EMDB, ELP, "비상전원")
    IDF = make("IfcCommunicationsAppliance", f"IDF-{name} 지하 통신단자함", [box(EPS[0] + 0.7, EPS[1] + 0.3, z + 1.6, 0.4, 0.2, 0.6)], st, ST["comm"], None, "NETWORKHUB", {"Status": "ONLINE"}); link(MDF, IDF, "통신"); PIDF[name] = IDF
    RPT = make("IfcUnitaryControlElement", f"RPT-{name} 지하 중계기", [box(EPS[0] + 0.7, EPS[1] + 1.2, z + 1.6, 0.3, 0.15, 0.3)], st, ST["fa"], None, "ALARMPANEL", {"Status": "NORMAL"}); link(RPT, FACP, "화재감지")
    for i, (lx, ly) in enumerate(lights):
        L = make("IfcLightFixture", f"{name} 주차장 조명 {i + 1}", [box(lx - 0.6, ly - 0.15, z + H - 0.35, 1.2, 0.3, 0.08)], st, ST["light"], None, "POINTSOURCE", {"Status": "NORMAL", "On": True}); link(LP, L, "전기")
    for i, (lx, ly) in enumerate([(12, 6.5), (22, 6.5)]):
        EL = make("IfcLightFixture", f"{name} 주차장 비상조명 {i + 1}", [box(lx - 0.15, ly - 0.15, z + 2.4, 0.3, 0.3, 0.15)], st, ST["em"], None, "EMERGENCY", {"Status": "NORMAL", "BatteryLevel": 100.0}); link(ELP, EL, "비상전원")
    for i, (hx, hy) in enumerate(dets):
        DET = make("IfcSensor", f"{name} 열감지기 {i + 1}", [cyl(hx, hy, z + H - 0.4, 0.06, 0.05), sb.sphere(radius=0.07, center=V(hx, hy, z + H - 0.4))], st, ST["fa"], None, "HEATSENSOR", {"Status": "NORMAL", "LastTest": "2026-07-15"}); link(DET, RPT, "화재감지")
    PAV = make("IfcValve", f"PAV-{name} 준비작동식 알람밸브", [box(px + 0.15, py + 0.5, z + 1.0, 0.3, 0.3, 0.3)], st, ST["fp"], None, "ISOLATION", {"Status": "NORMAL", "Open": False, "Pressure": 0.55}); link(riser_fp, PAV, "소방"); link(RPT, PAV, "화재감지")
    main_ = make("IfcPipeSegment", f"{name} 스프링클러 주관", [pipe([(px + 0.3, py + 0.5, z + 3.2), (2, py + 0.5, z + 3.2)], 0.05), pipe([(px + 0.3, py + 0.5, z + 3.2), (W - 2, py + 0.5, z + 3.2)], 0.05)], st, ST["fp"], None, "RIGIDSEGMENT"); link(PAV, main_, "소방")
    for i, (sx, sy) in enumerate(sprs):
        SPR = make("IfcFireSuppressionTerminal", f"{name} 주차장 스프링클러 {i + 1}", [pipe([(sx, py + 0.5, z + 3.2), (sx, sy, z + 3.2), (sx, sy, z + H - 0.3)], 0.015), sb.sphere(radius=0.08, center=V(sx, sy, z + H - 0.3))], st, ST["fp"], None, "SPRINKLER"); link(main_, SPR, "소방")
    for i, (hx, hy) in enumerate([(PS[0] - 0.7, PS[1] + 0.2), (33.0, 6.0)]):
        HC = make("IfcFireSuppressionTerminal", f"HC-{name} 옥내소화전 {i + 1}", [box(hx, hy, z, 0.6, 0.25, 1.6)], st, ST["fp"], None, "HOSEREEL", {"Status": "NORMAL"}); link(riser_fp, HC, "소방")
CO = make("IfcSensor", "CO-B1 일산화탄소 센서", [box(17.0, 6.5, zb + 1.5, 0.15, 0.1, 0.2)], b1, ST["vent"], None, "GASSENSOR", {"Status": "NORMAL", "COppm": 8}); link(PIDF["B1"], CO, "통신"); link(CO, JF, "환기")
for i, ex_ in enumerate((1.2, 3.7)):
    EVC = make("IfcOutlet", f"EV-{i + 1} 전기차 충전기 7kW", [box(ex_, 0.3, zb, 0.4, 0.3, 1.5)], S("B1-주차A"), ST["el"], None, "POWEROUTLET", {"Status": "NORMAL", "Charging": i == 0}); link(PLP["B1"], EVC, "전기")
# 주차관제: PCS(서버, B1 주차관제실) → 차단기·LPR·정산기(B1 진입부)·만공차 표시(지상 램프 입구)·주차면 센서
PCS = make("IfcController", "PCS-1 주차관제 서버", [box(7.5, 12.5, zb, 0.6, 0.8, 1.8)], S("B1-주차관제실"), ST["park"], None, "PROGRAMMABLE", {"Status": "ONLINE", "Capacity": 14, "Occupied": 9, "TodayIn": 142, "TodayOut": 131}); link(PIDF["B1"], PCS, "통신"); link(PLP["B1"], PCS, "전기")
def barrier(tag, name, x, arm_dx, status):
    return make("IfcActuator", f"{tag} {name}", [box(x, 14.8, zb, 0.4, 0.4, 1.0), box(min(x + 0.4, x + 0.4 + arm_dx), 14.95, zb + 0.9, abs(arm_dx), 0.08, 0.08)], S("B1-주차B"), ST["park"], None, "ELECTRICACTUATOR", status)
BG_IN = barrier("BG-IN", "입구 차단기", 30.3, 2.3, {"Status": "NORMAL", "Open": False, "Cycles": 41230})
BG_OUT = barrier("BG-OUT", "출구 차단기", 35.0, -2.3, {"Status": "FAULT", "Open": True, "Cycles": 39871})   # 예시: 출구 차단기 장애(열림 고착)
LPR_IN = make("IfcAudioVisualAppliance", "LPR-IN 입구 차번인식 카메라", [sb.sphere(radius=0.12, center=V(31.5, 13.6, zb + 2.4))], S("B1-주차B"), ST["park"], None, "CAMERA", {"Status": "ONLINE"})
LPR_OUT = make("IfcAudioVisualAppliance", "LPR-OUT 출구 차번인식 카메라", [sb.sphere(radius=0.12, center=V(34.3, 13.6, zb + 2.4))], S("B1-주차B"), ST["park"], None, "CAMERA", {"Status": "ONLINE"})
PAY = make("IfcElectricAppliance", "PAY-1 무인정산기", [box(30.3, 12.5, zb, 0.5, 0.6, 1.6)], S("B1-주차B"), ST["park"], None, "VENDINGMACHINE", {"Status": "ONLINE", "CashLevel": 62.0})
DISP = make("IfcAudioVisualAppliance", "DISP-1 만공차 표시판 (지상 램프 입구)", [box(4.5, 20.4, 2.0, 1.2, 0.1, 0.5)], storeys["1F"], ST["park"], None, "DISPLAY", {"Status": "ONLINE", "Text": "여유 5"})
for m in (BG_IN, BG_OUT, LPR_IN, LPR_OUT, PAY, DISP): link(PCS, m, "주차관제")
spots = [("B1-주차A", 1.0 + 2.5 * i, 0.5, zb) for i in range(3)] + [("B1-주차B", 21.5 + 2.5 * i, 4.0, zb) for i in range(4)] + [("B1-주차B", 21.5 + 2.5 * i, 9.5, zb) for i in range(3)] \
      + [("B2-주차C", x, 9.5, z2) for x in (7.5, 13.2, 15.7, 18.1)]
for i, (zone, sx, sy, sz) in enumerate(spots):
    occ = i % 3 != 1
    PS_ = make("IfcSensor", f"P-{zone[:2]}{i + 1:02d} 주차면 센서", [box(sx + 0.1, sy + 0.1, sz, 2.3, 4.8, 0.02), cyl(sx + 1.25, sy + 2.5, sz + H - 0.4, 0.06, 0.05)], S(zone), ST["park"] if occ else ST["mark"], None, "MOVEMENTSENSOR", {"Status": "NORMAL", "Occupied": occ}); link(PCS, PS_, "주차관제")

# ---------- 층별 ----------
det_status = {("2F", "B", 0): ("ALARM", "2026-08-28T13:42"), ("3F", "A", 3): ("FAULT", None)}
for name, z in FLOORS[2:]:
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
    FPB = make("IfcPipeSegment", f"{name} 스프링클러 주관", [pipe([(px + 0.3, py + 0.5, z + 3.2), (2, py + 0.5, z + 3.2)], 0.04), pipe([(px + 0.3, py + 0.5, z + 3.2), (W - 2, py + 0.5, z + 3.2)], 0.04)], st, ST["fp"], None, "RIGIDSEGMENT"); link(AV, FPB, "소방")
    CHWB = make("IfcPipeSegment", f"{name} 냉온수 분기관", [pipe([(px + 0.5, py + 0.5, z + 3.05), (px + 0.5, 6.0, z + 3.05), (2, 6.0, z + 3.05)], 0.035), pipe([(px + 0.5, 6.0, z + 3.05), (W - 2, 6.0, z + 3.05)], 0.035)], st, ST["chw"], None, "RIGIDSEGMENT"); link(riser_chw, CHWB, "냉난방수")
    HC = make("IfcFireSuppressionTerminal", f"HC-{name} 옥내소화전", [box(PS[0] - 0.7, PS[1] + 0.2, z, 0.6, 0.25, 1.6)], st, ST["fp"], None, "HOSEREEL", {"Status": "NORMAL"}); link(riser_fp, HC, "소방")
    SPK = make("IfcAudioVisualAppliance", f"{name} 비상방송 스피커", [box(EPS[0] - 0.5, EPS[1] + 0.8, z + 2.6, 0.25, 0.15, 0.25)], st, ST["comm"], None, "SPEAKER", {"Status": "ONLINE"}); link(PA, SPK, "화재감지")
    CAM = make("IfcAudioVisualAppliance", f"CCTV-{name} 복도 카메라", [sb.sphere(radius=0.12, center=V(ELV[0] - 0.5, ELV[1] - 0.3, z + 3.0))], st, ST["comm"], None, "CAMERA", {"Status": "ONLINE"}); link(IDF, CAM, "통신")
    ACR = make("IfcUnitaryControlElement", f"ACR-{name} 출입 카드리더", [box(ELV[0] + ELV[2] + 0.3, ELV[1] - 0.2, z + 1.2, 0.1, 0.1, 0.15)], st, ST["comm"], None, "CONTROLPANEL", {"Status": "ONLINE"}); link(IDF, ACR, "통신"); link(ACS, ACR, "통신")
    for zname, x0, x1 in (("A", 0.0, 13.0), ("B", 20.6, W)):
        sp = spaces[f"{name}-{zname}"]; a = zname == "A"
        tx0, tx1 = (ex - 0.15, x0 + 1.0) if a else (ex + 0.15, x1 - 1.0)
        tray = make("IfcCableCarrierSegment", f"{name}-{zname} 트레이", [box(min(tx0, tx1), ey - 0.1, z + 3.05, abs(tx1 - tx0), 0.2, 0.1)], sp, ST["tray"], None, "CABLETRAYSEGMENT"); link(LP, tray, "전기")
        ZP = make("IfcElectricDistributionBoard", f"LP-{name}-{zname} 구역 분전반", [box(x0 + 0.3 if a else x1 - 0.55, ey - 0.3, z + 1.2, 0.25, 0.6, 0.8)], sp, ST["el"], {"Pset_ElectricalDeviceCommon": {"RatedVoltage": 220.0, "RatedCurrent": 100.0}}, "DISTRIBUTIONBOARD", {"Status": "NORMAL", "Breaker": "CLOSED", "LoadPercent": 22.0}); link(tray, ZP, "전기")
        for i, (lx, ly) in enumerate([(x0 + 3, 3), (x0 + 3, 11), (x0 + 9, 3), (x0 + 9, 11)] if a else [(x0 + 3, 3), (x0 + 3, 11), (x0 + 10, 3), (x0 + 10, 11)]):
            L = make("IfcLightFixture", f"{name}-{zname} 조명 {i + 1}", [box(lx - 0.6, ly - 0.15, z + H - 0.35, 1.2, 0.3, 0.08)], sp, ST["light"], None, "POINTSOURCE", {"Status": "NORMAL", "On": True}); link(ZP, L, "전기"); link(LCP, L, "전기")
        for i, (lx, ly) in enumerate([(x0 + 1.0, 8.0), (x1 - 1.0, 8.0)]):
            EL = make("IfcLightFixture", f"{name}-{zname} 비상조명 {i + 1}", [box(lx - 0.15, ly - 0.15, z + 2.4, 0.3, 0.3, 0.15)], sp, ST["em"], None, "EMERGENCY", {"Status": "NORMAL", "BatteryLevel": 100.0}); link(ELP, EL, "비상전원")
        for i, (dxx, dyy, kind) in enumerate([(x0 + 3, 5.5, "SMOKE"), (x0 + 3, 10.5, "SMOKE"), (x0 + 9, 5.5, "SMOKE"), (x0 + 9, 10.5, "HEAT")] if a else [(x0 + 3, 5.5, "SMOKE"), (x0 + 3, 10.5, "SMOKE"), (x0 + 10, 5.5, "SMOKE"), (x0 + 10, 10.5, "HEAT")]):
            status, at = det_status.get((name, zname, i), ("NORMAL", None))
            DET = make("IfcSensor", f"{name}-{zname} {'연기' if kind == 'SMOKE' else '열'}감지기 {i + 1}", [cyl(dxx, dyy, z + H - 0.4, 0.06, 0.05), sb.sphere(radius=0.07, center=V(dxx, dyy, z + H - 0.4))], sp, ST["fa"], None, "SMOKESENSOR" if kind == "SMOKE" else "HEATSENSOR", {"Status": status, "AlarmAt": at or "", "LastTest": "2026-07-15"}); link(DET, RPT, "화재감지")
        vx = x0 + 2.5 if a else x1 - 2.5
        VL = make("IfcValve", f"V-{name}-{zname} 구역 급수밸브", [box(vx - 0.15, 2.85, z + 2.85, 0.3, 0.3, 0.3)], sp, ST["ws"], None, "ISOLATION", {"Status": "NORMAL", "Open": True}); link(WSB, VL, "급수")
        for i in range(2):
            fx = vx + (i * 1.5 if a else -i * 1.5)
            SAN = make("IfcSanitaryTerminal", f"{name}-{zname} 위생기구 {i + 1}", [box(fx - 0.3, 0.4, z, 0.6, 0.7, 0.4), pipe([(fx, 0.7, z + 0.4), (fx, 3.0, z + 3.0)], 0.02), pipe([(fx, 0.75, z), (fx, 13.0, z + 0.15)], 0.03)], sp, ST["ws"], None, "TOILETPAN"); link(VL, SAN, "급수"); link(SAN, WWB, "배수"); link(HWSB, SAN, "급탕")
        for i, (sx, sy) in enumerate([(x0 + 2 + j * 4.5, yy) for yy in (4, 12) for j in range(3)] if a else [(x0 + 2 + j * 4.5, yy) for yy in (4, 12) for j in range(3)]):
            SPR = make("IfcFireSuppressionTerminal", f"{name}-{zname} 스프링클러 {i + 1}", [pipe([(sx, py + 0.5, z + 3.2), (sx, sy, z + 3.2), (sx, sy, z + H - 0.3)], 0.015), sb.sphere(radius=0.08, center=V(sx, sy, z + H - 0.3))], sp, ST["fp"], None, "SPRINKLER"); link(FPB, SPR, "소방")
        # 공조: 풍량댐퍼 → VAV(구역) → 덕트 → 디퓨저 4 / FCU 2 (냉온수)
        vav = make("IfcAirTerminalBox", f"VAV-{name}-{zname}", [box((x0 + 1.5) if a else (x1 - 2.5), dy - 0.4, z + 3.0, 1.0, 0.8, 0.35)], sp, ST["hvac"], None, "VARIABLEFLOWPRESSUREDEPENDANT", {"Status": "NORMAL", "DamperPercent": 55.0, "RoomTemp": 24.1}); link(HB, vav, "공조"); link(DDC, vav, "통신")
        bd = make("IfcDuctSegment", f"{name}-{zname} 급기 덕트", [box(min(x0 + 2.5, x1 - 2.5) if a else x0 + 1.5, dy - 0.3, z + 3.05, (x1 - x0) - 4.0, 0.6, 0.3)], sp, ST["duct"], None, "RIGIDSEGMENT"); link(vav, bd, "공조")
        for i, (ax, ay) in enumerate([(x0 + 4, 4.5), (x0 + 4, 11.5), (x0 + 9, 4.5), (x0 + 9, 11.5)]):
            dif = make("IfcAirTerminal", f"{name}-{zname} 디퓨저 {i + 1}", [box(ax - 0.3, ay - 0.3, z + H - 0.32, 0.6, 0.6, 0.05)], sp, ST["hvac"], None, "DIFFUSER"); link(bd, dif, "공조")
        for i, (fx2, fy2) in enumerate([(x0 + 1.5, 4.0), (x0 + 1.5, 12.0)] if a else [(x1 - 1.5, 4.0), (x1 - 1.5, 12.0)]):
            fcu = make("IfcUnitaryEquipment", f"FCU-{name}-{zname}-{i + 1} 팬코일", [box(fx2 - 0.5, fy2 - 0.25, z + 2.8, 1.0, 0.5, 0.3)], sp, ST["hvac"], None, "AIRCONDITIONINGUNIT", {"Status": "RUNNING", "SetTemp": 24.0, "FanSpeed": "MED"}); link(CHWB, fcu, "냉난방수"); link(ZP, fcu, "전기"); link(DDC, fcu, "통신")

f.write(sys.argv[1] if len(sys.argv) > 1 else "mep-building.ifc")
n = {c: len(f.by_type(c)) for c in ("IfcElement", "IfcSpace", "IfcDistributionSystem", "IfcRelConnectsElements", "IfcSensor")}
print("written:", n)
