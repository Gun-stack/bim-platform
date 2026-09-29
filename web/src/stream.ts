import { useEffect, useRef } from 'react'

/** 서버 푸시 — GET /api/models/{id}/stream (SSE). 이벤트는 '다시 조회' 신호로만 쓴다(R2-1) */
type EventSourceLike = { addEventListener(k: string, f: () => void): void; close(): void; onopen: (() => void) | null; readyState: number }
/** 탭 가시성 — 테스트(node)에선 주입 */
type Page = { hidden(): boolean; onChange(f: () => void): () => void }
type Fn = (kind: string) => void
const KINDS = ['status', 'work_order', 'job', 'resync']
export const RETRY_MS = 5000, RETRY_MAX_MS = 60_000
const CLOSED = 2
const shared = new Map<string, { fns: Set<Fn>; stop: () => void }>()

const browserPage: Page = {
  hidden: () => typeof document !== 'undefined' && document.hidden,
  onChange: f => {
    if (typeof document === 'undefined') return () => {}
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  },
}

/** 모델별 EventSource 하나를 페이지 안에서 공유(참조 카운트) — 구독자가 0 이 되면 닫는다.
 *  - 일시 끊김: 브라우저가 알아서 재연결, 두 번째 open 부터 resync(놓친 이벤트 보정)
 *  - 영구 종료(재연결 응답이 502·429·404 등 → readyState 2): 5·10·20·40·60초(상한) 지수 백오프로 새로 만들고 첫 open 을 resync 로. open 되면 5초로 초기화
 *  - 숨은 탭: 연결을 닫고(HTTP/1.1 호스트당 6연결 절약·서버 구독자 감소) 보이면 다시 열어 resync */
export function subscribe(modelId: string, fn: Fn, make: (url: string) => EventSourceLike = u => new EventSource(u) as unknown as EventSourceLike, page: Page = browserPage): () => void {
  let s = shared.get(modelId)
  if (!s) {
    const fns = new Set<Fn>()
    let es: EventSourceLike | undefined, timer: ReturnType<typeof setTimeout> | undefined, fails = 0
    const open = (resync: boolean) => {
      const cur = make(`/api/models/${modelId}/stream`)
      for (const k of KINDS) cur.addEventListener(k, () => fns.forEach(f => f(k)))
      cur.addEventListener('error', () => {
        if (cur !== es || cur.readyState !== CLOSED) return   // 브라우저가 재연결 중이면 맡긴다
        cur.close(); es = undefined
        timer = setTimeout(() => { timer = undefined; open(true) }, Math.min(RETRY_MS * 2 ** fails++, RETRY_MAX_MS))   // 삭제된 모델(404) 탭이 5초마다 치던 것 완화
      })
      cur.onopen = () => { fails = 0; if (resync) fns.forEach(f => f('resync')); resync = true }
      es = cur
    }
    const close = () => { clearTimeout(timer); timer = undefined; es?.close(); es = undefined }
    const offPage = page.onChange(() => { if (page.hidden()) close(); else if (!es && !timer) open(true) })
    if (!page.hidden()) open(false)
    s = { fns, stop: () => { offPage(); close() } }
    shared.set(modelId, s)
  }
  const entry = s
  entry.fns.add(fn)
  return () => { entry.fns.delete(fn); if (!entry.fns.size) { entry.stop(); shared.delete(modelId) } }
}

/** 마지막 호출 ms 뒤 한 번. cancel() 로 대기 중인 호출 취소(언마운트 뒤 fetch 방지) */
export const debounce = (fn: () => void, ms: number) => {
  let t: ReturnType<typeof setTimeout> | undefined
  return Object.assign(() => { clearTimeout(t); t = setTimeout(fn, ms) }, { cancel: () => clearTimeout(t) })
}

/** kinds 이벤트(+resync)마다 300ms 디바운스 후 fn. 60초 안전망 폴링 — SSE 를 막는 프록시 대비 */
export function useStream(modelId: string, kinds: string[], fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })   // 렌더 중이 아니라 커밋 후 최신 fn 반영 — react(refs) 회피
  const key = kinds.join()
  useEffect(() => {
    const run = debounce(() => ref.current(), 300), want = new Set([...key.split(','), 'resync'])
    const off = subscribe(modelId, k => { if (want.has(k)) run() })
    const t = setInterval(() => ref.current(), 60_000)
    return () => { off(); run.cancel(); clearInterval(t) }
  }, [modelId, key])
}
