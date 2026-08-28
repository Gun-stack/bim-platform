"""BMS 시뮬레이터: 상태 API 를 주기적으로 쳐서 모니터·뷰어가 살아 움직이게 한다.
실행: python3 samples/gen/bms_sim.py <modelId> [--api http://localhost:8080/api] [--interval 3] [--ticks 0(무한)]
매 틱: 수위·부하 드리프트, 가끔 감지기 경보(몇 틱 뒤 복구)·장애, 펌프 운전 전환, 드물게 정전→복전. 실제 BMS 연동은 같은 PATCH 를 친다.
"""
import argparse, json, random, time, urllib.request as u, urllib.parse as p

ap = argparse.ArgumentParser(); ap.add_argument("model"); ap.add_argument("--api", default="http://localhost:8080/api"); ap.add_argument("--interval", type=float, default=3); ap.add_argument("--ticks", type=int, default=0); ap.add_argument("--seed", type=int)
a = ap.parse_args(); random.seed(a.seed)

def call(method, path, body=None):
    req = u.Request(a.api + path, method=method, data=None if body is None else json.dumps(body).encode(), headers={"content-type": "application/json"})
    return json.load(u.urlopen(req))
def patch(gid, body): return call("PATCH", f"/models/{a.model}/elements/{p.quote(gid)}/status", body)

rows = call("GET", f"/models/{a.model}/status")
by = lambda cls: [r for r in rows if r["ifcClass"] == cls]
sensors, pumps, boards = by("IfcSensor"), by("IfcPump") + by("IfcFan") + by("IfcChiller"), by("IfcElectricDistributionBoard")
tanks = [r for r in by("IfcTank") if "LevelPercent" in r["status"]]   # 수위 있는 탱크만 (가스 용기 제외)
comms = [r for r in rows if r["status"].get("Status") == "ONLINE"]
state = {r["globalId"]: dict(r["status"]) for r in rows}
pending = {}   # gid → 복구 예정 틱
power = "UTILITY"; power_until = 0
print(f"sim: {len(sensors)} sensors, {len(pumps)} pumps, {len(tanks)} tanks, {len(boards)} boards. Ctrl+C 로 중지")
t = 0
while a.ticks == 0 or t < a.ticks:
    t += 1; log = []
    for r in random.sample(tanks, k=min(2, len(tanks))):   # 수위 드리프트
        s = state[r["globalId"]]; s["LevelPercent"] = round(max(5.0, min(100.0, float(s.get("LevelPercent", 50)) + random.uniform(-3, 3))), 1)
        patch(r["globalId"], {"LevelPercent": s["LevelPercent"]}); log.append(f"{r['name']} 수위 {s['LevelPercent']}%")
    for r in random.sample(boards, k=min(3, len(boards))):   # 부하 드리프트
        s = state[r["globalId"]]; s["LoadPercent"] = round(max(5.0, min(95.0, float(s.get("LoadPercent", 30)) + random.uniform(-6, 6))), 1)
        patch(r["globalId"], {"LoadPercent": s["LoadPercent"]})
    for gid in [g for g, until in pending.items() if until <= t]:   # 예정된 복구
        patch(gid, {"Status": "ONLINE" if state[gid].get("Status") == "ONLINE" else "NORMAL"}); pending.pop(gid); log.append(f"복구 {gid[:6]}")
    roll = random.random()
    if roll < 0.25 and sensors:
        r = random.choice([x for x in sensors if x["globalId"] not in pending] or sensors)
        patch(r["globalId"], {"Status": "ALARM", "AlarmAt": time.strftime("%Y-%m-%dT%H:%M")}); pending[r["globalId"]] = t + random.randint(3, 6); log.append(f"🔥 경보 {r['name']}")
    elif roll < 0.35 and sensors:
        r = random.choice(sensors); patch(r["globalId"], {"Status": "FAULT"}); pending[r["globalId"]] = t + random.randint(5, 10); log.append(f"⚠ 장애 {r['name']}")
    elif roll < 0.42 and comms:
        r = random.choice(comms); patch(r["globalId"], {"Status": "OFFLINE"}); pending[r["globalId"]] = t + random.randint(3, 6); log.append(f"📡 오프라인 {r['name']}")
    elif roll < 0.5 and pumps:
        r = random.choice(pumps); s = state[r["globalId"]]; s["Status"] = "STANDBY" if s.get("Status") == "RUNNING" else "RUNNING"
        patch(r["globalId"], {"Status": s["Status"], "RunHours": round(float(s.get("RunHours", 0)) + 0.05, 2)}); log.append(f"펌프 {r['name']} → {s['Status']}")
    elif roll < 0.56 and power == "UTILITY":
        call("POST", f"/models/{a.model}/power?source=GENERATOR"); power = "GENERATOR"; power_until = t + random.randint(4, 8); log.append("⚡ 정전 → 비상발전")
    if power == "GENERATOR" and t >= power_until:
        call("POST", f"/models/{a.model}/power?source=UTILITY"); power = "UTILITY"; log.append("복전")
    print(f"[{t:04d}] " + (" | ".join(log) if log else "-"), flush=True)
    time.sleep(a.interval)
