import { useEffect, useState } from 'react'

type Model = {
  id: string; name: string; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  ifcSchema?: string; elementCount?: number; progress: number; error?: string; glbUrl?: string
}
const api = (path: string, init?: RequestInit) => fetch('/api' + path, init).then(async r => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? r.statusText)
  return r.json()
})

export default function App() {
  const [pid, setPid] = useState<string>()
  const [models, setModels] = useState<Model[]>([])
  const [err, setErr] = useState<string>()

  // 프로젝트 하나로 시작. 목록·선택 UI 는 M3(지도) 에서.
  useEffect(() => {
    api('/projects').then(async (ps: { id: string }[]) => {
      const p = ps[0] ?? await api('/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'demo' }) })
      setPid(p.id); setModels(await api(`/projects/${p.id}/models`))
    }).catch(e => setErr(e.message))
  }, [])

  // 진행 중인 모델마다 SSE 구독. 종료 상태면 서버가 닫는다.
  useEffect(() => {
    const active = models.filter(m => m.status === 'UPLOADED' || m.status === 'PROCESSING')
    const sources = active.map(m => {
      const es = new EventSource(`/api/models/${m.id}/events`)
      es.addEventListener('status', e => {
        const u: Model = JSON.parse((e as MessageEvent).data)
        setModels(ms => ms.map(x => x.id === u.id ? u : x))
      })
      es.onerror = () => es.close()
      return es
    })
    return () => sources.forEach(s => s.close())
  }, [models.map(m => m.id + m.status).join()])

  const upload = async (file: File) => {
    setErr(undefined)
    const fd = new FormData(); fd.append('file', file)
    try {
      const m = await api(`/projects/${pid}/models`, { method: 'POST', body: fd })
      setModels(ms => [{ progress: 0, ...m }, ...ms])
    }
    catch (e) { setErr((e as Error).message) }
  }

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 720, margin: '2rem auto' }}>
      <h1>bim-platform</h1>
      <input type="file" accept=".ifc" disabled={!pid} onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
      {err && <p style={{ color: 'crimson' }}>{err}</p>}
      <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
        <thead><tr><th align="left">모델</th><th>상태</th><th>스키마</th><th>요소</th><th align="left">진행</th></tr></thead>
        <tbody>{models.map(m => (
          <tr key={m.id} style={{ borderTop: '1px solid #ddd' }}>
            <td>{m.status === 'READY' ? <a href={m.glbUrl}>{m.name}</a> : m.name}</td>
            <td align="center">{m.status}</td>
            <td align="center">{m.ifcSchema ?? '-'}</td>
            <td align="center">{m.elementCount ?? '-'}</td>
            <td>{m.status === 'FAILED'
              ? <code style={{ color: 'crimson', whiteSpace: 'pre-wrap', fontSize: 12 }}>{m.error?.trim().split('\n').at(-1)}</code>
              : <progress value={m.progress} max={100} style={{ width: '100%' }} />}</td>
          </tr>))}
        </tbody>
      </table>
    </main>
  )
}
