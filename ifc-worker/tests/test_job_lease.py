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

for dependency in ("worker.convert", "worker.extract", "worker.georef"):
    if dependency not in sys.modules:
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

    def test_recovery_uses_latest_heartbeat_and_fails_model(self):
        self.assertIn("COALESCE(heartbeat_at, started_at)", main.RECOVER)
        self.assertIn("UPDATE model m SET status='FAILED'", main.RECOVER)
        self.assertIn("lease_owner = NULL", main.RECOVER)

    def test_every_terminal_write_is_lease_fenced(self):
        self.assertIn("lease_owner=%s", main.FAIL_JOB)
        self.assertIn("lease_owner=%s", main.HEARTBEAT)
        self.assertIn("status='RUNNING'", main.HEARTBEAT)


if __name__ == "__main__":
    unittest.main()
