"""IfcRelConnectsPorts → 방향 연결 변환 (실무 IFC 호환). ifcopenshell 필요 — 컨테이너에서 실행."""
import unittest

try:
    import ifcopenshell
    import ifcopenshell.guid
except ImportError:  # 로컬(맥)엔 ifcopenshell 없음 — 컨테이너에서만 돈다
    ifcopenshell = None

from worker import extract


def g():
    return ifcopenshell.guid.new()


@unittest.skipIf(ifcopenshell is None, "ifcopenshell not installed")
class PortConnectionsTest(unittest.TestCase):
    def _elem(self, f, cls, name):
        return f.create_entity(cls, GlobalId=g(), Name=name)

    def _port(self, f, host, flow, ifc4=True):
        p = f.create_entity("IfcDistributionPort", GlobalId=g(), FlowDirection=flow)
        if ifc4:
            f.create_entity("IfcRelNests", GlobalId=g(), RelatingObject=host, RelatedObjects=[p])
        else:
            f.create_entity("IfcRelConnectsPortToElement", GlobalId=g(), RelatingPort=p, RelatedElement=host)
        return p

    def test_ifc4_ports_flow_direction_decides_upstream(self):
        f = ifcopenshell.file(schema="IFC4")
        pump, pipe = self._elem(f, "IfcPump", "P-1"), self._elem(f, "IfcPipeSegment", "PS-1")
        src, snk = self._port(f, pump, "SOURCE"), self._port(f, pipe, "SINK")
        # 일부러 Relating=SINK 쪽으로 뒤집어 연결 — FlowDirection 이 이겨야 한다
        f.create_entity("IfcRelConnectsPorts", GlobalId=g(), RelatingPort=snk, RelatedPort=src)
        self.assertEqual(extract.connections(f), [(pump.GlobalId, pipe.GlobalId)])

    def test_ifc2x3_port_to_element_and_default_direction(self):
        f = ifcopenshell.file(schema="IFC2X3")
        fan, duct = self._elem(f, "IfcFlowMovingDevice", "F-1"), self._elem(f, "IfcFlowSegment", "D-1")
        pa = self._port(f, fan, "NOTDEFINED", ifc4=False)
        pb = self._port(f, duct, "NOTDEFINED", ifc4=False)
        f.create_entity("IfcRelConnectsPorts", GlobalId=g(), RelatingPort=pa, RelatedPort=pb)
        self.assertEqual(extract.connections(f), [(fan.GlobalId, duct.GlobalId)])   # 애매하면 Relating→Related

    def test_duplicate_pairs_and_orphan_ports_skipped(self):
        f = ifcopenshell.file(schema="IFC4")
        a, b = self._elem(f, "IfcPump", "A"), self._elem(f, "IfcPipeSegment", "B")
        for _ in range(2):   # 같은 장비 쌍에 포트 연결 2개 (급수·환수 등) → 1건
            f.create_entity("IfcRelConnectsPorts", GlobalId=g(),
                            RelatingPort=self._port(f, a, "SOURCE"), RelatedPort=self._port(f, b, "SINK"))
        orphan = f.create_entity("IfcDistributionPort", GlobalId=g(), FlowDirection="SOURCE")   # 호스트 없음
        f.create_entity("IfcRelConnectsPorts", GlobalId=g(), RelatingPort=orphan, RelatedPort=self._port(f, b, "SINK"))
        self.assertEqual(extract.connections(f), [(a.GlobalId, b.GlobalId)])

    def test_rel_connects_elements_still_first(self):
        f = ifcopenshell.file(schema="IFC4")
        a, b = self._elem(f, "IfcPump", "A"), self._elem(f, "IfcTank", "B")
        f.create_entity("IfcRelConnectsElements", GlobalId=g(), RelatingElement=a, RelatedElement=b)
        # 포트로도 같은 쌍 — 중복되면 안 된다
        f.create_entity("IfcRelConnectsPorts", GlobalId=g(),
                        RelatingPort=self._port(f, a, "SOURCE"), RelatedPort=self._port(f, b, "SINK"))
        self.assertEqual(extract.connections(f), [(a.GlobalId, b.GlobalId)])


@unittest.skipIf(ifcopenshell is None, "ifcopenshell not installed")
class DerivedSystemsTest(unittest.TestCase):
    """IfcSystem 이 없을 때 Pset 'System Classification' 값별 계통 유도."""

    def _elem(self, f, name, sc=None):
        el = f.create_entity("IfcPipeSegment", GlobalId=g(), Name=name)
        if sc is not None:
            ps = f.create_entity("IfcPropertySet", GlobalId=g(), Name="Mechanical", HasProperties=[
                f.create_entity("IfcPropertySingleValue", Name="System Classification", NominalValue=f.create_entity("IfcLabel", sc))])
            f.create_entity("IfcRelDefinesByProperties", GlobalId=g(), RelatedObjects=[el], RelatingPropertyDefinition=ps)
        return el

    def test_derives_groups_with_multivalue_and_type_mapping(self):
        f = ifcopenshell.file(schema="IFC4")
        a = self._elem(f, "A", "Sanitary")
        b = self._elem(f, "B", "Domestic Cold Water,Sanitary")
        self._elem(f, "C", "Undefined,Other")   # 제외 값만 → 계통 없음
        sys = extract.systems(f)
        self.assertEqual([(gid, n, t, sorted(m)) for gid, n, t, m in sys], [
            ("derived-domestic-cold-water", "Domestic Cold Water", "DOMESTICCOLDWATER", [b.GlobalId]),
            ("derived-sanitary", "Sanitary", "WASTEWATER", sorted([a.GlobalId, b.GlobalId])),
        ])

    def test_real_ifcsystem_suppresses_derivation(self):
        f = ifcopenshell.file(schema="IFC4")
        el = self._elem(f, "A", "Sanitary")
        s = f.create_entity("IfcDistributionSystem", GlobalId=g(), Name="급수", PredefinedType="DOMESTICCOLDWATER")
        f.create_entity("IfcRelAssignsToGroup", GlobalId=g(), RelatedObjects=[el], RelatingGroup=s)
        sys = extract.systems(f)
        self.assertEqual(len(sys), 1)
        self.assertEqual(sys[0][1], "급수")   # 진짜 계통이 있으면 유도 안 함

    def test_electrical_load_classification_and_backup_supply(self):
        f = ifcopenshell.file(schema="IFC2X3")
        def elem(name, **props):
            el = f.create_entity("IfcFlowTerminal", GlobalId=g(), Name=name)
            for ps_name, kv in props.items():
                ps = f.create_entity("IfcPropertySet", GlobalId=g(), Name=ps_name, HasProperties=[
                    f.create_entity("IfcPropertySingleValue", Name=k, NominalValue=f.create_entity("IfcLabel", v)) for k, v in kv.items()])
                f.create_entity("IfcRelDefinesByProperties", GlobalId=g(), RelatedObjects=[el], RelatingPropertyDefinition=ps)
            return el
        light = elem("조명", Electrical={"Load Classification": "Lighting - Dwelling Unit"}, Other={"BackupSupplySystem": "YES"})
        outlet = elem("콘센트", Electrical={"Load Classification": "Receptacle"}, Other={"BackupSupplySystem": "NO"})
        fan = elem("팬", Mechanical={"System Classification": "Supply Air"}, Electrical={"Load Classification": "Cooling"})   # 설비 값이 있으면 전기 부하 분류는 안 씀
        sys = {n: (t, sorted(m)) for _, n, t, m in extract.systems(f)}
        self.assertEqual(sys, {"Lighting": ("LIGHTING", [light.GlobalId]), "Emergency Power": ("ELECTRICAL", [light.GlobalId]),
                               "Receptacle": ("ELECTRICAL", [outlet.GlobalId]), "Supply Air": ("AIRCONDITIONING", [fan.GlobalId])})

    def test_hvac_classifications_map_to_standard_types(self):
        self.assertEqual([extract._derived_type(n) for n in ("Supply Air", "Return Air", "Exhaust Air", "Domestic Cold Water")],
                         ["AIRCONDITIONING", "AIRCONDITIONING", "VENTILATION", "DOMESTICCOLDWATER"])


@unittest.skipIf(ifcopenshell is None, "ifcopenshell not installed")
class GenericClassTest(unittest.TestCase):
    """IFC2x3 일반 클래스(IfcFlowTerminal…)는 타입(IfcAirTerminalType…)으로 구체 클래스를 되찾는다."""

    def test_generic_class_refined_by_type(self):
        f = ifcopenshell.file(schema="IFC2X3")
        a = f.create_entity("IfcFlowTerminal", GlobalId=g(), Name="디퓨저")
        t = f.create_entity("IfcAirTerminalType", GlobalId=g(), Name="600x600", PredefinedType="DIFFUSER")
        f.create_entity("IfcRelDefinesByType", GlobalId=g(), RelatedObjects=[a], RelatingType=t)
        b = f.create_entity("IfcFlowSegment", GlobalId=g(), Name="타입 없음")
        c = f.create_entity("IfcWall", GlobalId=g(), Name="벽")   # 일반 클래스가 아니면 타입이 있어도 그대로
        f.create_entity("IfcRelDefinesByType", GlobalId=g(), RelatedObjects=[c], RelatingType=f.create_entity("IfcWallType", GlobalId=g(), PredefinedType="STANDARD"))
        cls = {gid: k for gid, k, *_ in extract.elements(f)}
        self.assertEqual((cls[a.GlobalId], cls[b.GlobalId], cls[c.GlobalId]), ("IfcAirTerminal", "IfcFlowSegment", "IfcWall"))


if __name__ == "__main__":
    unittest.main()
