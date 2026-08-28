import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
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
  const storeyNodes = useMemo(() => {   // storey 아래(Space 포함) spatial_node id 집합
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
      const vp = readViewpoint()   // URL 뷰포인트 복원
      if (vp?.v) s.setView(vp.v)
      if (vp?.clip != null) setClip(vp.clip)
      if (vp?.sel) s.select(vp.sel)
    }).catch(e => setErr(String(e)))
    let pending = false   // 호버 툴팁: 프레임당 1회
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

  useEffect(() => {   // 필터 → 표시 조건
    scene.current?.setVisible((gid, kind) => {
      if (kind === 'opening') return opts.openings
      if (kind === 'space') return opts.spaces && (storeyNodes == null || storeyNodes.has(spaceStorey.get(gid) ?? -1))
      const e = byGid.get(gid)!
      if (cls && e.ifcClass !== cls) return false
      if (storeyNodes && !(e.spatialNodeId != null && storeyNodes.has(e.spatialNodeId))) return false
      return true
    })
  }, [opts.openings, opts.spaces, storeyNodes, cls, byGid, bounds])
  useEffect(() => { scene.current?.setMerged(opts.merged) }, [opts.merged])
  useEffect(() => { scene.current?.setClip(clip) }, [clip, bounds])
  useEffect(() => {   // 격리/숨김 — 선택 요소 기준
    const gid = selected?.globalId
    scene.current?.setFocus(focus === 'none' || !gid ? undefined : { mode: focus, gids: new Set([gid]) })
  }, [focus, selected?.globalId])

  const share = () => {   // 현재 카메라·선택·단면 → URL
    const s = scene.current; if (!s) return
    const v = s.getView(), p = new URLSearchParams({ v: [...v.p, ...v.t].join(',') })
    if (s.selected) p.set('sel', s.selected)
    if (clip != null) p.set('clip', clip.toFixed(2))
    history.replaceState(null, '', `#/models/${modelId}?${p}`)
    navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const storeys = spatial.filter(s => s.ifcClass === 'IfcBuildingStorey').sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  const classes = useMemo(() => [...new Set(elements.map(e => e.ifcClass))].sort(), [elements])
  const results = useMemo(() => {
    const t = q.trim().toLowerCase(); if (!t) return []
    return elements.filter(e => e.globalId === q.trim() || e.name?.toLowerCase().includes(t)).slice(0, 50)
  }, [elements, q])

  return (
    <Group orientation="horizontal" style={{ height: '100vh', fontFamily: 'system-ui', fontSize: 13 }}>
      <Panel defaultSize={260} minSize={180} collapsible collapsedSize={0}>
        <aside style={{ overflow: 'auto', height: '100%', padding: 10, boxSizing: 'border-box' }}>
          <a href="#/">← 모델 목록</a>
          <h3 style={{ margin: '8px 0 2px' }}>{model?.name ?? '…'}</h3>
          <div style={{ color: '#666' }}>{model?.ifcSchema} · 요소 {model?.elementCount} · draw calls <b>{stats.calls}</b> · {stats.fps} fps</div>

          <Section title="표시">
            <label style={row}><input type="checkbox" checked={opts.openings} onChange={e => setOpts({ ...opts, openings: e.target.checked })} /> IfcOpeningElement (창·문 구멍)</label>
            <label style={row}><input type="checkbox" checked={opts.spaces} onChange={e => setOpts({ ...opts, spaces: e.target.checked })} /> IfcSpace 반투명 ({spaceGids.size})</label>
            <label style={row}><input type="checkbox" checked={opts.merged} onChange={e => setOpts({ ...opts, merged: e.target.checked })} /> 재질별 병합 (draw call ↓)</label>
            <div style={{ color: '#666' }}>삼각형 {stats.triangles.toLocaleString()}</div>
          </Section>

          <Section title="필터">
            <select value={cls ?? ''} onChange={e => setCls(e.target.value || undefined)} style={{ width: '100%' }}>
              <option value="">모든 클래스 ({elements.length})</option>
              {classes.map(c => <option key={c} value={c}>{c} ({elements.filter(e => e.ifcClass === c).length})</option>)}
            </select>
          </Section>

          <Section title="공간 구조">
            <div style={{ ...row, cursor: 'pointer', fontWeight: storey == null ? 'bold' : undefined }} onClick={() => setStorey(undefined)}>전체</div>
            <Tree nodes={spatial} parent={null} depth={0} storey={storey} onStorey={setStorey} onFocus={g => scene.current?.focus(g)} />
          </Section>

          <Section title="검색">
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 또는 GlobalId" style={{ width: '100%', boxSizing: 'border-box' }} />
            {results.map(r => <div key={r.globalId} style={{ ...row, cursor: 'pointer' }} onClick={() => scene.current?.focus(r.globalId)}>
              <span style={{ color: '#666' }}>{r.ifcClass.replace('Ifc', '')}</span> {r.name}</div>)}
            {q && !results.length && <div style={{ color: '#888' }}>없음</div>}
          </Section>
        </aside>
      </Panel>
      <Separator style={sep} />

      <Panel minSize={200}>
        <div ref={canvas} style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
          {err && <p style={{ position: 'absolute', top: 8, left: 8, color: 'crimson', background: '#fff', padding: 6 }}>{err}</p>}
          {hover && <div style={{ position: 'fixed', left: hover.x + 12, top: hover.y + 12, background: '#222', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 12, pointerEvents: 'none' }}>{hover.text}</div>}

          {/* 단면 슬라이더: 단면 모드일 때만 */}
          {clip != null && bounds && (
            <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: '6px 10px', borderRadius: 6, boxShadow: '0 1px 4px #0003', display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>단면 <b>{clip.toFixed(2)}m</b></span>
              <input type="range" min={bounds.min[1]} max={bounds.max[1]} step={0.05} value={clip} onChange={e => setClip(+e.target.value)} style={{ width: 180 }} />
              {storeys.filter(st => st.elevation != null).map(st => <button key={st.id} onClick={() => setClip(st.elevation! + 1.5)} title="층 바닥 +1.5m">{st.name}</button>)}
            </div>
          )}

          {/* 하단 툴바 */}
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: '#fff', padding: 4, borderRadius: 8, boxShadow: '0 1px 4px #0003' }}>
            <Tool icon="⌂" label="홈" onClick={() => scene.current?.preset('home')} />
            <Tool icon="⤢" label="핏 (더블클릭)" onClick={() => scene.current?.fit(scene.current.selected)} />
            <Tool icon="▦" label="평면" onClick={() => scene.current?.preset('top')} />
            <Tool icon="▭" label="정면" onClick={() => scene.current?.preset('front')} />
            <Gap />
            <Tool icon="◐" label="격리 (선택 외 반투명)" active={focus === 'ghost'} disabled={!selected} onClick={() => setFocus(focus === 'ghost' ? 'none' : 'ghost')} />
            <Tool icon="◌" label="나머지 숨김" active={focus === 'hide'} disabled={!selected} onClick={() => setFocus(focus === 'hide' ? 'none' : 'hide')} />
            <Tool icon="⟲" label="전체 표시" disabled={focus === 'none'} onClick={() => setFocus('none')} />
            <Gap />
            <Tool icon="⊟" label="수평 단면" active={clip != null} disabled={!bounds} onClick={() => setClip(clip == null ? bounds!.max[1] - 0.01 : null)} />
            <Tool icon="⧉" label="재질별 병합" active={opts.merged} onClick={() => setOpts({ ...opts, merged: !opts.merged })} />
            <Gap />
            <Tool icon={copied ? '✓' : '⛓'} label="뷰포인트 URL 복사" onClick={share} />
          </div>
        </div>
      </Panel>
      <Separator style={sep} />

      <Panel defaultSize={340} minSize={200} collapsible collapsedSize={0}>
        <aside style={{ overflow: 'auto', height: '100%', padding: 12, boxSizing: 'border-box' }}>
          {!selected && <p style={{ color: '#888' }}>요소를 클릭하면 속성이 표시됩니다.</p>}
          {selected && !('properties' in selected) && <p>glb 노드 <code>{selected.globalId}</code> — {selected.kind === 'space' ? 'IfcSpace (spatial_node)' : 'IfcOpeningElement (element 테이블 제외)'}</p>}
          {selected && 'properties' in selected && <Props e={selected} />}
        </aside>
      </Panel>
    </Group>
  )
}

function readViewpoint(): { v?: View; sel?: string; clip?: number } | undefined {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const n = q.get('v')?.split(',').map(Number)
  return { v: n?.length === 6 ? { p: n.slice(0, 3), t: n.slice(3) } : undefined, sel: q.get('sel') ?? undefined, clip: q.has('clip') ? +q.get('clip')! : undefined }
}

const row = { display: 'block', padding: '2px 0' }
const sep = { width: 4, background: '#e5e5e5', cursor: 'col-resize' }

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details open style={{ marginTop: 10 }}>
      <summary style={{ fontSize: 12, color: '#444', textTransform: 'uppercase', cursor: 'pointer', userSelect: 'none' }}>{title}</summary>
      <div style={{ padding: '4px 0 0 2px' }}>{children}</div>
    </details>
  )
}

function Tool({ icon, label, onClick, active, disabled }: { icon: string; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return <button title={label} onClick={onClick} disabled={disabled}
    style={{ width: 32, height: 32, fontSize: 16, border: 0, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', background: active ? '#2563eb' : 'transparent', color: active ? '#fff' : disabled ? '#bbb' : '#222' }}>{icon}</button>
}
const Gap = () => <span style={{ width: 1, background: '#ddd', margin: '4px 4px' }} />

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
