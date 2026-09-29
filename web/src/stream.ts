import { useEffect, useRef } from 'react'

/** 서버 푸시 — GET /api/models/{id}/stream (SSE). 이벤트는 '다시 조회' 신호로만 쓴다(R2-1) */
type EventSourceLike = { addEventListener(k: string, f: () => void): void; close(): void; onopen: (() => void) | null }
type Fn = (kind: string) => void
const KINDS = ['status', 'work_order', 'job', 'resync']
const shared = new Map<string, { es: EventSourceLike; fns: Set<Fn> }>()

/** 모델별 EventSource 하나를 페이지 안에서 공유(참조 카운트) — 구독자가 0 이 되면 닫는다. 브라우저가 끊기면 알아서 재연결하고, 두 번째 open 부터는 resync 로 알린다(놓친 이벤트 보정) */
export function subscribe(modelId: string, fn: Fn, make: (url: string) => EventSourceLike = u => new EventSource(u) as unknown as EventSourceLike): () => void {
  let s = shared.get(modelId)
  if (!s) {
    const es = make(`/api/models/${modelId}/stream`), fns = new Set<Fn>()
    for (const k of KINDS) es.addEventListener(k, () => fns.forEach(f => f(k)))
    let opened = false
    es.onopen = () => { if (opened) fns.forEach(f => f('resync')); opened = true }
    s = { es, fns }; shared.set(modelId, s)
  }
  const entry = s
  entry.fns.add(fn)
  return () => { entry.fns.delete(fn); if (!entry.fns.size) { entry.es.close(); shared.delete(modelId) } }
}

export const debounce = (fn: () => void, ms: number) => { let t: ReturnType<typeof setTimeout> | undefined; return () => { clearTimeout(t); t = setTimeout(fn, ms) } }

/** kinds 이벤트(+resync)마다 300ms 디바운스 후 fn. 60초 안전망 폴링 — SSE 를 막는 프록시 대비 */
export function useStream(modelId: string, kinds: string[], fn: () => void) {
  const ref = useRef(fn)
  useEffect(() => { ref.current = fn })   // 렌더 중이 아니라 커밋 후 최신 fn 반영 — react(refs) 회피
  const key = kinds.join()
  useEffect(() => {
    const run = debounce(() => ref.current(), 300), want = new Set([...key.split(','), 'resync'])
    const off = subscribe(modelId, k => { if (want.has(k)) run() })
    const t = setInterval(() => ref.current(), 60_000)
    return () => { off(); clearInterval(t) }
  }, [modelId, key])
}
