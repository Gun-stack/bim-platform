// 상태 이벤트 부하(R2-3) — k6. 열린 작업지시가 있는 감지기에 PATCH …/status 를 초당 RATE 건, DURATION 동안(constant-arrival-rate)
// load/run.sh 가 compose 망에서 실행(api:8080 직접 — nginx 레이트 리밋 20r/s·IP 를 거치지 않음):
//   docker run --rm --network <compose 망> -v "$PWD/load:/load:ro" grafana/k6:2.3.0 run -e MODEL=<모델 id> -e RATE=20 /load/status-burst.js
// 대상 한정: 경보(ALARM)가 새 작업지시를 만들지 않고 열린 것을 재사용 — 데이터 영향 최소. 원상복구는 run.sh
import http from 'k6/http'
import exec from 'k6/execution'
import { check } from 'k6'

const API = __ENV.API || 'http://api:8080/api', MODEL = __ENV.MODEL, RATE = Number(__ENV.RATE || 20)

export const options = {
  scenarios: {
    burst: { executor: 'constant-arrival-rate', rate: RATE, timeUnit: '1s', duration: __ENV.DURATION || '60s', preAllocatedVUs: Math.max(10, RATE), maxVUs: Math.max(50, RATE * 5) },
  },
  thresholds: { 'http_req_duration{name:patch}': ['p(95)<500'], 'http_req_failed{name:patch}': ['rate<0.01'] },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
}

export function setup() {
  const wo = http.get(`${API}/models/${MODEL}/work-orders`).json()
  const targets = [...new Set(wo.filter(w => w.status !== 'DONE' && w.ifcClass === 'IfcSensor' && /감지기/.test(w.elementName || '')).map(w => w.globalId))]
  if (!targets.length) throw new Error('열린 작업지시가 있는 감지기가 없다')
  return { targets }
}

export default function ({ targets }) {
  const i = exec.scenario.iterationInTest, gid = targets[i % targets.length]
  const Status = Math.floor(i / targets.length) % 2 ? 'NORMAL' : 'ALARM'   // 한 바퀴마다 대상 전원 경보 ↔ 정상
  const r = http.patch(`${API}/models/${MODEL}/elements/${encodeURIComponent(gid)}/status`, JSON.stringify({ Status }),
    { headers: { 'content-type': 'application/json' }, tags: { name: 'patch' } })
  check(r, { patch: x => x.status === 200 })   // 성공 수 = 구독자마다 기대 이벤트 수(PATCH 1건 = op_event 1행 = 알림 1개)
}
