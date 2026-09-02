import { lazy, Suspense, useEffect, useState } from 'react'
import { api, post, type Model } from './api'
import { AlertCircle, Box, CheckCircle2, Loader2, MapPin, RotateCcw, Trash2, Upload } from 'lucide-react'
import ObjectDock from './ObjectDock'
const Viewer = lazy(() => import('./viewer/Viewer'))
const FmPage = lazy(() => import('./FmPage'))
const MapPage = lazy(() => import('./MapPage'))
const MonitorPage = lazy(() => import('./MonitorPage'))

// 라우팅은 해시 하나. 페이지가 셋(모델·뷰어·지도) 넘어가면 react-router.
const useHash = () => {
  const [h, setH] = useState(location.hash)
  useEffect(() => { const f = () => setH(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return h
}

export default function App() {
  const h = useHash(), m = h.match(/^#\/models\/([0-9a-f-]{36})(\/fm|\/monitor)?/), kiosk = h.includes('kiosk')
  const page = h.startsWith('#/map') ? <MapPage /> : m ? (m[2] === '/fm' ? <FmPage modelId={m[1]} /> : m[2] === '/monitor' ? <MonitorPage modelId={m[1]} /> : <Viewer modelId={m[1]} />) : <Models />
  return <><Suspense fallback={<main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', color: '#666' }}><Loader2 className="spin" /> 불러오는 중…</main>}>{page}</Suspense>
    {/* 맥락 독: 모델 화면 셋 공통, 벽면(kiosk) 제외 */}
    {m && !kiosk && <ObjectDock modelId={m[1]} route={(m[2] ?? '') as '' | '/monitor' | '/fm'} />}</>
}

function Models() {
  const [pid, setPid] = useState<string>()
  const [models, setModels] = useState<Model[]>([])
  const [err, setErr] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)

  // 프로젝트 하나로 시작. 목록·선택 UI 는 M3(지도) 에서.
  useEffect(() => {
    api<{ id: string }[]>('/projects').then(async ps => {
      const p = ps[0] ?? await post<{ id: string }>('/projects', { name: 'demo' })
      setPid(p.id); setModels(await api<Model[]>(`/projects/${p.id}/models`))
    }).catch(e => setErr(e.message))
  }, [])

  // 진행 중인 모델마다 SSE 구독. 종료 상태면 서버가 닫는다.
  const activeKey = models.filter(m => m.status === 'UPLOADED' || m.status === 'PROCESSING').map(m => m.id).join()
  useEffect(() => {
    const sources = activeKey.split(',').filter(Boolean).map(id => {
      const es = new EventSource(`/api/models/${id}/events`)
      es.addEventListener('status', e => { const u: Model = JSON.parse((e as MessageEvent).data); setModels(ms => ms.map(x => x.id === u.id ? u : x)) })
      es.onerror = () => es.close()
      return es
    })
    return () => sources.forEach(s => s.close())
  }, [activeKey])

  const upload = async (files: FileList | File[]) => {
    setErr(undefined); setBusy(true)
    for (const file of Array.from(files)) {
      const fd = new FormData(); fd.append('file', file)
      try { const m = await api<Model>(`/projects/${pid}/models`, { method: 'POST', body: fd }); setModels(ms => [{ ...m, progress: m.progress ?? 0 }, ...ms]) }
      catch (e) { setErr(`${file.name}: ${(e as Error).message}`) }
    }
    setBusy(false)
  }
  const retry = (id: string) => api<Model>(`/models/${id}/retry`, { method: 'POST' })
    .then(u => setModels(ms => ms.map(x => x.id === u.id ? u : x))).catch(e => setErr(e.message))
  const remove = (m: Model) => { if (!window.confirm(`"${m.name}" 모델을 삭제할까요? 자산·작업지시도 함께 지워집니다.`)) return
    setErr(undefined); api(`/models/${m.id}`, { method: 'DELETE' }).then(() => api<Model[]>(`/projects/${pid}/models`)).then(setModels).catch(e => setErr(e.message)) }

  return (
    <main style={{ fontFamily: 'system-ui', fontSize: 13, maxWidth: 980, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, display: 'flex', alignItems: 'center', gap: 8 }}><Box size={22} /> bim-platform</h1>
        <span style={{ color: '#888' }}>프로젝트 demo · 모델 {models.length}개{models.some(m => m.status === 'PROCESSING' || m.status === 'UPLOADED') ? ' · 변환 중' : ''}</span>
        <a href="#/map" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, textDecoration: 'none', color: '#222', fontSize: 12 }}><MapPin size={13} /> 지도</a>
      </div>

      <label onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
             onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}
             style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '28px 16px', border: '2px dashed ' + (drag ? '#2563eb' : '#cfd4dc'), borderRadius: 10,
                      background: drag ? '#eef2ff' : '#fafafa', color: '#555', cursor: pid ? 'pointer' : 'default', transition: 'all .12s' }}>
        {busy ? <Loader2 size={26} className="spin" style={{ color: '#2563eb' }} /> : <Upload size={26} style={{ color: '#2563eb' }} />}
        <b>IFC 파일을 끌어다 놓거나 클릭해서 선택</b>
        <span style={{ color: '#888', fontSize: 12 }}>IFC2x3 · IFC4 · IFC4x3 — 최대 500MB, 여러 개 가능</span>
        <input type="file" accept=".ifc" multiple disabled={!pid} onChange={e => e.target.files && upload(e.target.files)} style={{ display: 'none' }} />
      </label>
      {err && <p style={{ color: '#b91c1c', display: 'flex', gap: 6, alignItems: 'center' }}><AlertCircle size={14} /> {err}</p>}

      <div style={{ marginTop: 20, border: '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 100px 70px 64px minmax(120px, 160px) 232px 28px', gap: 8, padding: '8px 14px', background: '#f5f5f5', color: '#666', fontSize: 12 }}>
          <span>모델</span><span>상태</span><span>스키마</span><span style={{ textAlign: 'right' }}>요소 수</span><span>진행</span><span /></div>
        {models.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>아직 모델이 없습니다. IFC 파일을 올리면 변환 후 3D 로 볼 수 있습니다 — <code>samples/</code> 에 예제 4개가 있습니다.</div>}
        {models.map(m => <Row key={m.id} m={m} onRetry={() => retry(m.id)} onRemove={() => remove(m)} />)}
      </div>
    </main>
  )
}

const STATUS: Record<Model['status'], { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  UPLOADED: { label: '대기', color: '#666', bg: '#eee', icon: Loader2 },
  PROCESSING: { label: '변환 중', color: '#1d4ed8', bg: '#dbe4ff', icon: Loader2 },
  READY: { label: '변환 완료', color: '#15803d', bg: '#dcfce7', icon: CheckCircle2 },
  FAILED: { label: '실패', color: '#b91c1c', bg: '#fee2e2', icon: AlertCircle },
}

function Row({ m, onRetry, onRemove }: { m: Model; onRetry: () => void; onRemove: () => void }) {
  const st = STATUS[m.status], Icon = st.icon, running = m.status === 'UPLOADED' || m.status === 'PROCESSING'
  return (
    <div className="model-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) 100px 70px 64px minmax(120px, 160px) 232px 28px', gap: 8, alignItems: 'center', padding: '10px 14px', borderTop: '1px solid #eee' }}>
      <div style={{ overflow: 'hidden' }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.name}>{m.name}</div>
        <div style={{ color: '#999', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.id.slice(0, 8)} · {m.createdAt ? new Date(m.createdAt).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</div>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: st.bg, color: st.color, fontSize: 12, width: 'fit-content' }}>
        <Icon size={12} className={running ? 'spin' : undefined} /> {st.label}</span>
      <span>{m.ifcSchema ?? '—'}</span>
      <span style={{ textAlign: 'right' }}>{m.elementCount?.toLocaleString() ?? '—'}</span>
      <div>
        {m.status === 'FAILED'
          ? <code title={m.error} style={{ color: '#b91c1c', fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.error?.trim().split('\n').at(-1)}</code>
          : <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}><div style={{ width: `${m.progress}%`, height: '100%', background: m.status === 'READY' ? '#22c55e' : '#2563eb', transition: 'width .3s' }} /></div>}
      </div>
      <div style={{ textAlign: 'right' }}>
        {m.status === 'READY' && <span style={{ display: 'inline-flex', gap: 4, whiteSpace: 'nowrap' }}>
          <a href={`#/models/${m.id}/monitor`} title="모니터링" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, textDecoration: 'none', fontSize: 12, color: '#222' }}>모니터링</a>
          <a href={`#/models/${m.id}/fm`} title="시설관리" style={{ padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, textDecoration: 'none', fontSize: 12, color: '#222' }}>시설관리</a>
          <a href={`#/models/${m.id}`} style={{ padding: '5px 10px', background: '#2563eb', color: '#fff', borderRadius: 6, textDecoration: 'none', fontSize: 12 }}>3D 뷰어</a></span>}
        {m.status === 'FAILED' && <button onClick={onRetry} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }}><RotateCcw size={12} /> 재시도</button>}
      </div>
      {m.status !== 'PROCESSING' && <button onClick={onRemove} title="모델 삭제" className="row-trash" style={{ padding: 6, border: 0, borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#999', display: 'inline-flex' }}><Trash2 size={14} /></button>}
    </div>
  )
}
