import { useEffect, useMemo, useState } from 'react'

/** 해시 쿼리스트링 구독 (#/path?a=b 의 a=b). 해시가 같으면 같은 객체 — effect deps 에 그대로 써도 된다 */
export function useHashQuery(): URLSearchParams {
  const [q, setQ] = useState(() => location.hash.split('?')[1] ?? '')
  useEffect(() => { const f = () => setQ(location.hash.split('?')[1] ?? ''); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return useMemo(() => new URLSearchParams(q), [q])
}
