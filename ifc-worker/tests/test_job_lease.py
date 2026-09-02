import unittest
import sys
import types
from unittest.mock import MagicMock, patch

# Lease tests do not need native IFC or database clients. Keep them runnable in a
# lightweight checkout where the worker image dependencies are not installed.
try:
    import psycopg  # noqa: F401
except ImportError:
    psycopg = types.ModuleType("psycopg")
    psycopg.connect = MagicMock()
    sys.modules["psycopg"] = psycopg
    psycopg_types = types.ModuleType("psycopg.types")
    psycopg_json = types.ModuleType("psycopg.types.json")
    psycopg_json.Jsonb = lambda value: value
    sys.modules["psycopg.types"] = psycopg_types
    sys.modules["psycopg.types.json"] = psycopg_json

try:
    import minio  # noqa: F401
except ImportError:
    minio = types.ModuleType("minio")
    minio.Minio = MagicMock
    sys.modules["minio"] = minio

for dependency in ("worker.convert", "worker.extract", "worker.georef"):   # ifcopenshell 없는 환경에서만 스텁 — 있으면 진짜를 쓴다 (test_ports)
    try:
        __import__(dependency)
    except ImportError:
        sys.modules[dependency] = types.ModuleType(dependency)

from worker import main


class ImmediateEvent:
    """Run exactly one heartbeat iteration, then stop."""
    def wait(self, _seconds):
        return False


class JobLeaseTest(unittest.TestCase):
    def test_heartbeat_is_fenced_by_job_and_owner(self):
        conn = MagicMock()
        conn.__enter__.return_value = conn
        conn.execute.return_value.rowcount = 0
        heartbeat = main.Heartbeat(42, "owner-a")
        heartbeat.stop = ImmediateEvent()

        with patch.object(main.psycopg, "connect", return_value=conn):
            heartbeat._run()

        conn.execute.assert_called_once_with(main.HEARTBEAT, (42, "owner-a"))

    # RECOVER 의 실제 동작은 api 의 ConversionJobIntegrationTests 가 이 파일의 SQL 을 읽어 Postgres 에서 검증한다
    def test_every_terminal_write_is_lease_fenced(self):
        self.assertIn("lease_owner=%s", main.FAIL_JOB)
        self.assertIn("lease_owner=%s", main.HEARTBEAT)
        self.assertIn("status='RUNNING'", main.HEARTBEAT)


if __name__ == "__main__":
    unittest.main()
