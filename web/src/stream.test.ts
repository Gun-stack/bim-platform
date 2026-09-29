import { describe, expect, it, vi } from 'vitest'
import { debounce, subscribe } from './stream'

/** 가짜 EventSource — 이름별 리스너, open/close 기록 */
class FakeES {
  static made: FakeES[] = []
  url: string; closed = false; onopen: (() => void) | null = null
  private ls = new Map<string, (() => void)[]>()
  constructor(url: string) { this.url = url; FakeES.made.push(this) }
  addEventListener(k: string, f: () => void) { this.ls.set(k, [...(this.ls.get(k) ?? []), f]) }
  emit(k: string) { this.ls.get(k)?.forEach(f => f()) }
  close() { this.closed = true }
}
const make = (u: string) => new FakeES(u)

describe('subscribe — 모델별 EventSource 하나를 공유', () => {
  it('같은 모델 구독자 둘은 연결 1개, 마지막 해제 때 닫힌다', () => {
    FakeES.made = []
    const a: string[] = [], b: string[] = []
    const offA = subscribe('m1', k => a.push(k), make), offB = subscribe('m1', k => b.push(k), make)
    expect(FakeES.made).toHaveLength(1); expect(FakeES.made[0].url).toBe('/api/models/m1/stream')
    FakeES.made[0].emit('status')
    expect(a).toEqual(['status']); expect(b).toEqual(['status'])
    offA(); expect(FakeES.made[0].closed).toBe(false)
    offB(); expect(FakeES.made[0].closed).toBe(true)
  })
  it('첫 open 은 무시하고, 재연결(두 번째 open)은 resync 로 알린다', () => {
    FakeES.made = []
    const got: string[] = []
    const off = subscribe('m2', k => got.push(k), make)
    FakeES.made[0].onopen?.(); FakeES.made[0].onopen?.()
    expect(got).toEqual(['resync'])
    off()
  })
})

describe('debounce', () => {
  it('연속 호출은 마지막 한 번만', () => {
    vi.useFakeTimers()
    const f = vi.fn(), d = debounce(f, 300)
    d(); d(); d(); vi.advanceTimersByTime(299); expect(f).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1); expect(f).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
