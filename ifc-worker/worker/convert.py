"""IFC → glb. ADR 0005. 실행: python -m worker.convert in.ifc out.glb"""
import multiprocessing
import os
import sys

import ifcopenshell
import ifcopenshell.geom as geom


def to_glb(ifc_path, glb_path, on_progress=None):
    """요소 수를 반환. on_progress(done) 는 요소마다 호출."""
    s = geom.settings()
    s.set("use-world-coords", True)
    s.set("weld-vertices", False)
    ss = geom.serializer_settings()
    ss.set("use-element-guids", True)

    f = ifcopenshell.open(ifc_path)  # 비IFC 는 ifcopenshell.Error 로 실패 (__del__ 의 KeyError 경고는 무해)
    ser = geom.serializers.gltf(glb_path, s, ss)
    ser.setFile(f)
    ser.setUnitNameAndMagnitude("METER", 1.0)
    ser.writeHeader()
    # 스레드당 메모리 ~+250MB (ifcopenshell-geom.md). 컨테이너 메모리 제한 시 GEOM_THREADS 로 낮춘다.
    it = geom.iterator(s, f, int(os.environ.get("GEOM_THREADS", multiprocessing.cpu_count())))
    n = 0
    if it.initialize():
        while True:
            ser.write(it.get())
            n += 1
            if on_progress:
                on_progress(n)
            if not it.next():
                break
    ser.finalize()
    if n == 0:
        raise ValueError("no geometry in IFC")
    return n


if __name__ == "__main__":
    src, dst = sys.argv[1:3]
    n = to_glb(src, dst)
    assert n > 0 and os.path.getsize(dst) > 20 and open(dst, "rb").read(4) == b"glTF"
    print(f"{n} elements -> {dst} ({os.path.getsize(dst)/1e6:.1f}MB)")
