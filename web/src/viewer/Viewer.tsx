import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { MapPinned, Check, Copy, Route as RouteIcon, Wrench, Tag, Eye, Palette, Ruler, Trash2, X, XCircle, EyeOff, Focus, Grid2x2, Home, Link, Maximize, RectangleHorizontal, RotateCcw, Scissors, type LucideIcon } from 'lucide-react'
import { api, type Asset, type ElementDetail, type ElementRow, type Model, type PowerResult, type Route, type SpatialNode, type SystemMember, type Viewpoint, type WorkOrder } from '../api'
import { AlertToast, useAlerts } from '../useAlerts'
import SystemPanel, { STATUS_COLOR, StatusBoard, systemColor } from './SystemPanel'
import { ifcKo } from '../ifcNames'
import { TEAMS } from '../teams'
import { StatusBadge, day } from './FmPanel'
import StatusEditor from './StatusEditor'
import FmPanel from './FmPanel'
import { Scene3D, type Kind, type Stats, type View } from './scene'
import LeftPanel, { STRUCT, type Hidden, type Opts, type SelectMode } from './LeftPanel'
import ColorPanel from './ColorPanel'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { useHashQuery } from '../useHashQuery'
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
  // 표시 옵션 저장은 LeftPanel 버튼 클릭 시(flipOpt) — focusOn 등 프로그램적 변경이 사용자 저장값을 덮지 않게
  const [opts, setOpts] = useState<Opts>(() => { const d: Opts = { openings: false, spaces: true, merged: false, grid: true }; try { return { ...d, ...JSON.parse(localStorage.getItem('viewer.opts') ?? '{}') } } catch { return d } })
  const [hidden, setHidden] = useState<Hidden>(() => { let s = false; try { s = localStorage.getItem('viewer.structHidden') === '1' } catch { /* 저장 불가 환경 */ } return { nodes: new Set(), classes: new Set(s ? STRUCT : []), gids: new Set() } })   // 구조체 숨김 기억
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
  const [sysMembers, setSysMembers] = useState<Map<number, SystemMember[]>>(new Map())
  const [sysColor, setSysColor] = useState(false)     // 계통별 색
  const [route, setRoute] = useState<Route>()          // 추적 결과
  const [systemsMeta, setSystemsMeta] = useState<{ id: number; name: string; predefinedType: string | null }[]>([])
  const [power, setPower] = useState<PowerResult>()
  const [statusView, setStatusView] = useState(false); const [boardCollapsed, setBoardCollapsed] = useState(false)
  const [assetDetail, setAssetDetail] = useState<{ id: string; workOrders: WorkOrder[] }>()
  const [focusInfo, setFocusInfo] = useState<{ gid: string; name: string; zone?: string; storey?: string; status?: string; spaceGid?: string }>()
  const [loaded, setLoaded] = useState(false)   // glb 로드 완료 — 딥링크 재적용 effect 가드
  /** 경보/장애 요소로 포커스: 구역 반투명 강조 + 요소 하이라이트 + 위층 단면 + 구역에 카메라 */
  const focusOn = (gid: string) => {
    const s = scene.current, el = byGid.get(gid); if (!s || !el) return
    const node = el.spatialNodeId != null ? spatial.find(n => n.id === el.spatialNodeId) : undefined
    const space = node?.ifcClass === 'IfcSpace' ? node : undefined
    const storey = node?.ifcClass === 'IfcBuildingStorey' ? node : node?.parentId != null ? spatial.find(n => n.id === node.parentId) : undefined
    setOpts(o => ({ ...o, spaces: true })); setRoute(undefined); setPower(undefined)
    setHidden(h => ({ ...h, solo: undefined }))
    s.select([gid])
    setFocus('ghost')
    s.preset('home')   // 건물 전체가 보이는 홈 뷰 — 어느 층·어느 구역인지 한눈에 (길찾기용, 줌인하지 않음)
    const st = statusRows.find(r => r.globalId === gid)?.status.Status
    setFocusInfo({ gid, name: el.name ?? gid, zone: space?.name ?? undefined, storey: storey?.name ?? undefined, status: st, spaceGid: space?.globalId })
    s.setMarker(gid, st === 'FAULT' ? 0xf59e0b : 0xdc2626)
  }
  const focusRef = useRef(focusOn); focusRef.current = focusOn
  useEffect(() => { if (focusInfo && !selSet.has(focusInfo.gid)) { setFocusInfo(undefined); setFocus('none'); scene.current?.setMarker(undefined) } }, [selSet, focusInfo])   // 다른 요소를 고르면 포커스 모드(격리·비콘)도 해제 — 배너 X 와 동일
  const { rows: statusRows, fresh: freshAlerts, dismiss: dismissAlert, reload: reloadStatus } = useAlerts(modelId)   // 5초 폴링 — 상태판·트리 배지도 함께 최신 유지
  useEffect(() => { api(`/models/${modelId}/systems`).then(setSystemsMeta).catch(() => setSystemsMeta([])) }, [modelId])
  // 계통별 색: 멤버 → 계통 색. 경로 추적 중이면 경로만 진하게, 나머지 회색 (setColors 의 기본 회색)
  useEffect(() => {
    const s = scene.current; if (!s) return
    if (route) { const m = new Map<string, number>(); for (const n of route.nodes) m.set(n.globalId, n.depth === 0 ? 0xffaa00 : route.direction === 'up' ? 0x2563eb : 0x16a34a); s.setColors(m, true); return }
    if (power) { const m = new Map<string, number>(); for (const g of power.powered) m.set(g, 0x16a34a); for (const g of power.unpowered) m.set(g, 0x374151); s.setColors(m, true); return }
    if (statusView) { const m = new Map<string, number>(); for (const r of statusRows) { const st = r.status; m.set(r.globalId, st.Occupied === true ? 0x64748b : st.On === false ? 0x9ca3af : STATUS_COLOR[st.Status ?? ''] ?? 0x888888) } s.setColors(m, true); return }   // 점유 주차면·소등 조명은 회색
    if (!sysColor || colorMode) { if (!colorMode) s.setColors(undefined); return }
    const m = new Map<string, number>()
    for (const sm of systemsMeta) for (const e of sysMembers.get(sm.id) ?? []) m.set(e.globalId, systemColor(sm))
    s.setColors(m, true)   // 구조체는 반투명 — 계통이 건물 안에서 보이게
  }, [sysColor, sysMembers, systemsMeta, route, colorMode, bounds, power, statusView, statusRows])
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const hq = useHashQuery(), qs = hq.toString(), woId = hq.get('wo'), wantFm = hq.has('fm') || hq.has('wo')
  const [tab, setTab] = useState<'props' | 'fm'>(wantFm ? 'fm' : 'props')
  useEffect(() => { if (wantFm) setTab('fm') }, [wantFm])   // 같은 페이지에서 ?fm/?wo 딥링크가 와도 탭 전환
  const [wo, setWo] = useState<WorkOrder>()   // ?wo= 로 열었을 때 상단 배너
  useEffect(() => { if (woId) api(`/work-orders/${woId}`).then(setWo).catch(() => {}); else setWo(undefined) }, [woId])
  const [assets, setAssets] = useState<Asset[]>([])
  const reloadAssets = useCallback(() => api(`/models/${modelId}/assets`).then(setAssets), [modelId])
  useEffect(() => { reloadAssets() }, [reloadAssets])
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
      setBounds(s.bounds()); setLoaded(true)   // 뷰포인트 복원은 아래 딥링크 effect 가 (최초 + hashchange 재적용)
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
    return () => { clearInterval(t); el.removeEventListener('pointermove', onMove); s.dispose(); scene.current = null; setLoaded(false) }
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [model?.glbUrl, elements.length])

  // 같은 페이지 딥링크 재적용: hashchange 마다 URL 의 v/sel/clip/focus 를 다시 적용 — 씬 재로드 없음.
  // share() 는 history.replaceState 라 hashchange 가 안 떠 루프 없음. 동일 해시 재클릭은 이벤트 미발생 — 허용.
  useEffect(() => {
    const s = scene.current; if (!loaded || !s) return
    const vp = readViewpoint()
    if (vp?.v) s.setView(vp.v)
    if (vp?.clip) setClip(vp.clip)
    if (vp?.sel) { const sel = vp.sel.split(','); s.select(sel); if (vp.focus) setTimeout(() => focusRef.current(sel[0]), 300) }   // byGid·spatial 준비 후
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, qs])

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
  }, [selection, byGid, spaceGids, modelId, statusRows])
  useEffect(() => { scene.current?.setMerged(opts.merged) }, [opts.merged])
  useEffect(() => { scene.current?.setGrid(opts.grid) }, [opts.grid, bounds])   // bounds: 로드 뒤에야 크기·바닥을 안다
  useEffect(() => { scene.current?.setClipBox(clip) }, [clip, bounds])
  useEffect(() => { if (scene.current) scene.current.measuring = measuring }, [measuring])
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && setMeasuring(false); addEventListener('keydown', k); return () => removeEventListener('keydown', k) }, [])
  useEffect(() => {   // 격리(반투명) — 선택 집합 기준 (+ 포커스 모드면 구역도 함께, 구역은 진한 파랑)
    const spaceGid = focusInfo?.spaceGid
    scene.current?.setFocus(focus !== 'ghost' || !selSet.size ? undefined : { mode: 'ghost', gids: spaceGid ? new Set([...selSet, spaceGid]) : selSet }, spaceGid)
  }, [focus, selSet, focusInfo?.spaceGid])
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
  /** 작업지시용: 선택 요소가 있으면 먼저 그쪽으로 핏한 뒤 저장 — 홈 뷰가 저장되는 일 방지 */
  const viewpointForWorkOrder = (): Viewpoint => { if (scene.current?.selected.length) scene.current.fit(); return viewpoint() }
  const share = () => {   // 현재 카메라·선택·단면 → URL
    const s = scene.current; if (!s) return
    const vp = viewpoint(), p = new URLSearchParams({ v: vp.v!.join(',') })
    if (vp.sel) p.set('sel', vp.sel.join(','))
    if (vp.clip) p.set('clip', vp.clip.join(','))
    history.replaceState(null, '', `#/models/${modelId}?${p}`)
    navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
  }

  const storeys = spatial.filter(s => s.ifcClass === 'IfcBuildingStorey').sort((a, b) => (a.elevation ?? 0) - (b.elevation ?? 0))
  const abnormal = useMemo(() => new Map(statusRows.filter(r => r.status.Status === 'ALARM' || r.status.Status === 'FAULT').map(r => [r.globalId, r.status.Status!])), [statusRows])
  const selAsset = selection.length === 1 ? assetByGid.get(selection[0]) : undefined
  useEffect(() => { if (!selAsset) { setAssetDetail(undefined); return } api(`/assets/${selAsset.id}`).then(setAssetDetail).catch(() => setAssetDetail(undefined)) }, [selAsset?.id, selAsset?.openWorkOrders])   // eslint-disable-line react-hooks/exhaustive-deps
  const selSystems = useMemo(() => selection.length === 1 ? systemsMeta.filter(sm => (sysMembers.get(sm.id) ?? []).some(m => m.globalId === selection[0])) : [], [selection, systemsMeta, sysMembers])
  const routeSummary = useMemo(() => { if (!route) return undefined; const st = new Map<number, string>(); for (const n of spatial) { let c: SpatialNode | undefined = n; while (c && c.ifcClass !== 'IfcBuildingStorey') c = c.parentId == null ? undefined : spatial.find(x => x.id === c!.parentId); if (c?.name) st.set(n.id, c.name) }
    const floors = new Set<string>(); const cls = new Map<string, number>(); for (const n of route.nodes) { const e = byGid.get(n.globalId); if (e?.spatialNodeId != null && st.get(e.spatialNodeId)) floors.add(st.get(e.spatialNodeId)!); cls.set(n.ifcClass, (cls.get(n.ifcClass) ?? 0) + 1) }
    const sorted = [...floors].sort((a, b) => (storeys.find(x => x.name === a)?.elevation ?? 0) - (storeys.find(x => x.name === b)?.elevation ?? 0))
    return { origin: byGid.get(route.globalId)?.name ?? route.globalId, floors: sorted.length > 1 ? `${sorted[0]}~${sorted[sorted.length - 1]}` : sorted[0] ?? '', top: [...cls].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${ifcKo(c)} ${n}`).join(' · ') } }, [route, spatial, byGid, storeys])

  return (
    <Group orientation="horizontal" style={{ height: '100vh', fontFamily: 'system-ui', fontSize: 13 }}>
      <Panel defaultSize={300} minSize={200} collapsible collapsedSize={0}>
        <LeftPanel model={model} stats={stats} spatial={spatial} elements={elements} hidden={hidden} setHidden={setHidden} opts={opts} setOpts={setOpts} selected={selSet} onSelect={onSelect} onContext={onContext} abnormal={abnormal} onFit={() => scene.current?.fit()}
          statusBoard={<StatusBoard rows={statusRows} modelId={modelId} reload={reloadStatus} onSelect={g => focusOn(g[0])} statusView={statusView} setStatusView={setStatusView} power={power} setPower={setPower} collapsed={boardCollapsed} setCollapsed={setBoardCollapsed} />}
          systemPanel={<SystemPanel modelId={modelId} selection={selection} members={sysMembers} setMembers={setSysMembers} route={route} setRoute={setRoute}
            onSolo={(label, gids, key) => setHidden({ ...hidden, solo: hidden.solo?.key === key ? undefined : { key, label, gids: new Set(gids) } })}
            onSelect={gids => scene.current?.select(gids)} colorMode={sysColor} setColorMode={setSysColor} />} />
      </Panel>
      <Separator style={sep} />

      <Panel minSize={200}>
        <div ref={canvas} style={{ position: 'relative', height: '100%', overflow: 'hidden' }}>
          {err && <p style={{ position: 'absolute', top: 8, left: 8, color: 'crimson', background: '#fff', padding: 6 }}>{err}</p>}
          {hover && <div style={{ position: 'fixed', left: hover.x + 12, top: hover.y + 12, background: '#222', color: '#fff', padding: '2px 6px', borderRadius: 3, fontSize: 12, pointerEvents: 'none' }}>{hover.text}</div>}

          {colorMode && <ColorPanel modelId={modelId} elements={elements} spatial={spatial} onChange={m => scene.current?.setColors(m)}
            onSolo={(label, gids) => setHidden({ ...hidden, solo: hidden.solo?.key === 'v:' + label ? undefined : { key: 'v:' + label, label, gids: new Set(gids) } })} onClose={() => setColorMode(false)} />}

          {/* 경보/장애 포커스 배너 (구역 강조 + 위치 비콘) */}
          {focusInfo && <div title="구역 반투명 강조 · 지붕 위 비콘 · 홈 뷰" style={{ position: 'absolute', top: clip ? 128 : wo ? 52 : 8, left: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', padding: '8px 12px', background: focusInfo.status === 'ALARM' ? '#fef2f2' : focusInfo.status === 'FAULT' ? '#fffbeb' : '#fff', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, maxWidth: 460 }}>
            <MapPinned size={14} style={{ color: focusInfo.status === 'ALARM' ? '#dc2626' : focusInfo.status === 'FAULT' ? '#f59e0b' : '#2563eb' }} />
            <b>{focusInfo.storey}{focusInfo.zone ? ` · ${focusInfo.zone} 구역` : ''}</b><span>{focusInfo.name}</span>
            {focusInfo.status && <b style={{ color: focusInfo.status === 'ALARM' ? '#dc2626' : focusInfo.status === 'FAULT' ? '#f59e0b' : '#16a34a' }}>{{ ALARM: '경보', FAULT: '장애', NORMAL: '정상' }[focusInfo.status] ?? focusInfo.status}</b>}
            <a href={`#/models/${modelId}/monitor?sel=${encodeURIComponent(focusInfo.gid)}`} title="모니터링에서 이 장비" style={{ color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}>모니터링</a>
            {(assetByGid.get(focusInfo.gid)?.openWorkOrders ?? 0) > 0 && <a href={`#/models/${modelId}/fm?sel=${encodeURIComponent(focusInfo.gid)}`} title="칸반 보드에서 이 자산의 카드" style={{ color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' }}>칸반</a>}
            <X size={14} style={{ cursor: 'pointer', color: '#888' }} onClick={() => { setFocusInfo(undefined); setFocus('none'); scene.current?.setFocus(undefined); scene.current?.setMarker(undefined) }} /></div>}

          {/* 작업지시로 진입: 배너 */}
          {wo && <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, maxWidth: 420 }}>
            <StatusBadge s={wo.status} /><b>{wo.title}</b><span style={{ color: '#666' }}>{wo.assetTag} · {wo.assignee ?? '미배정'}{wo.dueOn && ` · ~${day(wo.dueOn)}`}</span>
            <a href={`#/models/${modelId}/fm?wo=${wo.id}`} style={{ color: '#2563eb', marginLeft: 4 }}>보드</a>
            <X size={14} style={{ cursor: 'pointer', color: '#888' }} onClick={() => setWo(undefined)} /></div>}

          {/* 솔로 칩: 패널이 아니라 캔버스 위에 — 트리 레이아웃이 밀리지 않게 */}
          {hidden.solo && <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: '#2563eb', color: '#fff', borderRadius: 999, fontSize: 12, boxShadow: '0 2px 8px #0003', maxWidth: 320 }}>
            <Focus size={13} /> 이것만 보기: <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hidden.solo.label}</b>
            <X size={14} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setHidden({ ...hidden, solo: undefined })} /></div>}

          {/* 추적 배너: 3D 에 색만 칠하면 '몇 개·어디까지' 를 모른다 */}
          {route && routeSummary && <div style={{ position: 'absolute', top: clip ? 128 : (focusInfo || wo) ? 52 : 8, left: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, maxWidth: 520 }}>
            <RouteIcon size={14} style={{ color: route.direction === 'up' ? '#2563eb' : '#16a34a' }} />
            <b>{routeSummary.origin}</b><span style={{ color: route.direction === 'up' ? '#2563eb' : '#16a34a', fontWeight: 600 }}>{route.direction === 'up' ? '상류' : '하류'} {route.nodes.length}요소</span>
            {routeSummary.floors && <span style={{ color: '#666' }}>{routeSummary.floors}</span>}<span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{routeSummary.top}</span>
            <span title="경로만 보기" onClick={() => setHidden({ ...hidden, solo: hidden.solo?.key === 'route' ? undefined : { key: 'route', label: '추적 경로', gids: new Set(route.nodes.map(n => n.globalId)) } })} style={{ cursor: 'pointer', color: '#2563eb', display: 'grid' }}><Focus size={13} /></span>
            <X size={14} style={{ cursor: 'pointer', color: '#888' }} onClick={() => setRoute(undefined)} /></div>}

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
              <div style={{ color: '#888' }}>표면의 두 점을 클릭하세요 · Esc 로 종료</div>
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
            <Tool icon={Scissors} label="단면 — X/Y/Z 범위, 층별 자르기" active={!!clip} disabled={!bounds} onClick={() => setClip(clip ? null : bounds!.min.flatMap((m, i) => [m, bounds!.max[i]]))} />
            <Tool icon={Ruler} label="측정 — 면 위 두 점 거리" active={measuring} onClick={() => setMeasuring(!measuring)} />
            <Tool icon={Palette} label="속성별 색상 — 종류·층·속성값으로 칠하기" active={colorMode} onClick={() => setColorMode(!colorMode)} />
            <Gap />
            <Tool icon={copied ? Check : Link} label="현재 화면을 링크로 복사 (뷰·선택·단면 포함)" onClick={share} />
          </div>

          <AlertToast modelId={modelId} fresh={freshAlerts} dismiss={dismissAlert} onFocus={g => focusOn(g)} />
        </div>
      </Panel>
      <Separator style={sep} />

      <Panel defaultSize={340} minSize={200} collapsible collapsedSize={0}>
        <aside style={{ overflow: 'auto', height: '100%', padding: 12, boxSizing: 'border-box' }}>
          {/* 요약 카드: 무엇·어디·어느 팀·자산·작업지시 — 탭을 오가지 않아도 한눈에 */}
          {selection.length === 1 && detail && 'properties' in detail && (() => { const st = (detail.properties.Pset_BimStatus as Record<string, unknown> | undefined)?.Status as string | undefined, sc = STATUS_COLOR[st ?? ''], open = assetDetail?.workOrders.filter(w => w.status !== 'DONE') ?? []; return (
            <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: st === 'ALARM' ? '#fef2f2' : st === 'FAULT' ? '#fffbeb' : '#f8fafc', border: '1px solid ' + (st === 'ALARM' ? '#fecaca' : st === 'FAULT' ? '#fde68a' : '#e5e7eb') }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detail.name ?? ''}>{detail.name}</b>
                {st && <span style={{ padding: '1px 8px', borderRadius: 999, color: '#fff', fontSize: 11, fontWeight: 600, background: '#' + (sc ?? 0x6b7280).toString(16).padStart(6, '0') }}>{{ NORMAL: '정상', ONLINE: '온라인', RUNNING: '운전', STANDBY: '대기', ALARM: '경보', FAULT: '장애', OFFLINE: '오프라인', TRANSFERRED: '절체' }[st] ?? st}</span>}</div>
              <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{ifcKo(detail.ifcClass)} · {detail.spatialName ?? '위치 없음'}{selSystems.length > 0 && <span style={{ marginLeft: 6, display: 'inline-flex', gap: 4 }}>{selSystems.map(sm => { const t = TEAMS.find(t => t.systems.includes(sm.name)); return <span key={sm.id} style={{ fontSize: 10, border: '1px solid ' + (t?.color ?? '#999'), color: t?.color ?? '#666', borderRadius: 4, padding: '0 4px' }}>{sm.name}</span> })}</span>}</div>
              {/* 좁은 패널(기본 340px)에서 단어 중간이 꺾이지 않게: 항목별 nowrap + 컨테이너 wrap */}
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, marginTop: 4 }}>
                {selAsset ? <span style={{ whiteSpace: 'nowrap' }}><Tag size={11} style={{ verticalAlign: -1, color: '#2563eb' }} /> {selAsset.tag}</span> : <span style={{ color: '#999', whiteSpace: 'nowrap' }}><Tag size={11} style={{ verticalAlign: -1 }} /> 자산 미등록</span>}
                {selAsset && (open.length ? <a href={`#/models/${modelId}/fm?wo=${open[0].id}`} title="칸반 보드에서 이 카드 열기" style={{ color: '#1d4ed8', textDecoration: 'none', whiteSpace: 'nowrap' }}><Wrench size={11} style={{ verticalAlign: -1 }} /> 작업지시 {open.length} · {open[0].assignee ?? <span style={{ color: '#b45309' }}>미배정</span>}{open[0].dueOn ? ` ~${day(open[0].dueOn)}` : ''}</a> : <span style={{ color: '#999', whiteSpace: 'nowrap' }}><Wrench size={11} style={{ verticalAlign: -1 }} /> 열린 작업지시 없음</span>)}
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>{/* 두 링크는 한 묶음 — 좁으면 같이 다음 줄 오른쪽으로 */}
                  <a href={`#/models/${modelId}/monitor?sel=${encodeURIComponent(detail.globalId)}`} title="모니터링에서 이 장비" style={{ color: '#2563eb', fontSize: 11, textDecoration: 'none' }}>모니터링 →</a>
                  <a onClick={() => setTab('fm')} style={{ color: '#2563eb', cursor: 'pointer', fontSize: 11 }}>자산·점검 →</a></span></div>
            </div>) })()}
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5', marginBottom: 10 }}>
            {(['props', 'fm'] as const).map(t => <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '6px 0', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: tab === t ? '#2563eb' : '#666', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}>
              {t === 'props' ? '속성' : `자산·점검${selection.length === 1 && assetByGid.has(selection[0]) ? ' ●' : ''}`}</button>)}
          </div>
          {tab === 'fm' && <FmPanel modelId={modelId} selection={selection} byGid={byGid} detail={detail && 'properties' in detail ? detail : undefined} assets={assets} reload={reloadAssets} viewpoint={viewpointForWorkOrder} />}
          {tab === 'props' && <>
          {!selection.length && <p style={{ color: '#888' }} title="Cmd/Ctrl+클릭: 추가 선택 · Shift+클릭(트리): 범위 · Esc: 해제 · 더블클릭: 맞춤">요소를 클릭하면 속성이 표시됩니다. <span style={{ color: '#bbb', cursor: 'help' }}>단축키 ?</span></p>}
          {selection.length === 1 && detail && !('properties' in detail) && <p style={{ color: '#666' }}>{detail.kind === 'space' ? '공간(구역) 형상입니다. 구역 정보는 왼쪽 공간 트리에서 확인하세요.' : '개구부 형상입니다 (요소 아님).'}</p>}
          {selection.length === 1 && detail && 'properties' in detail && !scene.current?.has(detail.globalId) && <p style={{ color: '#a60', fontSize: 12 }}>이 요소는 3D 형상이 없습니다 (IFC 에 형상 정보가 없거나 변환에서 제외됨).</p>}
          {selection.length === 1 && detail && 'properties' in detail && <><StatusEditor key={detail.globalId} modelId={modelId} e={detail} reload={reloadStatus} /><Props e={detail} /></>}
          {selection.length > 1 && <MultiProps selection={selection} byGid={byGid} details={details} />}
          </>}
        </aside>
      </Panel>
    </Group>
  )
}

function readViewpoint(): { v?: View; sel?: string; clip?: number[]; focus?: boolean } | undefined {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '')
  const n = q.get('v')?.split(',').map(Number), c = q.get('clip')?.split(',').map(Number)
  return { v: n?.length === 6 ? { p: n.slice(0, 3), t: n.slice(3) } : undefined, sel: q.get('sel') ?? undefined, clip: c?.length === 6 && c.every(Number.isFinite) ? c : undefined, focus: q.has('focus') }
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
      {Object.entries(e.properties).filter(([pset]) => pset !== 'Pset_BimStatus').map(([pset, props]) => (
        <details key={pset} open={pset.startsWith('Pset_')}>
          <summary>{pset}</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {Object.entries(props).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #eee' }}><td style={{ color: '#666', padding: '2px 4px', whiteSpace: 'nowrap' }}>{k}</td><td style={{ padding: '2px 4px', wordBreak: 'break-all' }}>{String(v)}</td></tr>
            ))}
          </tbody></table>
        </details>
      ))}
      {e.properties.Pset_BimStatus && <details><summary style={{ color: '#999' }}>Pset_BimStatus 원본</summary><pre style={{ fontSize: 11, color: '#666', whiteSpace: 'pre-wrap', margin: '4px 0' }}>{JSON.stringify(e.properties.Pset_BimStatus, null, 1)}</pre></details>}
    </>
  )
}
