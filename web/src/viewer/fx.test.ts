import { describe, expect, it } from 'vitest'
import { ease, flowLevel, FLOW_SPEED, interpView, pulseOpacity, PULSE_S } from './fx'

const close = (a: number[], b: number[]) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], 5))
const dist = (p: number[], t: number[]) => Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])

describe('ease — easeInOutCubic', () => {
  it('경계·중앙·범위 밖 클램프', () => {
    expect(ease(0)).toBe(0); expect(ease(1)).toBe(1); expect(ease(0.5)).toBeCloseTo(0.5)
    expect(ease(-1)).toBe(0); expect(ease(2)).toBe(1)
    expect(ease(0.25)).toBeLessThan(0.25)   // 느리게 출발
  })
})

describe('interpView — 타깃 직선 + 카메라 구면 보간', () => {
  const a = { p: [10, 0, 0], t: [0, 0, 0] }, b = { p: [0, 0, 20], t: [2, 0, 0] }
  it('k=0 은 출발, k=1 은 도착', () => {
    const v0 = interpView(a, b, 0), v1 = interpView(a, b, 1)
    close(v0.p, a.p); close(v0.t, a.t); close(v1.p, b.p); close(v1.t, b.t)
  })
  it('반대편으로 가도 건물(타깃)을 관통하지 않는다 — 거리 유지', () => {
    const m = interpView({ p: [10, 0, 0], t: [0, 0, 0] }, { p: [-10, 0, 0], t: [0, 0, 0] }, 0.5)
    expect(dist(m.p, m.t)).toBeCloseTo(10, 5)
  })
  it('거리는 선형 보간', () => {
    const m = interpView({ p: [0, 0, 10], t: [0, 0, 0] }, { p: [0, 0, 30], t: [0, 0, 0] }, 0.5)
    expect(dist(m.p, m.t)).toBeCloseTo(20, 5)
  })
  it('카메라가 타깃과 겹친 퇴화 입력도 NaN 없음', () => {
    const m = interpView({ p: [0, 0, 0], t: [0, 0, 0] }, { p: [5, 0, 0], t: [0, 0, 0] }, 0.5)
    expect(m.p.every(Number.isFinite)).toBe(true)
  })
})

describe('pulseOpacity — 경보 펄스', () => {
  it('0.15 ↔ 0.6, PULSE_S 주기', () => {
    expect(pulseOpacity(0)).toBeCloseTo(0.15); expect(pulseOpacity(PULSE_S / 2)).toBeCloseTo(0.6)
    expect(pulseOpacity(PULSE_S * 3.25)).toBeCloseTo(pulseOpacity(PULSE_S / 4))
  })
})

describe('flowLevel — 계통 흐름 파동 (항상 상류 → 하류)', () => {
  const at = (step: number) => step / FLOW_SPEED   // 파면이 step 단계에 있는 시각
  it('하류 추적: depth 가 클수록 하류 — 파면 위치가 최대, 뒤로 3단계 꼬리, 앞은 0', () => {
    expect(flowLevel(at(2), 2, 10, 'down')).toBeCloseTo(1)
    expect(flowLevel(at(2), 1, 10, 'down')).toBeCloseTo(2 / 3)
    expect(flowLevel(at(2), 3, 10, 'down')).toBe(0)
  })
  it('상류 추적: depth 가 클수록 상류(원천) — 파면이 maxDepth 에서 0 으로', () => {
    expect(flowLevel(at(0), 5, 5, 'up')).toBeCloseTo(1)
    expect(flowLevel(at(0), 0, 5, 'up')).toBe(0)
    expect(flowLevel(at(5), 0, 5, 'up')).toBeCloseTo(1)
  })
  it('주기 = (maxDepth + 4) 단계 — 끝까지 간 뒤 반복', () => {
    expect(flowLevel(at(2) + (10 + 4) / FLOW_SPEED, 2, 10, 'down')).toBeCloseTo(1)
  })
})
