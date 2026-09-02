"""IFC → spatial_node / element rows. 실행: python -m worker.extract in.ifc"""
import sys

import ifcopenshell
import ifcopenshell.util.element as ue
import ifcopenshell.util.unit as uu

SPATIAL = ("IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace")


def spatial_tree(f):
    """[(global_id, parent_global_id|None, ifc_class, name, elevation[m])] 부모가 항상 먼저.
    실무 IFC(레빗 IFC2x3 등)는 길이 단위가 mm 인 경우가 많다 — elevation 을 m 로 정규화 (기하는 serializer 가 m 로 낸다)."""
    scale = uu.calculate_unit_scale(f)   # 프로젝트 길이 단위 → m
    rows = []

    def walk(obj, parent):
        for rel in obj.IsDecomposedBy or ():
            for child in rel.RelatedObjects:
                if child.is_a() in SPATIAL:
                    elev = getattr(child, "Elevation", None)
                    rows.append((child.GlobalId, parent, child.is_a(), child.Name, None if elev is None else elev * scale))
                    walk(child, child.GlobalId)

    for proj in f.by_type("IfcProject"):
        walk(proj, None)
    return rows


# IFC2x3 는 덕트·조명·콘센트를 IfcFlowTerminal 같은 일반 클래스로 내고 종류는 타입(IfcAirTerminalType 등)에만 남긴다
_GENERIC = {"IfcDistributionElement", "IfcDistributionFlowElement", "IfcDistributionControlElement", "IfcFlowTerminal", "IfcFlowSegment", "IfcFlowFitting",
            "IfcFlowController", "IfcFlowMovingDevice", "IfcFlowStorageDevice", "IfcFlowTreatmentDevice", "IfcEnergyConversionDevice"}


def _concrete_class(el):
    """일반 클래스면 타입 이름으로 구체 클래스를 되찾는다 (IfcFlowTerminal + IfcAirTerminalType → IfcAirTerminal). 타입이 없으면 그대로"""
    cls = el.is_a()
    if cls in _GENERIC:
        t = ue.get_type(el)
        if t is not None and t.is_a().endswith("Type"):
            return t.is_a()[:-4]
    return cls


def elements(f):
    """[(global_id, ifc_class, name, container_global_id|None, properties)]"""
    rows = []
    for el in f.by_type("IfcElement"):
        if el.is_a("IfcOpeningElement"):
            continue
        psets = {k: {p: v for p, v in props.items() if p != "id"} for k, props in ue.get_psets(el).items()}
        c = ue.get_container(el)
        rows.append((el.GlobalId, _concrete_class(el), el.Name, c.GlobalId if c else None, psets))
    return rows


_NOT_A_SYSTEM = {"", "Undefined", "Other", "Global", "Fitting"}
# 레빗 System Classification → IfcDistributionSystemEnum 에 가까운 값 (뷰어 계통 색·아이콘이 이 값을 본다)
_DERIVED_TYPE = {"SANITARY": "WASTEWATER", "HYDRONICSUPPLY": "CHILLEDWATER", "HYDRONICRETURN": "CHILLEDWATER",
                 "POWER": "ELECTRICAL", "VENT": "VENTILATION", "SUPPLYAIR": "AIRCONDITIONING", "RETURNAIR": "AIRCONDITIONING", "EXHAUSTAIR": "VENTILATION"}


def _derived_type(name):
    key = "".join(c for c in name.upper() if c.isalpha())
    return _DERIVED_TYPE.get(key, key)


def systems(f):
    """[(global_id, name, predefined_type, [member global_ids])] — IfcSystem/IfcDistributionSystem 과 IfcRelAssignsToGroup.
    실무 IFC(레빗)는 IfcSystem 없이 Pset 'System Classification' 만 남기는 경우가 많다 — 그때는 그 값별로 계통을 유도한다
    (쉼표 다중값 분리, Undefined 류 제외). 유도 계통의 global_id 는 이름 기반이라 재변환에도 안정적."""
    out = []
    for s in f.by_type("IfcSystem"):
        members = [o.GlobalId for rel in (s.IsGroupedBy or ()) for o in rel.RelatedObjects if o.is_a("IfcElement")]
        out.append((s.GlobalId, s.Name, getattr(s, "PredefinedType", None), members))
    if out:
        return out
    groups = {}
    for el in f.by_type("IfcElement"):
        for props in ue.get_psets(el).values():
            sc = props.get("System Classification")
            if not sc:
                continue
            for name in str(sc).split(","):
                name = name.strip()
                if name and name not in _NOT_A_SYSTEM:
                    groups.setdefault(name, {})[el.GlobalId] = None   # dict = 순서 보존 중복 제거
            break
    return [("derived-" + n.lower().replace(" ", "-"), n, _derived_type(n), list(m)) for n, m in sorted(groups.items())]


def _port_host(port):
    """포트가 붙은 장비. IFC4: IfcRelNests(Nests), IFC2x3(+IFC4 호환): IfcRelConnectsPortToElement(ContainedIn)"""
    for rel in getattr(port, "Nests", None) or ():
        if rel.RelatingObject.is_a("IfcElement"):
            return rel.RelatingObject
    ci = getattr(port, "ContainedIn", None)
    for rel in ci if isinstance(ci, tuple) else (ci,) if ci else ():
        if rel.RelatedElement.is_a("IfcElement"):
            return rel.RelatedElement
    return None


def connections(f):
    """[(from_global_id, to_global_id)] 방향 그래프.
    1) IfcRelConnectsElements — Relating=상류, Related=하류 (gen_mep.py 규약)
    2) IfcRelConnectsPorts — 실무 IFC(레빗 등)의 MEP 연결. 포트 호스트 장비 쌍으로 변환하고,
       방향은 FlowDirection(SOURCE→SINK)으로 정한다. 애매하면 Relating→Related."""
    out = [(r.RelatingElement.GlobalId, r.RelatedElement.GlobalId) for r in f.by_type("IfcRelConnectsElements")
           if r.is_a() == "IfcRelConnectsElements" and r.RelatingElement.is_a("IfcElement") and r.RelatedElement.is_a("IfcElement")]
    seen = set(out)
    for r in f.by_type("IfcRelConnectsPorts"):
        pa, pb = r.RelatingPort, r.RelatedPort
        ha, hb = _port_host(pa), _port_host(pb)
        if ha is None or hb is None or ha == hb:
            continue
        fa, fb = getattr(pa, "FlowDirection", None), getattr(pb, "FlowDirection", None)
        pair = (hb.GlobalId, ha.GlobalId) if fa == "SINK" or fb == "SOURCE" else (ha.GlobalId, hb.GlobalId)
        if pair not in seen and (pair[1], pair[0]) not in seen:   # 같은 쌍 중복(포트 여러 개)·역방향 중복 제거
            seen.add(pair)
            out.append(pair)
    return out


if __name__ == "__main__":
    f = ifcopenshell.open(sys.argv[1])
    sp, el = spatial_tree(f), elements(f)
    assert sp and el and sp[0][1] is None
    ids = {r[0] for r in sp}
    assert all(r[1] in ids for r in sp[1:]), "child before parent"
    sy, co = systems(f), connections(f)
    print(f"{f.schema}: {len(sp)} spatial nodes, {len(el)} elements, "
          f"{sum(1 for r in el if r[3] not in ids)} without container, {len(sy)} systems, {len(co)} connections")
    for g, name, pt, m in sy:
        print("  ", name, pt, len(m), "members")
    for r in sp[:6]:
        print("  ", r[2], r[3], r[4])
