"""기존 모델에 3D Tiles 붙이기(재업로드·재변환 없이). 실행(워커 컨테이너): python -m worker.backfill [model_id ...]
인자가 없으면 tileset 이 없는 READY 모델 전부. 공개된 GLB + DB 의 공간·요소 행으로 만든다 — IFC 를 다시 읽지 않으므로 형상·GlobalId 는 지금 공개된 그대로."""
import logging
import os
import sys
import tempfile
import uuid

import psycopg

from . import main

# extract.spatial_tree / elements 와 같은 모양의 행: (gid, parent_gid, class, name, elev) · (gid, class, name, container_gid, psets)
SPATIAL = """SELECT s.global_id, p.global_id, s.ifc_class, s.name, s.elevation
  FROM spatial_node s LEFT JOIN spatial_node p ON p.id = s.parent_id WHERE s.model_id = %s"""
ELEMENTS = """SELECT e.global_id, e.ifc_class, e.name, s.global_id, NULL
  FROM element e LEFT JOIN spatial_node s ON s.id = e.spatial_node_id WHERE e.model_id = %s"""


def run(ids: list[str]) -> None:
    s3 = main.s3_client()
    with psycopg.connect(main.DSN, autocommit=True) as conn:
        if not ids:
            ids = [str(r[0]) for r in conn.execute(
                "SELECT id FROM model WHERE status='READY' AND glb_key IS NOT NULL AND tileset_key IS NULL ORDER BY created_at")]
        for mid in ids:
            row = conn.execute("SELECT glb_key FROM model WHERE id=%s AND status='READY'", (mid,)).fetchone()
            if not row or not row[0]:
                print(mid, "READY 아님 — 건너뜀")
                continue
            with tempfile.TemporaryDirectory() as d:
                path = os.path.join(d, "m.glb")
                s3.fget_object(main.BUCKET, row[0], path)
                keys = main.publish_tiles(s3, path, conn.execute(SPATIAL, (mid,)).fetchall(), conn.execute(ELEMENTS, (mid,)).fetchall(),
                                          f"glb/{mid}/tiles/backfill-{uuid.uuid4()}/")
            if not keys:
                print(mid, "타일 없음(생성 실패 또는 형상 없음) — 단일 GLB 유지")
                continue
            # 그 사이 재변환돼 glb_key 가 바뀌었으면 이 타일은 옛 GLB 기준 — 버린다
            if conn.execute("UPDATE model SET tileset_key=%s WHERE id=%s AND glb_key=%s", (keys[0], mid, row[0])).rowcount == 1:
                print(mid, len(keys), "files →", keys[0])
            else:
                for k in keys:
                    s3.remove_object(main.BUCKET, k)
                print(mid, "그 사이 재변환됨 — 버림")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    run(sys.argv[1:])
