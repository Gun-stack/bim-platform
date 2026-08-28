import { useEffect, useMemo, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Check, Combine, EyeOff, Focus, Grid2x2, Home, Link, Maximize, RectangleHorizontal, RotateCcw, Scissors, type LucideIcon } from 'lucide-react'
import { api, type ElementDetail, type ElementRow, type Model, type SpatialNode } from '../api'
import { Scene3D, type Kind, type Stats, type View } from './scene'
import LeftPanel, { type Hidden, type Opts } from './LeftPanel'

export default function Viewer({ modelId }: { modelId: string }) {
  const canvas = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene3D>(null)
  const [model, setModel] = useState<Model>()
  const [spatial, setSpatial] = useState<SpatialNode[]>([])
  const [elements, setElements] = useState<ElementRow[]>([])
  const [selected, setSelected] = useState<ElementDetail | { globalId: string; kind?: Kind }>()
  const [opts, setOpts] = useState<Opts>({ openings: false, spaces: true, merged: false })
  const [hidden, setHidden] = useState<Hidden>({ nodes: new Set(), classes: new Set(), gids: new Set() })
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
  const hiddenNodes = useMemo(() => {   // 숨긴 spatial_node 와 그 하위 전부
    const ids = new Set(hidden.nodes); let grew = true
    while (grew) { grew = false; for (const s of spatial) if (s.parentId != null && ids.has(s.parentId) && !ids.has(s.id)) { ids.add(s.id); grew = true } }
    return ids
  }, [spatial, hidden.nodes])
  const spaceStorey = useMemo(() => new Map(spatial.filter(s => s.ifcClass === 'IfcSpace').map(s => [s.globalId, s.parentId])), [spatial])

  // 씬 생성 · glb 로드 (한 번)
  useEffect(() => {
    if (!model?.glbUrl || !canvas.current || !elements.length || scene.current) return
    const s = new Scene3D(canvas.current); scene.current = s
    s.onPick = (gid, kind) => {
      if (!gid) return setSelected(undefined)
      if (!byGid.has(gid)) return setSelected({ globalId: gid, kind })   // Space / Opening
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

  useEffect(() => {   // 트리 눈 토글 + 표시 옵션 → 표시 조건
    scene.current?.setVisible((gid, kind) => {
      if (kind === 'opening') return opts.openings
      if (kind === 'space') return opts.spaces && !hiddenNodes.has(spaceStorey.get(gid) ?? -1) && !hidden.gids.has(gid)
      const e = byGid.get(gid)!
      if (hidden.gids.has(gid) || hidden.classes.has(e.ifcClass)) return false
      if (e.spatialNodeId != null && hiddenNodes.has(e.spatialNodeId)) return false
      return true
    })
  }, [opts.openings, opts.spaces, hiddenNodes, hidden, byGid, bounds])
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
  const focusRows = (gids: string[], select?: string) => { const s = scene.current; if (!s) return; s.fitAll(gids); if (select) s.select(select) }

  return (
    <Group orientation="horizontal" style={{ height: '100vh', fontFamily: 'system-ui', fontSize: 13 }}>
      <Panel defaultSize={300} minSize={200} collapsible collapsedSize={0}>
        <LeftPanel model={model} stats={stats} spatial={spatial} elements={elements} hidden={hidden} setHidden={setHidden} opts={opts} setOpts={setOpts} onFocus={focusRows} />
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
              {storeys.filter(st => st.elevation != null).map(st => <button key={st.id} onClick={() => setClip(st.elevation! + 1.5)} title="층 바닥 +1.5m" style={{ whiteSpace: 'nowrap' }}>{st.name}</button>)}
            </div>
          )}

          {/* 하단 툴바 */}
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: '#fff', padding: 4, borderRadius: 10, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d' }}>
            <Tool icon={Home} label="홈" onClick={() => scene.current?.preset('home')} />
            <Tool icon={Maximize} label="선택 요소에 맞춤 (더블클릭)" onClick={() => scene.current?.fit(scene.current.selected)} />
            <Tool icon={Grid2x2} label="평면" onClick={() => scene.current?.preset('top')} />
            <Tool icon={RectangleHorizontal} label="정면" onClick={() => scene.current?.preset('front')} />
            <Gap />
            <Tool icon={Focus} label="격리 — 선택 외 반투명" hint="요소를 먼저 선택" active={focus === 'ghost'} disabled={!selected} onClick={() => setFocus(focus === 'ghost' ? 'none' : 'ghost')} />
            <Tool icon={EyeOff} label="나머지 숨김" hint="요소를 먼저 선택" active={focus === 'hide'} disabled={!selected} onClick={() => setFocus(focus === 'hide' ? 'none' : 'hide')} />
            <Tool icon={RotateCcw} label="격리·숨김 해제" hint="적용된 격리·숨김 없음" disabled={focus === 'none'} onClick={() => setFocus('none')} />
            <Gap />
            <Tool icon={Scissors} label="수평 단면 — 층 스냅 가능" active={clip != null} disabled={!bounds} onClick={() => setClip(clip == null ? bounds!.max[1] - 0.01 : null)} />
            <Tool icon={Combine} label="재질별 병합 — draw call 줄이기" active={opts.merged} onClick={() => setOpts(o => ({ ...o, merged: !o.merged }))} />
            <Gap />
            <Tool icon={copied ? Check : Link} label="현재 뷰·선택·단면을 URL 로 복사" onClick={share} />
          </div>
        </div>
      </Panel>
      <Separator style={sep} />

      <Panel defaultSize={340} minSize={200} collapsible collapsedSize={0}>
        <aside style={{ overflow: 'auto', height: '100%', padding: 12, boxSizing: 'border-box' }}>
          {!selected && <p style={{ color: '#888' }}>요소를 클릭하면 속성이 표시됩니다.</p>}
          {selected && !('properties' in selected) && <p>glb 노드 <code>{selected.globalId}</code> — {selected.kind === 'space' ? 'IfcSpace (spatial_node)' : 'IfcOpeningElement (element 테이블 제외)'}</p>}
          {selected && 'properties' in selected && !scene.current?.has(selected.globalId) && <p style={{ color: '#a60', fontSize: 12 }}>이 요소는 glb 에 형상이 없습니다 (IFC 에 Representation 없음 또는 변환 시 제외).</p>}
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

const sep = { width: 4, background: '#e5e5e5', cursor: 'col-resize' }

function Tool({ icon: Icon, label, hint, onClick, active, disabled }: { icon: LucideIcon; label: string; hint?: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  const [hov, setHov] = useState(false)
  return <span style={{ position: 'relative', display: 'inline-block' }} onPointerEnter={() => setHov(true)} onPointerLeave={() => setHov(false)}>
    <button aria-label={label} onClick={onClick} disabled={disabled}
      style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0, borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
               background: active ? '#2563eb' : hov && !disabled ? '#eef2ff' : 'transparent', color: active ? '#fff' : disabled ? '#c5c5c5' : '#333', transition: 'background .12s' }}>
      <Icon size={18} strokeWidth={1.8} /></button>
    {hov && <span style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: '#222', color: '#fff', padding: '4px 8px', borderRadius: 4, fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: '0 2px 6px #0003' }}>
      {label}{disabled && hint && <span style={{ color: '#aaa' }}> · {hint}</span>}</span>}
  </span>
}

const Gap = () => <span style={{ width: 1, background: '#e3e3e3', margin: '6px 4px' }} />

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
