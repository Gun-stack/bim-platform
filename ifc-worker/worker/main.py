"""conversion_job 폴링 루프. ADR 0003."""
import logging
import os
import threading
import time
import traceback
import uuid

import psycopg
from minio import Minio
from psycopg.types.json import Jsonb

from . import convert as conv, extract, georef

log = logging.getLogger("worker")
DSN = f"postgresql://bim:{os.environ.get('DB_PASSWORD', 'bim')}@{os.environ.get('DB_HOST', 'localhost')}:5432/bim"
POLL_SEC = 2
STALE = "10 minutes"
HEARTBEAT_SEC = int(os.environ.get("JOB_HEARTBEAT_SEC", "30"))
MAX_ATTEMPTS = 3
S3 = os.environ.get("S3_ENDPOINT", "http://localhost:9000").split("://", 1)[1]
BUCKET = "bim"
PROGRESS_EVERY = 25

CLAIM = """
UPDATE conversion_job
   SET status='RUNNING', started_at=now(), heartbeat_at=now(), attempts=attempts+1,
       lease_owner=%s, error=NULL, finished_at=NULL
 WHERE id = (SELECT id FROM conversion_job WHERE status='PENDING'
             ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id, model_id, lease_owner
"""
# hang·크래시 복구: 매 회전마다. 3회 넘으면 FAILED.
RECOVER = f"""
WITH recovered AS (
  UPDATE conversion_job
     SET status = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END,
         error = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'stale after ' || attempts || ' attempts' END,
         finished_at = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN now() END,
         lease_owner = NULL
   WHERE status='RUNNING'
     AND COALESCE(heartbeat_at, started_at) < now() - interval '{STALE}'
  RETURNING model_id, status
)
UPDATE model m SET status='FAILED'
 WHERE m.id IN (SELECT model_id FROM recovered WHERE status='FAILED')
"""
FAIL_JOB = "UPDATE conversion_job SET status='FAILED', error=%s, finished_at=now() WHERE id=%s AND lease_owner=%s"
FAIL_MODEL = "UPDATE model SET status='FAILED' WHERE id=%s"
HEARTBEAT = "UPDATE conversion_job SET heartbeat_at=now() WHERE id=%s AND status='RUNNING' AND lease_owner=%s"
UPSERT_ELEMENT = """
INSERT INTO element (model_id, global_id, ifc_class, name, spatial_node_id, properties)
VALUES (%s,%s,%s,%s,%s,%s)
ON CONFLICT (model_id, global_id) DO UPDATE SET
  ifc_class = EXCLUDED.ifc_class,
  name = EXCLUDED.name,
  spatial_node_id = EXCLUDED.spatial_node_id,
  properties = EXCLUDED.properties
"""
DELETE_MISSING_ELEMENTS = "DELETE FROM element WHERE model_id=%s AND NOT (global_id = ANY(%s))"


class LeaseLost(RuntimeError):
    pass


class Heartbeat:
    """Long native IFC operations cannot share their connection, so renew on a small side connection."""
    def __init__(self, job_id, lease_owner):
        self.job_id = job_id
        self.lease_owner = lease_owner
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, name=f"heartbeat-{job_id}", daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=HEARTBEAT_SEC + 1)

    def _run(self):
        while not self.stop.wait(HEARTBEAT_SEC):
            try:
                with psycopg.connect(DSN, autocommit=True) as conn:
                    result = conn.execute(HEARTBEAT, (self.job_id, self.lease_owner))
                    if result.rowcount != 1:
                        log.warning("job %s lease lost; heartbeat stopped", self.job_id)
                        return
            except Exception as exc:
                # A transient DB outage must not kill conversion; stale recovery remains the backstop.
                log.warning("job %s heartbeat failed: %s", self.job_id, exc)


def convert(conn, job_id, model_id, lease_owner):
    import tempfile
    s3 = Minio(S3, access_key=os.environ.get("S3_ACCESS_KEY", "minio"), secret_key=os.environ.get("S3_SECRET_KEY", "minio123"), secure=False)
    ifc_key = conn.execute("SELECT ifc_key FROM model WHERE id=%s", (model_id,)).fetchone()[0]
    # A fenced-out worker may still finish native conversion. Never let it overwrite
    # the object referenced by a newer lease; only the winning DB transaction publishes this key.
    glb_key = f"glb/{model_id}/{lease_owner}.glb"  # glb/ 프리픽스만 익명 읽기
    conn.execute("UPDATE model SET status='PROCESSING' WHERE id=%s", (model_id,))
    with tempfile.TemporaryDirectory() as d, Heartbeat(job_id, lease_owner):
        ifc, glb = os.path.join(d, "in.ifc"), os.path.join(d, "out.glb")
        s3.fget_object(BUCKET, ifc_key, ifc)
        import ifcopenshell
        f = ifcopenshell.open(ifc)
        total = max(1, sum(1 for p in f.by_type("IfcProduct") if p.Representation))

        def progress(n):  # 기하 변환을 0~90% 로 본다
            if n % PROGRESS_EVERY == 0:
                conn.execute("UPDATE conversion_job SET progress=%s, heartbeat_at=now() WHERE id=%s AND lease_owner=%s",
                             (min(90, n * 90 // total), job_id, lease_owner))

        _, bbox = conv.to_glb(ifc, glb, progress)
        geo = georef.read(f)
        fp = georef.footprint_wkt(geo, bbox)
        mc = dict(geo or {}, bbox=list(bbox) if bbox else None)   # bbox 는 수동 핀 때 풋프린트 폭으로 씀
        s3.fput_object(BUCKET, glb_key, glb, content_type="model/gltf-binary")
        spatial, elems = extract.spatial_tree(f), extract.elements(f)
        systems, conns = extract.systems(f), extract.connections(f)

    try:
        with conn.transaction():  # 새 GLB와 메타데이터는 이 트랜잭션의 포인터 변경으로 함께 공개한다
            owned = conn.execute("SELECT 1 FROM conversion_job WHERE id=%s AND status='RUNNING' AND lease_owner=%s FOR UPDATE",
                                 (job_id, lease_owner)).fetchone()
            if not owned:
                raise LeaseLost(f"job {job_id} lease was reassigned")
            conn.execute("DELETE FROM connection WHERE model_id=%s", (model_id,))
            conn.execute("DELETE FROM system WHERE model_id=%s", (model_id,))
            # FK의 ON DELETE SET NULL 뒤 같은 GlobalId 요소를 upsert하면 element.id와 asset.element_id가 유지된다.
            conn.execute("DELETE FROM spatial_node WHERE model_id=%s", (model_id,))
            ids = {}
            for gid, parent, cls, name, elev in spatial:
                ids[gid] = conn.execute(
                    "INSERT INTO spatial_node (model_id, parent_id, global_id, ifc_class, name, elevation) "
                    "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                    (model_id, ids.get(parent), gid, cls, name, elev)).fetchone()[0]
            with conn.cursor() as cur:
                cur.executemany(
                    UPSERT_ELEMENT,
                    [(model_id, gid, cls, name, ids.get(c), Jsonb(props)) for gid, cls, name, c, props in elems])
            current_gids = [gid for gid, *_ in elems]
            if current_gids:
                conn.execute(DELETE_MISSING_ELEMENTS, (model_id, current_gids))
            else:
                conn.execute("DELETE FROM element WHERE model_id=%s", (model_id,))
            # 계통·연결 (M6). element id 는 global_id 로 되찾는다
            eid = dict(conn.execute("SELECT global_id, id FROM element WHERE model_id=%s", (model_id,)).fetchall())
            for gid, name, ptype, members in systems:
                sid = conn.execute("INSERT INTO system (model_id, global_id, name, predefined_type) VALUES (%s,%s,%s,%s) RETURNING id",
                                   (model_id, gid, name, ptype)).fetchone()[0]
                with conn.cursor() as cur:
                    cur.executemany("INSERT INTO element_system (element_id, system_id) VALUES (%s,%s) ON CONFLICT DO NOTHING",
                                    [(eid[m], sid) for m in members if m in eid])
            with conn.cursor() as cur:
                cur.executemany("INSERT INTO connection (model_id, from_element_id, to_element_id) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING",
                                [(model_id, eid[a], eid[b]) for a, b in conns if a in eid and b in eid])
            conn.execute("UPDATE model SET status='READY', glb_key=%s, ifc_schema=%s, element_count=%s, map_conversion=%s, "
                         "footprint=CASE WHEN %s::text IS NULL THEN NULL ELSE ST_GeomFromText(%s, 4326) END WHERE id=%s",
                         (glb_key, f.schema, len(elems), Jsonb(mc), fp, fp, model_id))
            conn.execute("UPDATE conversion_job SET status='DONE', progress=100, finished_at=now() WHERE id=%s AND lease_owner=%s",
                         (job_id, lease_owner))
    except LeaseLost:
        # 포인터 변경 전에 lease 검사가 실패했으므로 이 버전은 어떤 model도 참조하지 않는다.
        try:
            s3.remove_object(BUCKET, glb_key)
        except Exception as cleanup_error:
            log.warning("unpublished GLB cleanup failed for %s: %s", glb_key, cleanup_error)
        raise
    log.info("job %s done: %s, %d spatial, %d elements, %d systems, %d connections, georef=%s", job_id, f.schema, len(spatial), len(elems), len(systems), len(conns), geo["source"] if geo else None)


def run_once(conn):
    with conn.transaction():
        conn.execute(RECOVER)
    with conn.transaction():
        row = conn.execute(CLAIM, (uuid.uuid4(),)).fetchone()
    if not row:
        return False
    job_id, model_id, lease_owner = row
    log.info("job %s model %s start", job_id, model_id)
    try:
        convert(conn, job_id, model_id, lease_owner)
    except LeaseLost as exc:
        log.warning("job %s stopped without publishing: %s", job_id, exc)
    except Exception:
        err = traceback.format_exc()[-2048:]
        log.error("job %s failed\n%s", job_id, err)
        with conn.transaction():
            failed = conn.execute(FAIL_JOB, (err, job_id, lease_owner))
            if failed.rowcount == 1:
                conn.execute(FAIL_MODEL, (model_id,))
    return True


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import ifcopenshell
    log.info("ifcopenshell %s, polling %s", ifcopenshell.version, DSN.split("@")[1])
    while True:
        try:
            with psycopg.connect(DSN, autocommit=True) as conn:
                while True:
                    if not run_once(conn):
                        time.sleep(POLL_SEC)
        except Exception as e:  # DB 단절 등. 루프는 죽지 않는다
            log.warning("loop error: %s", e)
            time.sleep(POLL_SEC)


if __name__ == "__main__":
    main()
