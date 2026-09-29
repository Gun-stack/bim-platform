"""재변환·재시도 때 데이터가 안 깨지는지 — 소스 문자열이 아니라 동작으로 확인한다."""
import sys
import types
import unittest
from unittest.mock import MagicMock, mock_open, patch

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

    def test_lost_lease_never_publishes_and_removes_its_own_glb_and_tiles(self):
        """lease 를 잃은 워커: model/conversion_job 은 손대지 않고, 자기 lease 키의 glb·타일만 지운다"""
        conn = MagicMock()
        conn.execute.return_value.fetchone.side_effect = [("ifc/x.ifc",), None]   # ifc_key 조회 → lease 재확인 실패
        conn.transaction.return_value.__enter__.return_value = None
        s3 = MagicMock()
        f = MagicMock(schema="IFC4"); f.by_type.return_value = []
        tile_keys = ["glb/model-1/tiles/owner-b/tileset.json", "glb/model-1/tiles/owner-b/site.glb"]
        stubs = dict(Minio=MagicMock(return_value=s3), Heartbeat=MagicMock(), publish_tiles=MagicMock(return_value=tile_keys),
                     conv=MagicMock(to_glb=MagicMock(return_value=(0, None))),
                     georef=MagicMock(read=MagicMock(return_value=None), footprint_wkt=MagicMock(return_value=None)),
                     extract=MagicMock(spatial_tree=MagicMock(return_value=[]), elements=MagicMock(return_value=[]),
                                       systems=MagicMock(return_value=[]), connections=MagicMock(return_value=[])))
        with patch.multiple(main, **stubs), patch.dict(sys.modules, {"ifcopenshell": MagicMock(open=MagicMock(return_value=f))}):
            with self.assertRaises(main.LeaseLost):
                main.convert(conn, 7, "model-1", "owner-b")

        self.assertEqual([c.args for c in s3.remove_object.call_args_list], [(main.BUCKET, k) for k in ["glb/model-1/owner-b.glb", *tile_keys]])
        writes = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
        self.assertNotIn("status='READY'", writes)
        self.assertNotIn("status='DONE'", writes)


class PublishTilesTest(unittest.TestCase):
    def test_uploads_tileset_last_and_returns_it_first(self):
        s3 = MagicMock()
        files = {"tileset.json": b"{}", "site.glb": b"g" * 8, "b0s0.glb": b"h" * 4}
        with patch.object(main.tiles, "build", return_value=files), patch("builtins.open", mock_open(read_data=b"glb")):
            keys = main.publish_tiles(s3, "/x.glb", [], [], "glb/m/tiles/l/")
        put = [c.args[1] for c in s3.put_object.call_args_list]
        self.assertEqual(put[-1], "glb/m/tiles/l/tileset.json")   # 공개 진입점은 마지막에 — 중간 실패 시 빈 tileset 이 먼저 보이지 않게
        self.assertEqual(keys[0], "glb/m/tiles/l/tileset.json")
        self.assertEqual(sorted(keys), sorted("glb/m/tiles/l/" + n for n in files))
        types = {c.args[1]: c.kwargs["content_type"] for c in s3.put_object.call_args_list}
        self.assertEqual(types["glb/m/tiles/l/site.glb"], "model/gltf-binary")
        self.assertEqual(types["glb/m/tiles/l/tileset.json"], "application/json")

    def test_failure_is_swallowed_and_partial_uploads_removed(self):
        """타일은 가속 수단 — 실패해도 변환은 READY 로(빈 목록), 올리다 만 객체는 지운다"""
        s3 = MagicMock()
        s3.put_object.side_effect = [None, OSError("minio down")]
        with patch.object(main.tiles, "build", return_value={"a.glb": b"1", "b.glb": b"2", "tileset.json": b"{}"}), \
             patch("builtins.open", mock_open(read_data=b"glb")), self.assertLogs("worker", "ERROR"):
            self.assertEqual(main.publish_tiles(s3, "/x.glb", [], [], "p/"), [])
        s3.remove_object.assert_called_once_with(main.BUCKET, "p/a.glb")


if __name__ == "__main__":
    unittest.main()
