import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type ElementDetail, type ElementRow, type Model, type SpatialNode } from '../api'
import { Scene3D, type Kind, type Stats, type View } from './scene'

type Opts = { openings: boolean; spaces: boolean; merged: boolean }

export default function Viewer({ modelId }: { modelId: string }) {
  const canvas = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene3D>(null)
  const [model, setModel] = useState<Model>()
  const [spatial, setSpatial] = useState<SpatialNode[]>([])
  const [elements, setElements] = useState<ElementRow[]>([])
  const [selected, setSelected] = useState<ElementDetail | { globalId: string; kind?: Kind }>()
  const [opts, setOpts] = useState<Opts>({ openings: false, spaces: true, merged: false })
  const [storey, setStorey] = useState<number>()   // spatial_node.id
  const [cls, setCls] = useState<string>()
  const [q, setQ] = useState('')
  const [stats, setStats] = useState<Stats>({ calls: 0, triangles: 0, fps: 0 })
  const [err, setErr] = useState<string>()
  const [clip, setClip] = useState<number | null>(null)
  const [bounds, setBounds] = useState<{ min: number[]; max: number[] }>()
  const [focus, setFocus] = useState<'none' | 'ghost' | 'hide'>('none')
  const [hover, setHover] = useState<{ x: number; y: number; text: string }>()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    Promise.all([api(`/models/${modelId}`), api(`/models/${modelId}/spatial`), api(`/models/${modelId}/elements`)])
      .then(([m, s, e]) => { setModel(m); setSpatial(s); setElements(e) }).catch(e => setErr(e.message))
  }, [modelId])

  const byGid = useMemo(() => new Map(elements.map(e => [e.globalId, e])), [elements])
  const spaceGids = useMemo(() => new Set(spatial.filter(s => s.ifcClass === 'IfcSpace').map(s => s.globalId)), [spatial])
  // storey 아래(Space 포함) spatial_node id 집합
  const storeyNodes = useMemo(() => {
    if (storey == null) return undefined
    const ids = new Set([storey]); let grew = true
    while (grew) { grew = false; for (const s of spatial) if (s.parentId != null && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); grew = true } }
    return ids
  }, [spatial, storey])
  const spaceStorey = useMemo(() => new Map(spatial.filter(s => s.ifcClass === 'IfcSpace').map(s => [s.globalId, s.parentId])), [spatial])

  // 씬 생성 · glb 로드 (한 번)
  useEffect(() => {
    if (!model?.glbUrl || !canvas.current || !elements.length || scene.current) return
    const s = new Scene3D(canvas.current); scene.current = s
    s.onPick = (gid, kind) => {
      if (!gid) return setSelected(undefined)
      if (kind !== 'element') return setSelected({ globalId: gid, kind })
      api(`/models/${modelId}/elements/${encodeURIComponent(gid)}`).then(setSelected).catch(e => setErr(e.message))
    }
    s.load(model.glbUrl, gid => byGid.has(gid) ? 'element' : spaceGids.has(gid) ? 'space' : 'opening').then(() => {
      setBounds(s.bounds())
      const vp = readViewpoint()   // B: URL 에 실린 뷰포인트 복원
      if (vp?.v) s.setView(vp.v)
      if (vp?.clip != null) setClip(vp.clip)
      if (vp?.sel) s.select(vp.sel)
    }).catch(e => setErr(String(e)))
    // D: 호버 툴팁 (pointermove 는 프레임당 1회로 제한)
    let pending = false
    const onMove = (e: PointerEvent) => {
      if (pending) return; pending = true
      requestAnimationFrame(() => {
        pending = false
        const gid = s.hover(e.clientX, e.clientY), el = gid ? byGid.get(gid) : undefined
        setHover(gid ? { x: e.clientX, y: e.clientY, text: el ? `${el.ifcClass} ${el.name ?? ''}` : spaceGids.has(gid) ? 'IfcSpace' : 'IfcOpeningElement' } : undefined)
      })
    }
    canvas.current.addEventListener('pointermove', onMove)
    const t = setInterval(() => setStats(s.stats()), 500)
    return () => { clearInterval(t); canvas.current?.removeEventListener('pointermove', onMove); s.dispose(); scene.current = null }
  }, [model?.glbUrl, elements.length])

  // 필터 → 표시 조건
  useEffect(() => {
    scene.current?.setVisible((gid, kind) => {
      if (kind === 'opening') return opts.openings
      if (kind === 'space') return opts.spaces && (storeyNodes == null || storeyNodes.has(spaceStorey.get(gid) ?? -1))
      const e = byGid.get(gid)!
      if (cls && e.ifcClass !== cls) return false
      if (storeyNodes && !(e.spatialNodeId != null && storeyNodes.has(e.spatialNodeId))) return false
      return true
    })
  }, [opts.openings, opts.spaces, storeyNodes, cls, byGid, stats.calls === 0])
  useEffect(() => { scene.current?.setMerged(opts.merged) }, [opts.merged])
  useEffect(() => { scene.current?.setClip(clip) }, [clip, bounds])
  // C: 격리/숨김 — 선택 요소(+ 검색 결과) 기준
  useEffect(() => {
    const gid = selected?.globalId
    scene.current?.setFocus(focus === 'none' || !gid ? undefined : { mode: focus, gids: new Set([gid]) })
  }, [focus, selected?.globalId])

  const share = () => {   // B: 현재 카메라·선택·단면을 URL 에
    const s = scene.current; if (!s) return
    const v = s.getView(), q = new URLSearchParams({ v: [...v.p, ...v.t].join(',') })
    if (s.selected) q.set('sel', s.selected)
    if (clip != null) q.set('clip', clip.toFixed(2))
    history.replaceState(null, '', `#/models/${modelId}?${q}`)
    navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const storeys = spatial.filter(s => s.ifcClass === 'IfcBuildingStorey').sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  const classes = useMemo(() => [...new Set(elements.map(e => e.ifcClass))].sort(), [elements])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return []
    return elements.filter(e => e.globalId === q.trim() || e.name?.toLowerCase().includes(t)).slice(0, 50)
  }, [elements, q])
  const glbNodes = { total: stats.calls, elements: elements.length, spaces: spaceGids.size }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 340px', height: '100vh', fontFamily: 'system-ui', fontSize: 13 }}>
      <aside style={{ overflow: 'auto', padding: 10, borderRight: '1px solid #ddd' }}>
        <a href="#/">← 모델 목록</a>
        <h3 style={{ margin: '8px 0 2px' }}>{model?.name ?? '…'}</h3>
        <div style={{ color: '#666' }}>{model?.ifcSchema} · 요소 {model?.elementCount}</div>

        <h4 style={sec}>표시</h4>
        <label style={row}><input type="checkbox" checked={opts.openings} onChange={e => setOpts({ ...opts, openings: e.target.checked })} /> IfcOpeningElement (창·문 구멍)</label>
        <label style={row}><input type="checkbox" checked={opts.spaces} onChange={e => setOpts({ ...opts, spaces: e.target.checked })} /> IfcSpace 반투명 ({glbNodes.spaces})</label>
        <label style={row}><input type="checkbox" checked={opts.merged} onChange={e => setOpts({ ...opts, merged: e.target.checked })} /> 재질별 병합 (draw call ↓)</label>
        <div style={{ color: '#666', marginTop: 4 }}>draw calls <b>{stats.calls}</b> · 삼각형 {stats.triangles.toLocaleString()} · {stats.fps} fps</div>

        <h4 style={sec}>뷰</h4>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {(['home', 'top', 'front', 'side'] as const).map(p => <button key={p} onClick={() => scene.current?.preset(p)}>{{ home: '홈', top: '평면', front: '정면', side: '측면' }[p]}</button>)}
          <button onClick={() => scene.current?.fit(scene.current.selected)} title="더블클릭과 동일">핏</button>
          <button onClick={share}>{copied ? '복사됨 ✓' : '뷰포인트 URL'}</button>
        </div>

        <h4 style={sec}>단면 (수평)</h4>
        {bounds && <>
          <label style={row}><input type="checkbox" checked={clip != null} onChange={e => setClip(e.target.checked ? bounds.max[1] : null)} /> 절단 {clip != null && <b>{clip.toFixed(2)}m</b>}</label>
          <input type="range" min={bounds.min[1]} max={bounds.max[1]} step={0.05} value={clip ?? bounds.max[1]} disabled={clip == null}
                 onChange={e => setClip(+e.target.value)} style={{ width: '100%' }} />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {storeys.filter(st => st.elevation != null).map(st => <button key={st.id} onClick={() => setClip(st.elevation! + 1.5)} title="층 바닥 +1.5m (평면도 절단 높이)">{st.name}</button>)}
          </div>
        </>}

        <h4 style={sec}>선택 요소</h4>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['none', 'ghost', 'hide'] as const).map(f => <button key={f} disabled={!selected} onClick={() => setFocus(f)} style={{ fontWeight: focus === f ? 'bold' : undefined }}>{{ none: '전체', ghost: '격리', hide: '나머지 숨김' }[f]}</button>)}
        </div>

        <h4 style={sec}>필터</h4>
        <select value={cls ?? ''} onChange={e => setCls(e.target.value || undefined)} style={{ width: '100%' }}>
          <option value="">모든 클래스 ({elements.length})</option>
          {classes.map(c => <option key={c} value={c}>{c} ({elements.filter(e => e.ifcClass === c).length})</option>)}
        </select>

        <h4 style={sec}>공간 구조</h4>
        <div style={{ ...row, cursor: 'pointer', fontWeight: storey == null ? 'bold' : undefined }} onClick={() => setStorey(undefined)}>전체</div>
        <Tree nodes={spatial} parent={null} depth={0} storey={storey} onStorey={setStorey} onFocus={g => scene.current?.focus(g)} />
        {storeys.length === 0 && spatial.length > 0 && <div style={{ color: '#888' }}>층 정보 없음</div>}

        <h4 style={sec}>검색</h4>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 또는 GlobalId" style={{ width: '100%', boxSizing: 'border-box' }} />
        {results.map(r => <div key={r.globalId} style={{ ...row, cursor: 'pointer' }} onClick={() => scene.current?.focus(r.globalId)}>
          <span style={{ color: '#666' }}>{r.ifcClass.replace('Ifc', '')}</span> {r.name}</div>)}
        {q && !results.length && <div style={{ color: '#888' }}>없음</div>}
      </aside>

      <div ref={canvas} style={{ position: 'relative', minWidth: 0 }}>
        {err && <p style={{ position: 'absolute', top: 8, left: 8, color: 'crimson', background: '#fff', padding: 6 }}>{err}</p>}
        {hover && <div style={{ position: 'fixed', left: hover.x + 12, top: hover.y + 12, background: '#222', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 12, pointerEvents: 'none' }}>{hover.text}</div>}
      </div>

      <aside style={{ overflow: 'auto', padding: 12, borderLeft: '1px solid #ddd' }}>
        {!selected && <p style={{ color: '#888' }}>요소를 클릭하면 속성이 표시됩니다.</p>}
        {selected && !('properties' in selected) && <p>glb 노드 <code>{selected.globalId}</code> — {selected.kind === 'space' ? 'IfcSpace (spatial_node)' : 'IfcOpeningElement (element 테이블 제외)'}</p>}
        {selected && 'properties' in selected && <Props e={selected} />}
      </aside>
    </div>
  )
}

function readViewpoint(): { v?: View; sel?: string; clip?: number } | undefined {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const n = q.get('v')?.split(',').map(Number)
  return { v: n?.length === 6 ? { p: n.slice(0, 3), t: n.slice(3) } : undefined, sel: q.get('sel') ?? undefined, clip: q.has('clip') ? +q.get('clip')! : undefined }
}

const sec = { margin: '14px 0 4px', fontSize: 12, color: '#444', textTransform: 'uppercase' as const }
const row = { display: 'block', padding: '2px 0' }

function Tree({ nodes, parent, depth, storey, onStorey, onFocus }: {
  nodes: SpatialNode[]; parent: number | null; depth: number; storey?: number; onStorey: (id: number) => void; onFocus: (gid: string) => void
}) {
  return <>{nodes.filter(n => n.parentId === parent).map(n => (
    <div key={n.id}>
      <div style={{ paddingLeft: depth * 12, cursor: 'pointer', fontWeight: n.id === storey ? 'bold' : undefined }}
           onClick={() => n.ifcClass === 'IfcBuildingStorey' ? onStorey(n.id) : n.ifcClass === 'IfcSpace' ? onFocus(n.globalId) : undefined}>
        <span style={{ color: '#888' }}>{n.ifcClass.replace('Ifc', '')}</span> {n.name ?? '(이름 없음)'}{n.elevation != null && <span style={{ color: '#aaa' }}> {n.elevation.toFixed(2)}m</span>}
      </div>
      <Tree nodes={nodes} parent={n.id} depth={depth + 1} storey={storey} onStorey={onStorey} onFocus={onFocus} />
    </div>
  ))}</>
}

function Props({ e }: { e: ElementDetail }) {
  return (
    <>
      <b>{e.ifcClass}</b> <span>{e.name}</span>
      <div style={{ color: '#666', margin: '4px 0 8px' }}>{e.spatialClass} {e.spatialName} · <code>{e.globalId}</code></div>
      {Object.entries(e.properties).map(([pset, props]) => (
        <details key={pset} open={pset.startsWith('Pset_')}>
          <summary>{pset}</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {Object.entries(props).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #eee' }}><td style={{ color: '#666', padding: '2px 4px', whiteSpace: 'nowrap' }}>{k}</td><td style={{ padding: '2px 4px', wordBreak: 'break-all' }}>{String(v)}</td></tr>
            ))}
          </tbody></table>
        </details>
      ))}
    </>
  )
}
