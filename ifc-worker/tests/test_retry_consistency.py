"""재변환·재시도 때 데이터가 안 깨지는지 — 소스 문자열이 아니라 동작으로 확인한다."""
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

# 무거운 의존성 없이 돌기 위한 스텁 (test_job_lease 와 같은 방식)
for name, attrs in (("psycopg", {"connect": MagicMock(), "Connection": object}), ("minio", {"Minio": MagicMock})):
    if name not in sys.modules:
        try:
            __import__(name)
        except ImportError:
            mod = types.ModuleType(name); mod.__dict__.update(attrs); sys.modules[name] = mod
            if name == "psycopg":
                sys.modules["psycopg.types"] = types.ModuleType("psycopg.types")
                sys.modules["psycopg.types.json"] = j = types.ModuleType("psycopg.types.json"); j.Jsonb = lambda v: v
for dependency in ("worker.convert", "worker.extract", "worker.georef"):   # ifcopenshell 없는 환경에서만 스텁
    try:
        __import__(dependency)
    except ImportError:
        sys.modules[dependency] = types.ModuleType(dependency)

from worker import main  # noqa: E402


class RetryConsistencyTest(unittest.TestCase):
    def test_element_upsert_keeps_id_and_deletes_only_missing(self):
        """같은 GlobalId 는 UPDATE (id 유지 → asset.element_id 보존), 새 IFC 에 없는 요소만 삭제"""
        sql = " ".join(main.UPSERT_ELEMENT.split())
        self.assertIn("ON CONFLICT (model_id, global_id) DO UPDATE", sql)
        self.assertNotIn(" id =", sql.split("DO UPDATE")[1])
        self.assertIn("NOT (global_id = ANY(%s))", main.DELETE_MISSING_ELEMENTS)

    def test_lost_lease_never_publishes_and_removes_its_own_glb(self):
        """lease 를 잃은 워커: model/conversion_job 은 손대지 않고, 자기 lease 키의 glb 만 지운다"""
        conn = MagicMock()
        conn.execute.return_value.fetchone.side_effect = [("ifc/x.ifc",), None]   # ifc_key 조회 → lease 재확인 실패
        conn.transaction.return_value.__enter__.return_value = None
        s3 = MagicMock()
        f = MagicMock(schema="IFC4"); f.by_type.return_value = []
        stubs = dict(Minio=MagicMock(return_value=s3), Heartbeat=MagicMock(),
                     conv=MagicMock(to_glb=MagicMock(return_value=(0, None))),
                     georef=MagicMock(read=MagicMock(return_value=None), footprint_wkt=MagicMock(return_value=None)),
                     extract=MagicMock(spatial_tree=MagicMock(return_value=[]), elements=MagicMock(return_value=[]),
                                       systems=MagicMock(return_value=[]), connections=MagicMock(return_value=[])))
        with patch.multiple(main, **stubs), patch.dict(sys.modules, {"ifcopenshell": MagicMock(open=MagicMock(return_value=f))}):
            with self.assertRaises(main.LeaseLost):
                main.convert(conn, 7, "model-1", "owner-b")

        s3.remove_object.assert_called_once_with(main.BUCKET, "glb/model-1/owner-b.glb")
        writes = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
        self.assertNotIn("status='READY'", writes)
        self.assertNotIn("status='DONE'", writes)


if __name__ == "__main__":
    unittest.main()
