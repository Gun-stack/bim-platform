"""conversion_job 폴링 루프. ADR 0003."""
import logging
import os
import time
import traceback

import psycopg

log = logging.getLogger("worker")
DSN = f"postgresql://bim:bim@{os.environ.get('DB_HOST', 'localhost')}:5432/bim"
POLL_SEC = 2
STALE = "10 minutes"
MAX_ATTEMPTS = 3

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
    # M1 에서 convert.py / extract.py / georef.py 연결
    raise NotImplementedError("conversion not implemented yet (M1)")


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
