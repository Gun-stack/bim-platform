import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { Check, Combine, Copy, Eye, Palette, Ruler, Trash2, X, XCircle, EyeOff, Focus, Grid2x2, Home, Link, Maximize, RectangleHorizontal, RotateCcw, Scissors, type LucideIcon } from 'lucide-react'
import { api, type Asset, type ElementDetail, type ElementRow, type Model, type SpatialNode, type Viewpoint, type WorkOrder } from '../api'
import { StatusBadge, day } from './FmPanel'
import FmPanel from './FmPanel'
import { Scene3D, type Kind, type Stats, type View } from './scene'
import LeftPanel, { type Hidden, type Opts, type SelectMode } from './LeftPanel'
import ColorPanel from './ColorPanel'
import ContextMenu, { type MenuItem } from './ContextMenu'
import './viewer.css'

export default function Viewer({ modelId }: { modelId: string }) {
  const canvas = useRef<HTMLDivElement>(null)
  const scene = useRef<Scene3D>(null)
  const [model, setModel] = useState<Model>()
  const [spatial, setSpatial] = useState<SpatialNode[]>([])
  const [elements, setElements] = useState<ElementRow[]>([])
  const [selection, setSelection] = useState<string[]>([])            // 선택 집합 (GlobalId)
  const [detail, setDetail] = useState<ElementDetail | { globalId: string; kind?: Kind }>()   // 1개 선택 시 상세
  const [details, setDetails] = useState<ElementDetail[]>([])          // 여러 개 선택 시 공통 Pset 계산용 (최대 20)
  const selSet = useMemo(() => new Set(selection), [selection])
  const [opts, setOpts] = useState<Opts>({ openings: false, spaces: true, merged: false })
  const [hidden, setHidden] = useState<Hidden>({ nodes: new Set(), classes: new Set(), gids: new Set() })
  const [stats, setStats] = useState<Stats>({ calls: 0, triangles: 0, fps: 0 })
  const [err, setErr] = useState<string>()
  const [clip, setClip] = useState<number[] | null>(null)   // [xmin,xmax,ymin,ymax,zmin,zmax]
  const [measuring, setMeasuring] = useState(false)
  const [measures, setMeasures] = useState<{ a: number[]; b: number[]; d: number }[]>([])
  const [bounds, setBounds] = useState<{ min: number[]; max: number[] }>()
  const [focus, setFocus] = useState<'none' | 'ghost'>('none')
  const [hover, setHover] = useState<{ x: number; y: number; text: string }>()
  const [copied, setCopied] = useState(false)
  const [colorMode, setColorMode] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const [tab, setTab] = useState<'props' | 'fm'>(() => new URLSearchParams(location.hash.split('?')[1] ?? '').has('fm') || new URLSearchParams(location.hash.split('?')[1] ?? '').has('wo') ? 'fm' : 'props')
  const [wo, setWo] = useState<WorkOrder>()   // ?wo= 로 열었을 때 상단 배너
  useEffect(() => { const id = new URLSearchParams(location.hash.split('?')[1] ?? '').get('wo'); if (id) api(`/work-orders/${id}`).then(setWo).catch(() => {}); else setWo(undefined) }, [modelId])
  const [assets, setAssets] = useState<Asset[]>([])
  const reloadAssets = () => api(`/models/${modelId}/assets`).then(setAssets)
  useEffect(() => { reloadAssets() }, [modelId])
  const assetByGid = useMemo(() => new Map(assets.filter(a => a.globalId).map(a => [a.globalId!, a])), [assets])

  useEffect(() => {
    setErr(undefined)
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

  // 씬 생성 · glb 로드 (한 번). byGid 등은 마운트 시점 값으로 고정 — 의도적
  useEffect(() => {
    if (!model?.glbUrl || !canvas.current || !elements.length || scene.current) return
    const el = canvas.current   // cleanup 에서 ref 대신 이 변수를 쓴다
    const s = new Scene3D(el); scene.current = s
    s.onPick = setSelection
    s.load(model.glbUrl, gid => byGid.has(gid) ? 'element' : spaceGids.has(gid) ? 'space' : 'opening').then(() => {
      setBounds(s.bounds())
      const vp = readViewpoint()   // URL 뷰포인트 복원
      if (vp?.v) s.setView(vp.v)
      if (vp?.clip) setClip(vp.clip)
      if (vp?.sel) s.select(vp.sel.split(','))
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
    el.addEventListener('pointermove', onMove)
    s.onContext = (x, y) => setMenu({ x, y })
    s.onMeasure = m => setMeasures(ms => [...ms, m])
    const t = setInterval(() => setStats(s.stats()), 500)
    return () => { clearInterval(t); el.removeEventListener('pointermove', onMove); s.dispose(); scene.current = null }
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.glbUrl, elements.length])

  useEffect(() => {   // 트리 눈 토글 + 표시 옵션 → 표시 조건
    scene.current?.setVisible((gid, kind) => {
      if (kind === 'opening') return opts.openings
      if (hidden.solo && !hidden.solo.gids.has(gid)) return false   // 솔로: 집합 밖은 전부 숨김
      if (kind === 'space') return opts.spaces && !hiddenNodes.has(spaceStorey.get(gid) ?? -1) && !hidden.gids.has(gid)
      const e = byGid.get(gid)!
      if (hidden.gids.has(gid) || hidden.classes.has(e.ifcClass)) return false
      if (e.spatialNodeId != null && hiddenNodes.has(e.spatialNodeId)) return false
      return true
    })
  }, [opts.openings, opts.spaces, hiddenNodes, hidden, byGid, spaceStorey, bounds])
  useEffect(() => {   // 선택 → 상세(1개) / 요약용 상세들(여러 개, 최대 20)
    const fetch1 = (gid: string) => api(`/models/${modelId}/elements/${encodeURIComponent(gid)}`) as Promise<ElementDetail>
    if (selection.length === 1) {
      const gid = selection[0]
      if (!byGid.has(gid)) setDetail({ globalId: gid, kind: spaceGids.has(gid) ? 'space' : 'opening' })
      else fetch1(gid).then(setDetail).catch(e => setErr(e.message))
    } else setDetail(undefined)
    if (selection.length > 1) Promise.all(selection.filter(g => byGid.has(g)).slice(0, 20).map(fetch1)).then(setDetails).catch(() => setDetails([]))
    else setDetails([])
  }, [selection, byGid, spaceGids, modelId])
  useEffect(() => { scene.current?.setMerged(opts.merged) }, [opts.merged])
  useEffect(() => { scene.current?.setClipBox(clip) }, [clip, bounds])
  useEffect(() => { if (scene.current) scene.current.measuring = measuring }, [measuring])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && setMeasuring(false); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [])
  useEffect(() => {   // 격리(반투명) — 선택 집합 기준. "나머지 숨김" 은 트리 솔로와 같은 모델
    scene.current?.setFocus(focus !== 'ghost' || !selSet.size ? undefined : { mode: 'ghost', gids: selSet })
  }, [focus, selSet])
  const soloSelected = () => {
    if (!selection.length) return
    const cur = hidden.solo?.key === 'sel'
    setHidden({ ...hidden, solo: cur ? undefined : { key: 'sel', label: selection.length === 1 ? (byGid.get(selection[0])?.name ?? selection[0]) : `선택 ${selection.length}개`, gids: selSet } })
  }
  const hideSelected = () => { const g = new Set(hidden.gids); for (const x of selection) g.add(x); setHidden({ ...hidden, gids: g }); scene.current?.select([]) }
  const anyHidden = hidden.nodes.size + hidden.classes.size + hidden.gids.size > 0 || !!hidden.solo
  const menuItems = (): MenuItem[] => {
    const n = selection.length, none = n === 0, label = n === 1 ? (byGid.get(selection[0])?.name ?? selection[0]) : `${n}개`
    return [
      { icon: Maximize, label: none ? '전체 보기' : `맞춤: ${label}`, hint: 'dbl', onClick: () => scene.current?.fit() },
      'sep',
      { icon: Focus, label: focus === 'ghost' ? '격리 해제' : '격리 (나머지 반투명)', disabled: none && focus !== 'ghost', onClick: () => setFocus(focus === 'ghost' ? 'none' : 'ghost') },
      { icon: EyeOff, label: hidden.solo?.key === 'sel' ? '선택만 보기 해제' : '선택만 보기', disabled: none && hidden.solo?.key !== 'sel', onClick: soloSelected },
      { icon: EyeOff, label: '숨김', disabled: none, onClick: hideSelected },
      { icon: Eye, label: '숨긴 것 모두 표시', disabled: !anyHidden, onClick: () => { setHidden({ nodes: new Set(), classes: new Set(), gids: new Set() }); setFocus('none') } },
      'sep',
      { icon: Copy, label: n === 1 ? 'GlobalId 복사' : `GlobalId ${n}개 복사`, disabled: none, onClick: () => navigator.clipboard?.writeText(selection.join('\n')) },
      { icon: XCircle, label: '선택 해제', hint: 'Esc', disabled: none, onClick: () => scene.current?.select([]) },
    ]
  }
  const onContext = (e: React.MouseEvent, gids: string[]) => {
    e.preventDefault()
    if (gids.length && !gids.every(g => selSet.has(g))) scene.current?.select(gids)
    setMenu({ x: e.clientX, y: e.clientY })
  }
  const onSelect = (gids: string[], mode: SelectMode) => scene.current?.select(gids, mode === 'toggle' ? 'toggle' : 'set')

  const viewpoint = (): Viewpoint => { const s = scene.current!; const v = s.getView(); return { v: [...v.p, ...v.t], sel: s.selected.length ? s.selected : undefined, clip: clip ? clip.map(n => +n.toFixed(2)) : undefined } }
  const share = () => {   // 현재 카메라·선택·단면 → URL
    const s = scene.current; if (!s) return
    const vp = viewpoint(), p = new URLSearchParams({ v: vp.v!.join(',') })
    if (vp.sel) p.set('sel', vp.sel.join(','))
    if (vp.clip) p.set('clip', vp.clip.join(','))
    history.replaceState(null, '', `#/models/${modelId}?${p}`)
    navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const storeys = spatial.filter(s => s.ifcClass === 'IfcBuildingStorey').sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))

  return (
    <Group orientation="horizontal" style={{ height: '100vh', fontFamily: 'system-ui', fontSize: 13 }}>
      <Panel defaultSize={300} minSize={200} collapsible collapsedSize={0}>
        <LeftPanel model={model} stats={stats} spatial={spatial} elements={elements} hidden={hidden} setHidden={setHidden} opts={opts} setOpts={setOpts} selected={selSet} onSelect={onSelect} onContext={onContext} />
      </Panel>
      <Separator style={sep} />

      <Panel minSize={200}>
        <div ref={canvas} style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
          {err && <p style={{ position: 'absolute', top: 8, left: 8, color: 'crimson', background: '#fff', padding: 6 }}>{err}</p>}
          {hover && <div style={{ position: 'fixed', left: hover.x + 12, top: hover.y + 12, background: '#222', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 12, pointerEvents: 'none' }}>{hover.text}</div>}

          {colorMode && <ColorPanel modelId={modelId} elements={elements} spatial={spatial} onChange={m => scene.current?.setColors(m)}
            onSolo={(label, gids) => setHidden({ ...hidden, solo: hidden.solo?.key === 'v:' + label ? undefined : { key: 'v:' + label, label, gids: new Set(gids) } })} onClose={() => setColorMode(false)} />}

          {/* 작업지시로 진입: 배너 */}
          {wo && <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, maxWidth: 420 }}>
            <StatusBadge s={wo.status} /><b>{wo.title}</b><span style={{ color: '#666' }}>{wo.assetTag} · {wo.assignee ?? '미배정'}{wo.dueOn && ` · ~${day(wo.dueOn)}`}</span>
            <a href={`#/models/${modelId}/fm`} style={{ color: '#2563eb', marginLeft: 4 }}>보드</a>
            <X size={14} style={{ cursor: 'pointer', color: '#888' }} onClick={() => setWo(undefined)} /></div>}

          {/* 솔로 칩: 패널이 아니라 캔버스 위에 — 트리 레이아웃이 밀리지 않게 */}
          {hidden.solo && <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: '#2563eb', color: '#fff', borderRadius: 999, fontSize: 12, boxShadow: '0 2px 8px #0003', maxWidth: 320 }}>
            <Focus size={13} /> 이것만 보기: <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hidden.solo.label}</b>
            <X size={14} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setHidden({ ...hidden, solo: undefined })} /></div>}

          {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(undefined)} />}

          {/* 섹션 박스: 단면 모드일 때만 */}
          {clip && bounds && (
            <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', background: '#fff', padding: '8px 12px', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '4px 8px', alignItems: 'center', minWidth: 380 }}>
              {(['X', 'Y', 'Z'] as const).map((ax, a) => <Axis key={ax} name={ax} min={bounds.min[a]} max={bounds.max[a]} lo={clip[a * 2]} hi={clip[a * 2 + 1]}
                onChange={(lo, hi) => setClip(c => { const n = [...c!]; n[a * 2] = lo; n[a * 2 + 1] = hi; return n })} />)}
              <span style={{ color: '#666' }}>층</span>
              <div style={{ gridColumn: '2 / 4', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {storeys.filter(st => st.elevation != null).map(st => <button key={st.id} onClick={() => setClip(c => { const n = [...c!]; n[3] = st.elevation! + 1.5; return n })} title="바닥 +1.5m 에서 수평 절단" style={{ whiteSpace: 'nowrap' }}>{st.name}</button>)}
                <button onClick={() => setClip([...bounds.min.flatMap((m, i) => [m, bounds.max[i]])])} title="박스 초기화">초기화</button>
              </div>
            </div>
          )}

          {/* 측정 목록 */}
          {measuring && (
            <div style={{ position: 'absolute', top: clip ? 128 : 8, left: 8, background: '#fff', padding: '8px 10px', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Ruler size={13} /> <b style={{ flex: 1 }}>측정</b>
                <Trash2 size={13} style={{ cursor: 'pointer', color: measures.length ? '#666' : '#ccc' }} onClick={() => { scene.current?.clearMeasures(); setMeasures([]) }} /></div>
              <div style={{ color: '#888' }}>면 위 두 점을 클릭 · Esc 로 종료</div>
              {measures.map((m, i) => <div key={i} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <b style={{ width: 64 }}>{m.d.toFixed(2)} m</b>
                <span style={{ color: '#888' }}>Δx {Math.abs(m.b[0] - m.a[0]).toFixed(2)} · Δy {Math.abs(m.b[1] - m.a[1]).toFixed(2)} · Δz {Math.abs(m.b[2] - m.a[2]).toFixed(2)}</span></div>)}
            </div>
          )}

          {/* 하단 툴바 */}
          <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 2, background: '#fff', padding: 4, borderRadius: 10, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d' }}>
            <Tool icon={Home} label="홈" onClick={() => scene.current?.preset('home')} />
            <Tool icon={Maximize} label="선택 요소에 맞춤 (더블클릭)" onClick={() => scene.current?.fit()} />
            <Tool icon={Grid2x2} label="평면" onClick={() => scene.current?.preset('top')} />
            <Tool icon={RectangleHorizontal} label="정면" onClick={() => scene.current?.preset('front')} />
            <Gap />
            <Tool icon={Focus} label="격리 — 선택 외 반투명" hint="요소를 먼저 선택" active={focus === 'ghost'} disabled={!selection.length} onClick={() => setFocus(focus === 'ghost' ? 'none' : 'ghost')} />
            <Tool icon={EyeOff} label="선택만 보기 (나머지 숨김)" hint="요소를 먼저 선택" active={hidden.solo?.key === 'sel'} disabled={!selection.length} onClick={soloSelected} />
            <Tool icon={RotateCcw} label="격리·솔로 해제" hint="적용된 격리·솔로 없음" disabled={focus === 'none' && !hidden.solo} onClick={() => { setFocus('none'); if (hidden.solo) setHidden({ ...hidden, solo: undefined }) }} />
            <Gap />
            <Tool icon={Scissors} label="섹션 박스 — X/Y/Z 범위, 층 스냅" active={!!clip} disabled={!bounds} onClick={() => setClip(clip ? null : bounds!.min.flatMap((m, i) => [m, bounds!.max[i]]))} />
            <Tool icon={Ruler} label="측정 — 면 위 두 점 거리" active={measuring} onClick={() => setMeasuring(!measuring)} />
            <Tool icon={Palette} label="속성별 색상 — 클래스·층·Pset 값으로 색칠" active={colorMode} onClick={() => setColorMode(!colorMode)} />
            <Tool icon={Combine} label="재질별 병합 — draw call 줄이기" active={opts.merged} onClick={() => setOpts(o => ({ ...o, merged: !o.merged }))} />
            <Gap />
            <Tool icon={copied ? Check : Link} label="현재 뷰·선택·단면을 URL 로 복사" onClick={share} />
          </div>
        </div>
      </Panel>
      <Separator style={sep} />

      <Panel defaultSize={340} minSize={200} collapsible collapsedSize={0}>
        <aside style={{ overflow: 'auto', height: '100%', padding: 12, boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5', marginBottom: 10 }}>
            {(['props', 'fm'] as const).map(t => <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '6px 0', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: tab === t ? '#2563eb' : '#666', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}>
              {t === 'props' ? '속성' : `자산 · FM${selection.length === 1 && assetByGid.has(selection[0]) ? ' ●' : ''}`}</button>)}
          </div>
          {tab === 'fm' && <FmPanel modelId={modelId} selection={selection} byGid={byGid} detail={detail && 'properties' in detail ? detail : undefined} assets={assets} reload={reloadAssets} viewpoint={viewpoint} />}
          {tab === 'props' && <>
          {!selection.length && <p style={{ color: '#888' }}>요소를 클릭하면 속성이 표시됩니다.<br /><span style={{ fontSize: 12 }}>Cmd/Ctrl+클릭: 추가 선택 · Shift+클릭(트리): 범위 · Esc: 해제</span></p>}
          {selection.length === 1 && detail && !('properties' in detail) && <p>glb 노드 <code>{detail.globalId}</code> — {detail.kind === 'space' ? 'IfcSpace (spatial_node)' : 'IfcOpeningElement (element 테이블 제외)'}</p>}
          {selection.length === 1 && detail && 'properties' in detail && !scene.current?.has(detail.globalId) && <p style={{ color: '#a60', fontSize: 12 }}>이 요소는 glb 에 형상이 없습니다 (IFC 에 Representation 없음 또는 변환 시 제외).</p>}
          {selection.length === 1 && detail && 'properties' in detail && <Props e={detail} />}
          {selection.length > 1 && <MultiProps selection={selection} byGid={byGid} details={details} />}
          </>}
        </aside>
      </Panel>
    </Group>
  )
}

function readViewpoint(): { v?: View; sel?: string; clip?: number[] } | undefined {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const n = q.get('v')?.split(',').map(Number), c = q.get('clip')?.split(',').map(Number)
  return { v: n?.length === 6 ? { p: n.slice(0, 3), t: n.slice(3) } : undefined, sel: q.get('sel') ?? undefined, clip: c?.length === 6 && c.every(Number.isFinite) ? c : undefined }
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

/** 축 하나의 min/max 범위 슬라이더 (native range 두 개 겹침) */
function Axis({ name, min, max, lo, hi, onChange }: { name: string; min: number; max: number; lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  const st = { width: '100%', margin: 0, position: 'absolute' as const, left: 0, top: 0 }
  return <>
    <span style={{ color: { X: '#e0403a', Y: '#6fa83a', Z: '#3a7de0' }[name as 'X'], fontWeight: 600 }}>{name}</span>
    <div style={{ position: 'relative', height: 20 }}>
      <input type="range" className="dual" min={min} max={max} step={0.05} value={lo} onChange={e => onChange(Math.min(+e.target.value, hi - 0.05), hi)} style={st} />
      <input type="range" className="dual hi" min={min} max={max} step={0.05} value={hi} onChange={e => onChange(lo, Math.max(+e.target.value, lo + 0.05))} style={st} />
    </div>
    <span style={{ color: '#666', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{lo.toFixed(2)} ~ {hi.toFixed(2)} m</span>
  </>
}

/** 여러 개 선택: 클래스별 개수 + 공통 Pset (모두 같은 값만, 다르면 —) */
function MultiProps({ selection, byGid, details }: { selection: string[]; byGid: Map<string, ElementRow>; details: ElementDetail[] }) {
  const classes = new Map<string, number>()
  for (const g of selection) { const c = byGid.get(g)?.ifcClass ?? '(형상만)'; classes.set(c, (classes.get(c) ?? 0) + 1) }
  const common: [string, string][] = []
  if (details.length) {
    const keys = new Set<string>(); for (const d of details) for (const [ps, props] of Object.entries(d.properties)) for (const k of Object.keys(props)) keys.add(ps + '.' + k)
    const order = (k: string) => (k.startsWith('Pset_') || k.startsWith('Qto_') ? '0' : '1') + k
    for (const key of [...keys].sort((a, b) => order(a).localeCompare(order(b)))) {
      const [ps, k] = key.split(/\.(.*)/s), vals = new Set(details.map(d => String(d.properties[ps]?.[k] ?? '')))
      if (vals.size === 1 && !vals.has('')) common.push([key, [...vals][0]])
    }
  }
  return (
    <>
      <b>{selection.length}개 선택</b>
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0 10px' }}><tbody>
        {[...classes].sort((a, b) => b[1] - a[1]).map(([c, n]) => <tr key={c} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: '2px 4px' }}>{c}</td><td align="right" style={{ padding: '2px 4px', color: '#666' }}>{n}</td></tr>)}
      </tbody></table>
      {details.length > 0 && <>
        <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>공통 속성 {details.length < selection.length && `(앞 ${details.length}개 기준)`}</div>
        {common.length ? <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}><tbody>
          {common.map(([k, v]) => <tr key={k} style={{ borderTop: '1px solid #eee' }}><td title={k} style={{ width: '50%', color: '#666', padding: '2px 4px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</td><td style={{ padding: '2px 4px', overflowWrap: 'anywhere' }}>{v}</td></tr>)}
        </tbody></table> : <div style={{ color: '#999' }}>모두 같은 값인 속성 없음</div>}
      </>}
    </>
  )
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
