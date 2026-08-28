"""IFC → spatial_node / element rows. 실행: python -m worker.extract in.ifc"""
import sys

import ifcopenshell
import ifcopenshell.util.element as ue

SPATIAL = ("IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace")


def spatial_tree(f):
    """[(global_id, parent_global_id|None, ifc_class, name, elevation)] 부모가 항상 먼저."""
    rows = []

    def walk(obj, parent):
        for rel in obj.IsDecomposedBy or ():
            for child in rel.RelatedObjects:
                if child.is_a() in SPATIAL:
                    rows.append((child.GlobalId, parent, child.is_a(), child.Name, getattr(child, "Elevation", None)))
                    walk(child, child.GlobalId)

    for proj in f.by_type("IfcProject"):
        walk(proj, None)
    return rows


def elements(f):
    """[(global_id, ifc_class, name, container_global_id|None, properties)]"""
    rows = []
    for el in f.by_type("IfcElement"):
        if el.is_a("IfcOpeningElement"):
            continue
        psets = {k: {p: v for p, v in props.items() if p != "id"} for k, props in ue.get_psets(el).items()}
        c = ue.get_container(el)
        rows.append((el.GlobalId, el.is_a(), el.Name, c.GlobalId if c else None, psets))
    return rows


if __name__ == "__main__":
    f = ifcopenshell.open(sys.argv[1])
    sp, el = spatial_tree(f), elements(f)
    assert sp and el and sp[0][1] is None
    ids = {r[0] for r in sp}
    assert all(r[1] in ids for r in sp[1:]), "child before parent"
    print(f"{f.schema}: {len(sp)} spatial nodes, {len(el)} elements, "
          f"{sum(1 for r in el if r[3] not in ids)} without container")
    for r in sp[:6]:
        print("  ", r[2], r[3], r[4])
