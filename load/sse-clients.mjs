// SSE 구독자 M 개(R2-3 부하 측정) — Node 22 표준 fetch 스트림·worker_threads, 의존성 없음
//   RATE=<R> K6=<k6 --summary-export JSON> node load/sse-clients.mjs <모델 id> <M>      (보통 load/run.sh 가 부른다)
// - GET localhost:8080/api/models/{id}/stream 을 워커(스레드)당 200개씩 열고, 전부 :ready 를 받으면 stderr 에 'ready M'
//   (계획 작성 중 측정: 한 스레드에 1,000개 × 초당 200건이면 CPU 0.9 코어로 포화, 250개씩이면 이벤트 루프 0.69 — 클라이언트 적체가 지연에 섞이지 않게 200)
// - status 이벤트마다 수신 시각 − payload t(트리거 시각, DB clock_timestamp ms) = 종단 지연. 호스트 시계 ≈ Docker VM 시계(계획 작성 중 psql 로 ±1ms 확인)
// - SIGTERM 을 받으면 조용해질 때까지(3초, 최대 30초) 더 받은 뒤 stdout 에 README 표 한 행, stderr 에 상세 JSON
// - Prometheus(localhost:9090, compose profile obs)가 떠 있으면 같은 구간의 API CPU·Hikari 대기·서버 지연(트리거 → dispatch)도 함께
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'

const MAX_MS = 60_000, PER_WORKER = 200

/** ms 단위 지연 히스토그램(0~60초, 넘으면 마지막 칸) — 구독자 1,000 × 이벤트 1만 개도 메모리 일정 */
export const hist = () => new Uint32Array(MAX_MS + 1)
export const add = (h, ms) => { h[Math.min(MAX_MS, Math.max(0, Math.round(ms)))]++ }

/** {n, p50, p95, p99, max} (ms). 분위수 = 누적 개수가 ceil(p·n) 에 처음 닿는 칸 */
export function stats(h) {
  let n = 0, max = null
  for (let i = 0; i < h.length; i++) if (h[i]) { n += h[i]; max = i }
  const q = p => { const want = Math.ceil(p * n); let acc = 0; for (let i = 0; i < h.length; i++) if ((acc += h[i]) >= want) return i }
  return n ? { n, p50: q(0.5), p95: q(0.95), p99: q(0.99), max } : { n: 0, p50: null, p95: null, p99: null, max: null }
}

/** README 표 한 행. k6 = --summary-export JSON, sse = {clients, connected, events, lat}, prom = {cpu, pending, lag95} (없으면 null)
 *  누락 = 1 − 받은 이벤트 / (성공 PATCH × 연결된 구독자) — PATCH 1건이 op_event 1행 = 구독자마다 알림 1개 */
export function row(rate, k6, sse, prom) {
  const m = k6.metrics, ok = m.checks?.passes ?? 0, f = (x, d = 0) => (x == null ? '-' : x.toFixed(d))
  const missing = ok && sse.connected ? Math.max(0, 1 - sse.events / (ok * sse.connected)) * 100 : null
  return `| ${rate} (${f(m.iterations?.rate, 1)}) | ${sse.clients} | ${f(m['http_req_duration{name:patch}']?.['p(95)'])} ms | ${f((m['http_req_failed{name:patch}']?.value ?? 0) * 100, 1)} % | ` +
    `${sse.lat.p50 ?? '-'} · ${sse.lat.p95 ?? '-'} · ${sse.lat.p99 ?? '-'} ms | ${f(prom.lag95)} ms | ${f(missing, 2)} % | ${f(prom.cpu, 1)} | ${f(prom.pending)} |`
}

/** 워커 스레드: 구독자 n 개를 열고 {ready} → 'stop' 을 받으면 조용해질 때까지 더 받고 {events, failed, dropped, h, elu} */
async function subscribers({ url, n }) {
  const h = hist(), ac = new AbortController(), sleep = ms => new Promise(r => setTimeout(r, ms))
  let events = 0, failed = 0, dropped = 0, last = Date.now()
  async function open() {   // :ready 를 받으면 resolve, 이후 status 이벤트를 세고 지연을 쌓는다
    const res = await fetch(url, { signal: ac.signal })
    if (!res.ok) throw new Error(`stream ${res.status}`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let buf = '', ready
    const isReady = new Promise(r => { ready = r })
    ;(async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += value
          for (let i; (i = buf.indexOf('\n\n')) >= 0; buf = buf.slice(i + 2)) {
            const msg = buf.slice(0, i)
            if (msg.startsWith(':ready')) ready()
            else if (/^event:\s?status$/m.test(msg)) {
              const now = Date.now(), t = JSON.parse(msg.match(/^data:(.*)$/m)[1]).t
              events++; last = now
              if (t) add(h, now - t)
            }
          }
        }
      } catch (e) { if (!ac.signal.aborted) console.error('스트림 오류:', e.message) }
      ready()   // :ready 없이 스트림이 끝나도(조기 종료·오류) main() 의 대기가 멈추지 않게
      if (!ac.signal.aborted) dropped++   // 측정 중 서버가 끊음
    })()
    return isReady
  }
  for (let i = 0; i < n; i += 50) await Promise.all(Array.from({ length: Math.min(50, n - i) }, () => open().catch(e => { failed++; console.error('연결 실패:', e.message) })))
  const elu0 = performance.eventLoopUtilization()
  parentPort.postMessage({ ready: n - failed })
  parentPort.once('message', async () => {
    const stop = Date.now()
    while (Date.now() - last < 3000 && Date.now() - stop < 30_000) await sleep(250)
    ac.abort()
    parentPort.postMessage({ events, failed, dropped, h, elu: performance.eventLoopUtilization(elu0).utilization }, [h.buffer])
  })
}

async function main() {
  const [id, m] = process.argv.slice(2), M = Number(m)
  if (!id || !M) { console.error('사용: RATE=<R> K6=<k6 요약 JSON> node load/sse-clients.mjs <모델 id> <M>'); process.exit(2) }
  const url = `http://localhost:8080/api/models/${id}/stream`, PROM = 'http://localhost:9090/api/v1/query', t0 = Date.now()
  const ws = Array.from({ length: Math.ceil(M / PER_WORKER) }, (_, i) =>
    new Worker(fileURLToPath(import.meta.url), { workerData: { url, n: Math.min(PER_WORKER, M - i * PER_WORKER) } }))
  const next = w => new Promise(r => w.once('message', r))
  const ready = (await Promise.all(ws.map(next))).reduce((a, x) => a + x.ready, 0), readyAt = Date.now()
  console.error(`ready ${ready}/${M} (${readyAt - t0} ms, 워커 ${ws.length})`)

  process.once('SIGTERM', async () => {
    const rs = await Promise.all(ws.map(w => { const r = next(w); w.postMessage('stop'); return r }))
    const h = hist()
    for (const r of rs) for (let i = 0; i < h.length; i++) h[i] += r.h[i]
    const sum = k => rs.reduce((a, r) => a + r[k], 0), w = `${Math.ceil((Date.now() - readyAt) / 1000)}s`
    const prom = async q => {
      try { const v = (await (await fetch(`${PROM}?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(5000) })).json()).data.result[0]?.value[1]; return v == null || v === 'NaN' ? null : Number(v) }
      catch { return null }   // obs 프로필이 꺼져 있거나 5초 안에 응답 없음
    }
    const p = {
      cpu: await prom(`max_over_time(rate(process_cpu_time_ns_total[15s])[${w}:5s]) / 1e9`),   // API 코어 수(15초 평균의 최대)
      pending: await prom(`max_over_time(hikaricp_connections_pending[${w}])`),
      lag95: await prom(`histogram_quantile(0.95, sum by (le) (increase(bim_notify_lag_seconds_bucket[${w}]))) * 1000`),
    }
    const sse = { clients: M, connected: M - sum('failed'), dropped: sum('dropped'), events: sum('events'), lat: stats(h), elu: +Math.max(...rs.map(r => r.elu)).toFixed(2) }
    console.error(JSON.stringify({ window: w, sse, prom: p }))   // elu = 가장 바쁜 워커의 이벤트 루프 사용률 — 0.8 을 넘으면 PER_WORKER 를 줄여 다시
    const k6 = process.env.K6
    if (k6 && existsSync(k6)) console.log(row(process.env.RATE ?? '-', JSON.parse(readFileSync(k6, 'utf8')), sse, p))
    process.exit(0)
  })
}

if (!isMainThread) await subscribers(workerData)
else if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
