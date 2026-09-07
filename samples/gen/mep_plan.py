"""가상 건물 배치 사양 — 층 표고·평면·말단 격자. 순수 계산이라 ifcopenshell 없이 호스트에서 unittest 한다(test_mep_plan.py).
gen_mep.py 가 import 해서 IfcSpace 생성과 설비 배치에 같은 목록을 쓴다."""
W, D = 36.0, 16.0
EPS = (16.0, 7.0, 1.2, 2.0)           # 전기 샤프트 x,y,w,d
PS = (17.4, 7.0, 1.2, 2.0)            # 배관 샤프트
DS = (18.8, 7.0, 1.6, 2.0)            # 덕트 샤프트
ELV = (13.2, 7.0, 2.4, 2.4)           # 엘리베이터 승강로
ST1 = (10.4, 10.0, 2.6, 4.6)          # 계단실 1 (코어 서쪽 — 사무A 안에 있다)
ST2 = (33.0, 0.3, 2.6, 4.6)           # 계단실 2 (동남)
SHAFTS = (("EPS", EPS), ("PS", PS), ("DS", DS), ("EV", ELV), ("ST1", ST1), ("ST2", ST2))

# 지상층 평면: 유형 → [(실 이름, x, y, w, d)]. 코어 x 13~20.6 은 샤프트·엘리베이터·계단실(현행 좌표 그대로)
PLAN = {
    "lobby": [("로비", 0, 0, 13, D), ("상가1", 20.6, 0, 7.7, D), ("상가2", 28.3, 0, W - 28.3, D)],
    "dining": [("식당", 0, 0, 13, D), ("회의1", 20.6, 0, 7.7, D), ("회의2", 28.3, 0, W - 28.3, D)],
    "office": [("사무A", 0, 0, 13, D), ("사무B", 20.6, 0, W - 20.6, D)],
}
PITCH = {"low": None, "mid": 4.0, "high": 2.5}   # 말단 격자 피치 P(m). low 는 격자 없이 FRAC 고정 좌표
GRID = {"light": (1, 0.0), "spr": (1, 0.5), "dif": (2, 0.0), "det": (2, 0.0)}   # 종류 → (P 배수, 오프셋 P 배수)
# low: 현행 A/B 구역 고정 좌표(실당 조명 4·스프링클러 6·디퓨저 4·감지기 4)를 실 폭·깊이 비율로 옮긴 것
FRAC = {"light": [(0.25, 0.2), (0.25, 0.7), (0.7, 0.2), (0.7, 0.7)],
        "spr": [(0.15, 0.25), (0.5, 0.25), (0.85, 0.25), (0.15, 0.75), (0.5, 0.75), (0.85, 0.75)],
        "dif": [(0.3, 0.28), (0.3, 0.72), (0.7, 0.28), (0.7, 0.72)],
        "det": [(0.25, 0.35), (0.25, 0.65), (0.7, 0.35), (0.7, 0.65)]}


def floor_spec(n_floors):
    """[(이름, 표고 z, 층고 h, 유형)]. 지하 B2·B1 은 현행 고정(램프 rise·개구부 계산이 3.5 에 묶여 있음),
    1F 로비 5.0, 2F 식당 3.5, 3F~NF 사무 3.5, RF 옥탑 3.0. n_floors ≥ 3 (2F 에스컬레이터·3F 덤웨이터 개구부 고정)"""
    if n_floors < 3:
        raise ValueError("floors >= 3")
    fl = [("B2", -7.0, 3.5, "basement"), ("B1", -3.5, 3.5, "basement"), ("1F", 0.0, 5.0, "lobby"), ("2F", 5.0, 3.5, "dining")]
    z = 8.5
    for i in range(3, n_floors + 1):
        fl.append((f"{i}F", z, 3.5, "office")); z += 3.5
    fl.append(("RF", z, 3.0, "roof"))
    return fl


def pad(rect, m):
    x, y, w, d = rect
    return (x - m, y - m, w + 2 * m, d + 2 * m)


def inside(px, py, rect):
    x, y, w, d = rect
    return x <= px <= x + w and y <= py <= y + d


EXCL_CORE = [pad(r, 0.3) for _, r in SHAFTS]   # 샤프트·계단실 0.3 확장 — 격자점 제외 영역


def grid(x, y, w, d, pitch, offset=0.0, margin=0.8):
    """실 사각형 안 격자점 [(x, y)]. 원점 (x+margin+offset, y+margin+offset), x 먼저 증가 후 y — 인덱스 순서 고정(데모 상태 키가 인덱스를 쓴다)"""
    pts, yy = [], y + margin + offset
    while yy <= y + d - margin + 1e-9:
        xx = x + margin + offset
        while xx <= x + w - margin + 1e-9:
            pts.append((round(xx, 3), round(yy, 3))); xx += pitch
        yy += pitch
    return pts


def place(kind, x, y, w, d, density, exclude=()):
    """말단 좌표 목록. mid/high 는 격자, low 는 FRAC 비율. exclude(샤프트 확장·개구부 사각형) 안 점은 버린다"""
    p = PITCH[density]
    if p is None:
        pts = [(round(x + fx * w, 3), round(y + fy * d, 3)) for fx, fy in FRAC[kind]]
    else:
        mult, off = GRID[kind]; pts = grid(x, y, w, d, p * mult, p * off)
    return [q for q in pts if not any(inside(q[0], q[1], r) for r in exclude)]
