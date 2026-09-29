#!/usr/bin/env bash
# 부하 한 판(R2-3): SSE 구독자 M 개 → k6 상태 PATCH 초당 R 건 60초 → README 표 한 행. 끝나면(중단돼도) 모델 상태·이벤트를 시작 시점으로 되돌린다
#   load/run.sh <R> <M> [모델 이름=mep-building.ifc]      compose 기동 중, 호스트에 node 22·jq. DURATION=10s 로 짧게
# - PATCH: k6 컨테이너 → compose 망 api:8080 직접(nginx 레이트 리밋 20r/s·IP 우회). SSE: 호스트 → localhost:8080 직접
# - 대상: 열린 작업지시가 있는 감지기(status-burst.js) — 경보가 새 작업지시를 만들지 않고 열린 것을 재사용
# - 되돌리기: 시작 전 요소 상태(Pset_BimStatus)를 파일로 떠 두고 끝나면 그대로 복원 + 그 사이 STATUS 이벤트 삭제(모니터링 타임라인·통계 오염 방지)
set -euo pipefail
cd "$(dirname "$0")/.."
R=${1:?사용: load/run.sh <R 초당 PATCH> <M SSE 구독자> [모델 이름]} M=${2:?M} NAME=${3:-mep-building.ifc}
API=http://localhost:8080/api
psql() { docker compose exec -T postgis psql -U bim -d bim -v ON_ERROR_STOP=1 -qtA "$@"; }
subs() { curl -sf localhost:8080/actuator/prometheus | awk '/^bim_sse_subscribers/ {print int($2)}'; }   # api 포트는 호스트 127.0.0.1 — nginx(/actuator/ 404)를 거치지 않는다

PROJ=$(curl -sf $API/projects | jq -r '.[0].id')
MID=$(curl -sf "$API/projects/$PROJ/models" | jq -r --arg n "$NAME" 'first(.[] | select(.name == $n and .status == "READY") | .id) // empty')
[ -n "$MID" ] || { echo "READY 모델 '$NAME' 없음" >&2; exit 1; }
NET=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$(docker compose ps -q api)")
OUT=$(mktemp -d) BASE=$(subs)   # 시작 전 구독자(열린 브라우저 탭)

T0=$(psql -c 'SELECT now()')
psql -c "COPY (SELECT id, properties->'Pset_BimStatus' FROM element WHERE model_id = '$MID' AND jsonb_exists(properties, 'Pset_BimStatus')) TO STDOUT" > "$OUT/snapshot.tsv"
restore() {
  { echo 'CREATE TEMP TABLE snap (id bigint, s jsonb); COPY snap FROM STDIN;'; cat "$OUT/snapshot.tsv"; echo '\.'
    echo "UPDATE element e SET properties = jsonb_set(e.properties, '{Pset_BimStatus}', snap.s) FROM snap WHERE e.id = snap.id AND e.properties->'Pset_BimStatus' IS DISTINCT FROM snap.s;"
    echo "DELETE FROM op_event WHERE model_id = '$MID' AND kind = 'STATUS' AND at >= '$T0';"; } | psql
  echo "되돌림: 요소 상태(스냅숏 $(wc -l < "$OUT/snapshot.tsv" | tr -d ' ')행)·$T0 이후 STATUS 이벤트 삭제 (기록 $OUT)" >&2
}
trap restore EXIT

RATE=$R K6="$OUT/k6.json" node load/sse-clients.mjs "$MID" "$M" > "$OUT/row.md" 2> "$OUT/sse.log" & SSE=$!
until grep -q '^ready' "$OUT/sse.log" 2>/dev/null; do kill -0 $SSE 2>/dev/null || { cat "$OUT/sse.log" >&2; exit 1; }; sleep 1; done
grep "^ready" "$OUT/sse.log" >&2
docker run --rm --network "$NET" -v "$PWD/load:/load:ro" -v "$OUT:/out" grafana/k6:2.3.0 run -q -e MODEL="$MID" -e RATE="$R" -e DURATION="${DURATION:-60s}" \
  --summary-export /out/k6.json /load/status-burst.js > "$OUT/k6.log" 2>&1 || echo "k6 종료 코드 $? (99 = 임계값 초과) — $OUT/k6.log" >&2
kill -TERM $SSE; wait $SSE || true; GONE=$SECONDS
tail -1 "$OUT/sse.log" >&2
# 끊긴 SSE 는 서버가 하트비트(20초) 몇 번 뒤에야 정리한다 — 다음 판의 팬아웃에 섞이지 않게 시작 전 수로 돌아올 때까지(최대 3분)
for _ in $(seq 36); do [ "$(subs)" -le "$BASE" ] && break; sleep 5; done
echo "끊긴 구독 정리 $((SECONDS - GONE)) s — 구독자 $(subs) (시작 전 $BASE)" >&2
cat "$OUT/row.md"
