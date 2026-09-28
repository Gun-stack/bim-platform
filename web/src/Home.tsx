import { useEffect, useRef, useState } from 'react'
import { Building2, Loader2, Trash2, Upload } from 'lucide-react'
import { api, post, type Model } from './api'
import { summary } from './summary'
import { SHELL_H } from './Shell'
import { badge, btn, btnPrimary, dateTime } from './ui'
import { T } from './theme'

/** #/ — 건물 운영 현황: 합계 + 모델 카드(썸네일 · 운영 칩 · 세 화면 진입). 업로드는 버튼 또는 페이지 어디에나 끌어다 놓기 */
export default function Home() {
  const [pid, setPid] = useState<string>()
  const [models, setModels] = useState<Model[]>([])
  const [err, setErr] = useState<string>()
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  // 프로젝트 하나로 시작
  useEffect(() => {
    api<{ id: string }[]>('/projects').then(async ps => {
      const p = ps[0] ?? await post<{ id: string }>('/projects', { name: 'demo' })
      setPid(p.id); setModels(await api<Model[]>(`/projects/${p.id}/models`))
    }).catch(e => setErr(e.message))
  }, [])

  // 진행 중인 모델마다 SSE 구독. 종료 상태면 서버가 닫는다
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
    if (!pid) return
    setErr(undefined); setBusy(true)
    for (const f of Array.from(files)) {
      const fd = new FormData(); fd.append('file', f)
      try { const m = await api<Model>(`/projects/${pid}/models`, { method: 'POST', body: fd }); setModels(ms => [{ ...m, progress: m.progress ?? 0 }, ...ms]) }
      catch (e) { setErr(`${f.name}: ${(e as Error).message}`) }
    }
    setBusy(false)
  }
  const retry = (id: string) => api<Model>(`/models/${id}/retry`, { method: 'POST' })
    .then(u => setModels(ms => ms.map(x => x.id === u.id ? u : x))).catch(e => setErr(e.message))
  const remove = (m: Model) => { if (!window.confirm(`"${m.name}" 모델을 삭제할까요? 자산·작업지시도 함께 지워집니다.`)) return
    setErr(undefined); api(`/models/${m.id}`, { method: 'DELETE' }).then(() => api<Model[]>(`/projects/${pid}/models`)).then(setModels).catch(e => setErr(e.message)) }

  const s = summary(models), converting = models.some(m => m.status === 'PROCESSING' || m.status === 'UPLOADED')
  const kpi = (label: string, n: number, color?: string) => <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}><span style={{ color: T.ink[2], fontSize: T.fs.sm }}>{label}</span><b style={{ fontSize: T.fs.xl, color: n && color ? color : T.ink[1] }}>{n.toLocaleString()}</b></span>

  return (
    <main onDragEnter={e => { if (e.dataTransfer.types.includes('Files')) setDrag(true) }} style={{ fontFamily: 'system-ui', fontSize: T.fs.md, minHeight: `calc(100vh - ${SHELL_H}px)`, boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap', marginBottom: 18 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>건물 운영 현황</h1>
          {kpi('모델', s.models)}{kpi('요소', s.elements)}{kpi('경보', s.alarms, T.crit)}{kpi('장애', s.faults, T.warn)}{kpi('열린 작업지시', s.openWorkOrders, T.accent)}
          {converting && <span style={{ color: T.accent, fontSize: T.fs.sm, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Loader2 size={13} className="spin" /> 변환 중</span>}
          <button onClick={() => file.current?.click()} disabled={!pid || busy} style={{ ...btnPrimary, marginLeft: 'auto', padding: '6px 12px' }} title="IFC2x3 · IFC4 · IFC4x3 — 최대 500MB, 여러 개 가능. 페이지 어디에나 끌어다 놓아도 된다">
            {busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />} IFC 업로드</button>
          <input ref={file} type="file" accept=".ifc" multiple onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = '' }} style={{ display: 'none' }} />
        </div>
        {err && <p style={{ color: T.crit, margin: '0 0 12px' }}>{err}</p>}
        {models.length === 0
          ? <div onClick={() => file.current?.click()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '64px 16px', border: `2px dashed ${T.bg.line}`, borderRadius: T.radius, color: T.ink[2], cursor: 'pointer' }}>
              <Upload size={30} color={T.accent} /><b style={{ color: T.ink[1] }}>IFC 파일을 끌어다 놓거나 클릭해서 선택</b>
              <span style={{ fontSize: T.fs.sm }}>변환 후 3D·모니터링·시설관리로 볼 수 있다 — <code>samples/</code> 에 예제가 있다</span></div>
          : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
              {models.map(m => <Card key={m.id} m={m} onRetry={() => retry(m.id)} onRemove={() => remove(m)} />)}
            </div>}
      </div>
      {drag && <div onDragOver={e => e.preventDefault()} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }}
        style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'grid', placeItems: 'center', background: 'rgba(18,20,23,0.8)', border: `3px dashed ${T.accent}`, color: T.ink[1], fontSize: T.fs.xl, fontWeight: T.fw.bold, pointerEvents: 'auto' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}><Upload size={28} color={T.accent} /> 놓으면 업로드 · 변환 시작</span></div>}
    </main>
  )
}

function Card({ m, onRetry, onRemove }: { m: Model; onRetry: () => void; onRemove: () => void }) {
  const [thumb, setThumb] = useState(true)   // 썸네일 없음(404) → 자리표시
  const ready = m.status === 'READY', running = m.status === 'UPLOADED' || m.status === 'PROCESSING'
  const one = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const
  return (
    <article className="model-card" style={{ position: 'relative', display: 'flex', flexDirection: 'column', background: T.bg.surface, border: `1px solid ${T.bg.line}`, borderRadius: T.radius, overflow: 'hidden' }}>
      <a href={ready ? `#/models/${m.id}` : undefined} aria-label={ready ? `${m.name} 3D 뷰어` : undefined} style={{ aspectRatio: '16 / 10', display: 'grid', placeItems: 'center', background: T.bg.base, borderBottom: `1px solid ${T.bg.line}` }}>
        {ready && thumb ? <img src={`/api/models/${m.id}/thumbnail`} alt="" loading="lazy" onError={() => setThumb(false)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : running ? <Loader2 size={32} className="spin" color={T.accent} /> : <Building2 size={40} color={T.ink[3]} />}
      </a>
      <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        <div title={m.name} style={{ ...one, fontWeight: T.fw.bold, fontSize: T.fs.lg, paddingRight: 24 }}>{m.name}</div>
        <div style={{ ...one, color: T.ink[2], fontSize: T.fs.xs }}>{m.ifcSchema ?? '—'} · 요소 {m.elementCount?.toLocaleString() ?? '—'} · {m.createdAt ? dateTime(m.createdAt) : '—'}</div>
        {ready && <div style={{ display: 'flex', gap: 6, alignItems: 'center', minHeight: 18 }}>
          {!m.alarms && !m.faults && !m.openWorkOrders ? <span style={{ color: T.ink[2], fontSize: T.fs.xs }}>정상</span> : <>
            {!!m.alarms && <span style={badge(T.crit)}>경보 {m.alarms}</span>}
            {!!m.faults && <span style={badge(T.warn)}>장애 {m.faults}</span>}
            {!!m.openWorkOrders && <span style={badge(T.accent)}>작업지시 {m.openWorkOrders}</span>}</>}
        </div>}
        {running && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: T.fs.xs, color: T.accent }}>
          <div style={{ flex: 1, height: 6, background: T.bg.line, borderRadius: T.radius, overflow: 'hidden' }}><div style={{ width: `${m.progress}%`, height: '100%', background: T.accent, transition: 'width .3s' }} /></div>
          {m.status === 'UPLOADED' ? '대기' : `변환 중 ${m.progress}%`}</div>}
        {m.status === 'FAILED' && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span title={m.error} style={{ ...one, flex: 1, color: T.crit, fontSize: T.fs.xs }}>변환 실패 · {m.error?.trim().split('\n').at(-1)}</span>
          <button onClick={onRetry} style={btn}>재시도</button></div>}
        {ready && <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4 }}>
          <a href={`#/models/${m.id}`} style={btnPrimary}>3D 뷰어</a>
          <a href={`#/models/${m.id}/monitor`} style={btn}>모니터링</a>
          <a href={`#/models/${m.id}/fm`} style={btn}>시설관리</a></div>}
      </div>
      {m.status !== 'PROCESSING' && <button onClick={onRemove} title="모델 삭제" aria-label="모델 삭제" className="row-trash" style={{ position: 'absolute', right: 8, bottom: 12, padding: 6, border: 0, borderRadius: T.radius, background: 'transparent', cursor: 'pointer', color: T.ink[2], display: 'inline-flex' }}><Trash2 size={14} /></button>}
    </article>
  )
}
