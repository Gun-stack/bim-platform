import { describe, expect, it } from 'vitest'
import { ease, interpView } from './fx'

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
