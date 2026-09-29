import { describe, expect, it, vi } from 'vitest'
import { debounce, RETRY_MS, subscribe } from './stream'

/** 가짜 EventSource — 이름별 리스너, open/close 기록. readyState 2 = 브라우저가 재연결을 포기한 상태 */
class FakeES {
  static made: FakeES[] = []
  url: string; closed = false; onopen: (() => void) | null = null; readyState = 1
  private ls = new Map<string, (() => void)[]>()
  constructor(url: string) { this.url = url; FakeES.made.push(this) }
  addEventListener(k: string, f: () => void) { this.ls.set(k, [...(this.ls.get(k) ?? []), f]) }
  emit(k: string) { this.ls.get(k)?.forEach(f => f()) }
  close() { this.closed = true }
}
const make = (u: string) => new FakeES(u)
/** 가짜 탭 가시성 — set(hidden) 이 visibilitychange 를 흉내 */
const fakePage = () => {
  let hidden = false, f = () => {}
  return { hidden: () => hidden, onChange: (g: () => void) => { f = g; return () => { f = () => {} } }, set: (h: boolean) => { hidden = h; f() } }
}

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

describe('subscribe — 영구 종료·숨은 탭 복구', () => {
  it('readyState 2 의 error 는 RETRY_MS 뒤 새 연결, 새 연결의 첫 open 은 resync', () => {
    vi.useFakeTimers(); FakeES.made = []
    const got: string[] = []
    const off = subscribe('m3', k => got.push(k), make)
    const es = FakeES.made[0]; es.onopen?.()
    es.readyState = 0; es.emit('error')   // 브라우저 재연결 중 — 건드리지 않음
    vi.advanceTimersByTime(RETRY_MS); expect(FakeES.made).toHaveLength(1)
    es.readyState = 2; es.emit('error')
    expect(es.closed).toBe(true)
    vi.advanceTimersByTime(RETRY_MS - 1); expect(FakeES.made).toHaveLength(1)
    vi.advanceTimersByTime(1); expect(FakeES.made).toHaveLength(2)
    FakeES.made[1].onopen?.(); expect(got).toEqual(['resync'])
    FakeES.made[1].emit('status'); expect(got).toEqual(['resync', 'status'])
    off(); vi.useRealTimers()
  })
  it('마지막 해제는 대기 중인 재연결을 취소한다', () => {
    vi.useFakeTimers(); FakeES.made = []
    const off = subscribe('m4', () => {}, make)
    FakeES.made[0].readyState = 2; FakeES.made[0].emit('error')
    off(); vi.advanceTimersByTime(RETRY_MS * 2)
    expect(FakeES.made).toHaveLength(1)
    vi.useRealTimers()
  })
  it('숨으면 닫고, 보이면 새 연결 + resync', () => {
    FakeES.made = []
    const got: string[] = [], page = fakePage()
    const off = subscribe('m5', k => got.push(k), make, page)
    FakeES.made[0].onopen?.()
    page.set(true); expect(FakeES.made[0].closed).toBe(true); expect(FakeES.made).toHaveLength(1)
    page.set(false); expect(FakeES.made).toHaveLength(2)
    FakeES.made[1].onopen?.(); expect(got).toEqual(['resync'])
    off(); expect(FakeES.made[1].closed).toBe(true)
    page.set(false); expect(FakeES.made).toHaveLength(2)   // 해제 뒤엔 가시성 변화 무시
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
  it('cancel 은 대기 중인 호출을 없앤다', () => {
    vi.useFakeTimers()
    const f = vi.fn(), d = debounce(f, 300)
    d(); d.cancel(); vi.advanceTimersByTime(1000); expect(f).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
