import { useEffect, useState } from 'react'

/** 해시 쿼리스트링 구독 (#/path?a=b 의 a=b). 매 렌더 새 객체 — effect deps 에는 .get() 추출값이나 .toString() 을 쓸 것 */
export function useHashQuery(): URLSearchParams {
  const [q, setQ] = useState(() => location.hash.split('?')[1] ?? '')
  useEffect(() => { const f = () => setQ(location.hash.split('?')[1] ?? ''); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return new URLSearchParams(q)
}
