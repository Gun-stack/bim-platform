"""conversion_job 폴링 루프. ADR 0003."""
import logging
import os
import time
import traceback

import psycopg
from minio import Minio
from psycopg.types.json import Jsonb

from . import convert as conv, extract, georef

log = logging.getLogger("worker")
DSN = f"postgresql://bim:bim@{os.environ.get('DB_HOST', 'localhost')}:5432/bim"
POLL_SEC = 2
STALE = "10 minutes"
MAX_ATTEMPTS = 3
S3 = os.environ.get("S3_ENDPOINT", "http://localhost:9000").split("://", 1)[1]
BUCKET = "bim"
PROGRESS_EVERY = 25

CLAIM = """
UPDATE conversion_job
   SET status='RUNNING', started_at=now(), attempts=attempts+1, error=NULL
 WHERE id = (SELECT id FROM conversion_job WHERE status='PENDING'
             ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING id, model_id
"""
# hang·크래시 복구: 매 회전마다. 3회 넘으면 FAILED.
RECOVER = f"""
UPDATE conversion_job
   SET status = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END,
       error  = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN 'stale after ' || attempts || ' attempts' END,
       finished_at = CASE WHEN attempts >= {MAX_ATTEMPTS} THEN now() END
 WHERE status='RUNNING' AND started_at < now() - interval '{STALE}'
"""
FAIL_JOB = "UPDATE conversion_job SET status='FAILED', error=%s, finished_at=now() WHERE id=%s"
FAIL_MODEL = "UPDATE model SET status='FAILED' WHERE id=%s"


def convert(conn, job_id, model_id):
    import tempfile
    s3 = Minio(S3, access_key="minio", secret_key="minio123", secure=False)
    ifc_key = conn.execute("SELECT ifc_key FROM model WHERE id=%s", (model_id,)).fetchone()[0]
    glb_key = f"glb/{model_id}.glb"  # glb/ 프리픽스만 익명 읽기 (compose minio-init)
    conn.execute("UPDATE model SET status='PROCESSING' WHERE id=%s", (model_id,))
    with tempfile.TemporaryDirectory() as d:
        ifc, glb = os.path.join(d, "in.ifc"), os.path.join(d, "out.glb")
        s3.fget_object(BUCKET, ifc_key, ifc)
        import ifcopenshell
        f = ifcopenshell.open(ifc)
        total = max(1, sum(1 for p in f.by_type("IfcProduct") if p.Representation))

        def progress(n):  # 기하 변환을 0~90% 로 본다
            if n % PROGRESS_EVERY == 0:
                conn.execute("UPDATE conversion_job SET progress=%s WHERE id=%s", (min(90, n * 90 // total), job_id))

        _, bbox = conv.to_glb(ifc, glb, progress)
        geo = georef.read(f)
        fp = georef.footprint_wkt(geo, bbox)
        mc = dict(geo or {}, bbox=list(bbox) if bbox else None)   # bbox 는 수동 핀 때 풋프린트 폭으로 씀
        s3.fput_object(BUCKET, glb_key, glb, content_type="model/gltf-binary")
        spatial, elems = extract.spatial_tree(f), extract.elements(f)
        systems, conns = extract.systems(f), extract.connections(f)

    with conn.transaction():  # 재시도 시 이전 결과 덮어쓰기
        conn.execute("DELETE FROM element WHERE model_id=%s", (model_id,))
        conn.execute("DELETE FROM system WHERE model_id=%s", (model_id,))
        conn.execute("DELETE FROM spatial_node WHERE model_id=%s", (model_id,))
        ids = {}
        for gid, parent, cls, name, elev in spatial:
            ids[gid] = conn.execute(
                "INSERT INTO spatial_node (model_id, parent_id, global_id, ifc_class, name, elevation) "
                "VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (model_id, ids.get(parent), gid, cls, name, elev)).fetchone()[0]
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO element (model_id, global_id, ifc_class, name, spatial_node_id, properties) "
                "VALUES (%s,%s,%s,%s,%s,%s)",
                [(model_id, gid, cls, name, ids.get(c), Jsonb(props)) for gid, cls, name, c, props in elems])
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
        conn.execute("UPDATE conversion_job SET status='DONE', progress=100, finished_at=now() WHERE id=%s", (job_id,))
    log.info("job %s done: %s, %d spatial, %d elements, %d systems, %d connections, georef=%s", job_id, f.schema, len(spatial), len(elems), len(systems), len(conns), geo["source"] if geo else None)


def run_once(conn):
    with conn.transaction():
        conn.execute(RECOVER)
    with conn.transaction():
        row = conn.execute(CLAIM).fetchone()
    if not row:
        return False
    job_id, model_id = row
    log.info("job %s model %s start", job_id, model_id)
    try:
        convert(conn, job_id, model_id)
    except Exception:
        err = traceback.format_exc()[-2048:]
        log.error("job %s failed\n%s", job_id, err)
        with conn.transaction():
            conn.execute(FAIL_JOB, (err, job_id))
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
