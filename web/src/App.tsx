import { lazy, Suspense, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import ObjectDock from './ObjectDock'
import Home from './Home'
import Shell, { SHELL_H, type Screen } from './Shell'
import Tour from './Tour'
import { T } from './theme'
const Viewer = lazy(() => import('./viewer/Viewer'))
const FmPage = lazy(() => import('./FmPage'))
const MapPage = lazy(() => import('./MapPage'))
const MonitorPage = lazy(() => import('./MonitorPage'))

// 라우팅은 해시 하나. 상단 바(Shell)는 키오스크만 빼고 전 화면 공통.
// 화면은 모델 id 로 key — 모델 전환 시 새로 마운트해 이전 모델의 ?sel·상태가 새 모델 요청에 섞이지 않게
const useHash = () => {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

export default function App() {
  const h = useHash(), m = h.match(/^#\/models\/([0-9a-f-]{36})(\/fm|\/monitor)?/), kiosk = new URLSearchParams(h.split('?')[1] ?? '').has('kiosk')   // includes('kiosk') 는 ?sel= 값에 우연히 걸린다
  const page = h.startsWith('#/map') ? <MapPage /> : m ? (m[2] === '/fm' ? <FmPage key={m[1]} modelId={m[1]} /> : m[2] === '/monitor' ? <MonitorPage key={m[1]} modelId={m[1]} /> : <Viewer key={m[1]} modelId={m[1]} />) : <Home />
  return <>{!kiosk && <Shell modelId={m?.[1]} screen={(m?.[2] ?? '') as Screen} />}
    <Suspense fallback={<main style={{ minHeight: `calc(100vh - ${SHELL_H}px)`, display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: T.ink[2] }}><Loader2 className="spin" /> 불러오는 중…</main>}>{page}</Suspense>
    {/* 맥락 독: 모델 화면 셋 공통, 벽면(kiosk) 제외 */}
    {m && !kiosk && <ObjectDock modelId={m[1]} route={(m[2] ?? '') as '' | '/monitor' | '/fm'} />}
    {!kiosk && <Tour />}</>
}
