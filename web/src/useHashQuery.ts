import { useEffect, useMemo, useState } from 'react'

/** 해시 쿼리스트링 구독 (#/path?a=b 의 a=b). 해시가 같으면 같은 객체 — effect deps 에 그대로 써도 된다 */
export function useHashQuery(): URLSearchParams {
  const [q, setQ] = useState(() => location.hash.split('?')[1] ?? '')
  useEffect(() => { const f = () => setQ(location.hash.split('?')[1] ?? ''); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return useMemo(() => new URLSearchParams(q), [q])
}

/** 화면 필터를 해시 쿼리에 반영 (§7-3 "이동은 전부 해시 딥링크" — 필터 상태도 공유·북마크 가능하게).
 *  replaceState 라 hashchange 가 안 나서 구독자 리렌더 없음 — 초기값 읽기 전용 동기화 */
export const setHashParam = (k: string, v?: string | null) => {
  const [p, qs] = location.hash.split('?'); const q = new URLSearchParams(qs ?? '')
  if (v == null || v === '') q.delete(k); else q.set(k, v)
  history.replaceState(null, '', `${p}${q.size ? '?' + q.toString() : ''}`)
}
