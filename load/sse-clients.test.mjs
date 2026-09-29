// node --test load/sse-clients.test.mjs   — sse-clients.mjs 의 순수 집계(분위수·표 한 행)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { add, hist, row, stats } from './sse-clients.mjs'

test('분위수 = 누적 개수가 ceil(p·n) 에 처음 닿는 ms', () => {
  const h = hist()
  for (let ms = 1; ms <= 100; ms++) add(h, ms)
  assert.deepEqual(stats(h), { n: 100, p50: 50, p95: 95, p99: 99, max: 100 })
})

test('빈 히스토그램은 null, 음수는 0 칸, 60초 초과는 마지막 칸', () => {
  assert.deepEqual(stats(hist()), { n: 0, p50: null, p95: null, p99: null, max: null })
  const h = hist(); add(h, -3); add(h, 90_000)
  assert.equal(stats(h).p50, 0); assert.equal(stats(h).max, 60_000)
})

test('표 한 행 — 누락 = 1 − 받은 수 / (성공 PATCH × 연결 구독자), Prometheus 없으면 -', () => {
  const k6 = { metrics: { checks: { passes: 1200 }, iterations: { rate: 19.8 }, 'http_req_duration{name:patch}': { 'p(95)': 41.6 }, 'http_req_failed{name:patch}': { value: 0 } } }
  const sse = { clients: 100, connected: 100, events: 119_880, lat: { p50: 12, p95: 30, p99: 55 } }
  assert.equal(row(20, k6, sse, { cpu: 1.26, pending: 0, lag95: 4.9 }), '| 20 (19.8) | 100 | 42 ms | 0.0 % | 12 · 30 · 55 ms | 5 ms | 0.10 % | 1.3 | 0 |')
  assert.equal(row(20, k6, sse, { cpu: null, pending: null, lag95: null }), '| 20 (19.8) | 100 | 42 ms | 0.0 % | 12 · 30 · 55 ms | - ms | 0.10 % | - | - |')
})
