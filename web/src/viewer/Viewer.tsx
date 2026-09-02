import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { MapPinned, Check, Copy, Magnet, Route as RouteIcon, Eye, Palette, Ruler, Trash2, X, XCircle, EyeOff, Focus, Grid2x2, Home, Link, Maximize, RectangleHorizontal, RotateCcw, Scissors } from 'lucide-react'
import { api, type Asset, type AssetDetail, type ElementDetail, type ElementRow, type Model, type PowerResult, type Route, type SpatialNode, type System, type SystemMember, type Viewpoint, type WorkOrder } from '../api'
import { AlertToast, useAlerts } from '../useAlerts'
import SystemPanel, { StatusBoard, systemColor } from './SystemPanel'
import { STATUS, isAbnormal, statusHex, statusLabel } from '../status'
import ObjectSummary from '../ObjectSummary'
import { ifcKo } from '../ifcNames'
import { notify, saveSnap } from '../context'
import { day, useEsc } from '../ui'
import FmPanel, { StatusBadge } from './FmPanel'
import StatusEditor from './StatusEditor'
import { Scene3D, type Kind, type Stats, type View } from './scene'
import LeftPanel, { STRUCT, type Hidden, type Opts, type SelectMode } from './LeftPanel'
import ColorPanel from './ColorPanel'
import ContextMenu, { type MenuItem } from './ContextMenu'
import { Axis, Floating, Gap, Tool } from './chrome'
import { MultiProps, Props } from './Props'
import { useHashQuery } from '../useHashQuery'
import './viewer.css'
import { T, num } from '../theme'

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
  const [systemsMeta, setSystemsMeta] = useState<System[]>([])
  const [power, setPower] = useState<PowerResult>()
  const [statusView, setStatusView] = useState(false); const [boardCollapsed, setBoardCollapsed] = useState(false)
  const [assetDetail, setAssetDetail] = useState<AssetDetail>()
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
    s.setMarker(gid, STATUS[st ?? '']?.color ?? num(T.crit))
  }
  const focusRef = useRef(focusOn); focusRef.current = focusOn
  useEffect(() => { if (focusInfo && !selSet.has(focusInfo.gid)) { setFocusInfo(undefined); setFocus('none'); scene.current?.setMarker(undefined) } }, [selSet, focusInfo])   // 다른 요소를 고르면 포커스 모드(격리·비콘)도 해제 — 배너 X 와 동일
  const { rows: statusRows, fresh: freshAlerts, dismiss: dismissAlert, reload: reloadStatus } = useAlerts(modelId)   // 5초 폴링 — 상태판·트리 배지도 함께 최신 유지
  useEffect(() => { api<System[]>(`/models/${modelId}/systems`).then(setSystemsMeta).catch(() => setSystemsMeta([])) }, [modelId])
  // 계통별 색: 멤버 → 계통 색. 경로 추적 중이면 경로만 진하게, 나머지 회색 (setColors 의 기본 회색)
  useEffect(() => {
    const s = scene.current; if (!s) return
    if (route) { const m = new Map<string, number>(); for (const n of route.nodes) m.set(n.globalId, n.depth === 0 ? num(T.warn) : route.direction === 'up' ? num(T.accent) : num(T.ok)); s.setColors(m, true); return }
    if (power) { const m = new Map<string, number>(); for (const g of power.powered) m.set(g, num(T.ok)); for (const g of power.unpowered) m.set(g, num(T.ink[3])); s.setColors(m, true); return }
    if (statusView) { const m = new Map<string, number>(); for (const r of statusRows) { const st = r.status; m.set(r.globalId, st.Occupied === true ? num(T.ink[3]) : st.On === false ? num(T.ink[3]) : STATUS[st.Status ?? '']?.color ?? num(T.ink[3])) } s.setColors(m, true); return }   // 점유 주차면·소등 조명은 회색
    if (!sysColor || colorMode) { if (!colorMode) s.setColors(undefined); return }
    const m = new Map<string, number>()
    for (const sm of systemsMeta) for (const e of sysMembers.get(sm.id) ?? []) m.set(e.globalId, systemColor(sm))
    s.setColors(m, true)   // 구조체는 반투명 — 계통이 건물 안에서 보이게
  }, [sysColor, sysMembers, systemsMeta, route, colorMode, bounds, power, statusView, statusRows])
  const [menu, setMenu] = useState<{ x: number; y: number }>()
  const hq = useHashQuery(), woId = hq.get('wo'), wantFm = hq.has('fm') || hq.has('wo')
  const [tab, setTab] = useState<'props' | 'fm'>(wantFm ? 'fm' : 'props')
  useEffect(() => { if (wantFm) setTab('fm') }, [wantFm])   // 같은 페이지에서 ?fm/?wo 딥링크가 와도 탭 전환
  const [wo, setWo] = useState<WorkOrder>()   // ?wo= 로 열었을 때 상단 배너
  useEffect(() => { if (woId) api<WorkOrder>(`/work-orders/${woId}`).then(setWo).catch(() => {}); else setWo(undefined) }, [woId])
  const [assets, setAssets] = useState<Asset[]>([])
  const reloadAssets = useCallback(() => api<Asset[]>(`/models/${modelId}/assets`).then(setAssets), [modelId])
  useEffect(() => { reloadAssets() }, [reloadAssets])
  const assetByGid = useMemo(() => new Map(assets.filter(a => a.globalId).map(a => [a.globalId!, a])), [assets])

  useEffect(() => {
    setErr(undefined)
    Promise.all([api<Model>(`/models/${modelId}`), api<SpatialNode[]>(`/models/${modelId}/spatial`), api<ElementRow[]>(`/models/${modelId}/elements`)])
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
    const vp = readViewpoint(hq)
    if (vp.v) s.setView(vp.v)
    if (vp.clip) setClip(vp.clip)
    if (vp.sel) { const sel = vp.sel.split(','); s.select(sel); if (vp.focus) setTimeout(() => focusRef.current(sel[0]), 300) }   // byGid·spatial 준비 후
  }, [loaded, hq])

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
    const fetch1 = (gid: string) => api<ElementDetail>(`/models/${modelId}/elements/${encodeURIComponent(gid)}`)
    if (selection.length === 1) {
      const gid = selection[0]
      if (!byGid.has(gid)) setDetail({ globalId: gid, kind: spaceGids.has(gid) ? 'space' : 'opening' })
      else fetch1(gid).then(setDetail).catch(e => setErr(e.message))
    } else setDetail(undefined)
    if (selection.length > 1) Promise.all(selection.filter(g => byGid.has(g)).slice(0, 20).map(fetch1)).then(setDetails).catch(() => setDetails([]))
    else setDetails([])
  }, [selection, byGid, spaceGids, modelId, statusRows])
  useEffect(() => { scene.current?.setMerged(opts.merged) }, [opts.merged])
  // 단일 선택 → URL ?sel= (replaceState: hashchange 가 안 나 딥링크 effect 재실행 없음) + 독 알림 + 0.7초 뒤 3D 스냅샷(핏/포커스 카메라가 자리잡은 뒤).
  // loaded 가드: 딥링크 effect 가 ?sel= 을 먼저 소비한 뒤에만 URL 을 다시 쓴다. focus 만 지워 다음 "3D 위치" 클릭이 새 해시가 되게 (v/clip/wo/fm 은 유지)
  useEffect(() => {
    if (!loaded) return
    const gid = selection.length === 1 && byGid.has(selection[0]) ? selection[0] : undefined
    const p = new URLSearchParams(location.hash.split('?')[1] ?? ''); p.delete('focus'); if (gid) p.set('sel', gid); else p.delete('sel')
    history.replaceState(null, '', `#/models/${modelId}${String(p) ? '?' + p : ''}`); notify()
    if (!gid) return
    const t = setTimeout(() => { const s = scene.current; if (s) { saveSnap(modelId, gid, s.snapshot(240, 150)); notify() } }, 700)
    return () => clearTimeout(t)
  }, [selection, byGid, modelId, loaded])
  const [gridCfg, setGridCfgState] = useState<{ plane: 'floor' | 'front' | 'side'; step: number }>(() => { const d = { plane: 'floor' as const, step: 1 }; try { return { ...d, ...JSON.parse(localStorage.getItem('viewer.grid') ?? '{}') } } catch { return d } })
  const setGridCfg = (c: typeof gridCfg) => { setGridCfgState(c); try { localStorage.setItem('viewer.grid', JSON.stringify(c)) } catch { /* 저장 불가 환경 */ } }
  useEffect(() => { scene.current?.setGrid(opts.grid, gridCfg.plane, gridCfg.step) }, [opts.grid, gridCfg, bounds])   // bounds: 로드 뒤에야 크기·바닥을 안다
  useEffect(() => { scene.current?.setClipBox(clip) }, [clip, bounds])
  useEffect(() => { if (scene.current) scene.current.measuring = measuring }, [measuring])
  const [snap, setSnap] = useState(() => { try { return localStorage.getItem('viewer.snap') !== '0' } catch { return true } })
  useEffect(() => { if (scene.current) scene.current.snap = snap; try { localStorage.setItem('viewer.snap', snap ? '1' : '0') } catch { /* 저장 불가 환경 */ } }, [snap, loaded])
  useEsc(useCallback(() => setMeasuring(false), []))
  useEffect(() => {   // 격리(반투명) — 선택 집합 기준 (+ 포커스 모드면 구역도 함께, 구역은 진한 파랑)
    const spaceGid = focusInfo?.spaceGid
    scene.current?.setFocus(focus !== 'ghost' || !selSet.size ? undefined : { gids: spaceGid ? new Set([...selSet, spaceGid]) : selSet }, spaceGid)
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
  const abnormal = useMemo(() => new Map(statusRows.filter(r => isAbnormal(r.status.Status)).map(r => [r.globalId, r.status.Status!])), [statusRows])
  const selAsset = selection.length === 1 ? assetByGid.get(selection[0]) : undefined
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- 자산 id·열린 작업지시 수가 바뀔 때만
  useEffect(() => { if (!selAsset) { setAssetDetail(undefined); return } api<AssetDetail>(`/assets/${selAsset.id}`).then(setAssetDetail).catch(() => setAssetDetail(undefined)) }, [selAsset?.id, selAsset?.openWorkOrders])
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
          {err && <p style={{ position: 'absolute', top: 8, left: 8, color: T.crit, background: T.bg.surface, padding: 6 }}>{err}</p>}
          {hover && <div style={{ position: 'fixed', left: hover.x + 12, top: hover.y + 12, background: T.ink[1], color: T.ink[1], padding: '2px 6px', borderRadius: 3, fontSize: 12, pointerEvents: 'none' }}>{hover.text}</div>}

          {colorMode && <ColorPanel modelId={modelId} elements={elements} spatial={spatial} onChange={m => scene.current?.setColors(m)}
            onSolo={(label, gids) => setHidden({ ...hidden, solo: hidden.solo?.key === 'v:' + label ? undefined : { key: 'v:' + label, label, gids: new Set(gids) } })} onClose={() => setColorMode(false)} />}

          {/* 경보/장애 포커스 배너 (구역 강조 + 위치 비콘) */}
          {focusInfo && <div title="구역 반투명 강조 · 지붕 위 비콘 · 홈 뷰" style={{ position: 'absolute', top: clip ? 128 : wo ? 52 : 8, left: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', padding: '8px 12px', background: focusInfo.status === 'ALARM' ? T.critSoft : focusInfo.status === 'FAULT' ? T.warnSoft : T.bg.surface, borderRadius: 8, boxShadow: T.shadow, fontSize: 12, maxWidth: 460 }}>
            <MapPinned size={14} style={{ color: isAbnormal(focusInfo.status) ? statusHex(focusInfo.status) : T.accent }} />
            <b>{focusInfo.storey}{focusInfo.zone ? ` · ${focusInfo.zone} 구역` : ''}</b><span>{focusInfo.name}</span>
            {focusInfo.status && <b style={{ color: statusHex(focusInfo.status, T.ok) }}>{statusLabel(focusInfo.status)}</b>}
            <a href={`#/models/${modelId}/monitor?sel=${encodeURIComponent(focusInfo.gid)}`} title="모니터링에서 이 장비" style={{ color: T.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>모니터링</a>
            {(assetByGid.get(focusInfo.gid)?.openWorkOrders ?? 0) > 0 && <a href={`#/models/${modelId}/fm?sel=${encodeURIComponent(focusInfo.gid)}`} title="칸반 보드에서 이 자산의 카드" style={{ color: T.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>칸반</a>}
            <X size={14} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={() => { setFocusInfo(undefined); setFocus('none'); scene.current?.setFocus(undefined); scene.current?.setMarker(undefined) }} /></div>}

          {/* 작업지시로 진입: 배너 */}
          {wo && <div style={{ position: 'absolute', top: 8, left: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.bg.surface, borderRadius: 8, boxShadow: T.shadow, fontSize: 12, maxWidth: 420 }}>
            <StatusBadge s={wo.status} /><b>{wo.title}</b><span style={{ color: T.ink[2] }}>{wo.assetTag} · {wo.assignee ?? '미배정'}{wo.dueOn && ` · ~${day(wo.dueOn)}`}</span>
            <a href={`#/models/${modelId}/fm?wo=${wo.id}`} style={{ color: T.accent, marginLeft: 4 }}>보드</a>
            <X size={14} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={() => setWo(undefined)} /></div>}

          {/* 솔로 칩: 패널이 아니라 캔버스 위에 — 트리 레이아웃이 밀리지 않게 */}
          {hidden.solo && <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: T.accent, color: T.bg.base, borderRadius: 999, fontSize: 12, boxShadow: T.shadow, maxWidth: 320 }}>
            <Focus size={13} /> 이것만 보기: <b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hidden.solo.label}</b>
            <X size={14} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setHidden({ ...hidden, solo: undefined })} /></div>}

          {/* 추적 배너: 3D 에 색만 칠하면 '몇 개·어디까지' 를 모른다 */}
          {route && routeSummary && <div style={{ position: 'absolute', top: clip ? 128 : (focusInfo || wo) ? 52 : 8, left: 8, display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: T.bg.surface, borderRadius: 8, boxShadow: T.shadow, fontSize: 12, maxWidth: 520 }}>
            <RouteIcon size={14} style={{ color: route.direction === 'up' ? T.accent : T.ok }} />
            <b>{routeSummary.origin}</b><span style={{ color: route.direction === 'up' ? T.accent : T.ok, fontWeight: 600 }}>{route.direction === 'up' ? '상류' : '하류'} {route.nodes.length}요소</span>
            {routeSummary.floors && <span style={{ color: T.ink[2] }}>{routeSummary.floors}</span>}<span style={{ color: T.ink[2], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{routeSummary.top}</span>
            <span title="경로만 보기" onClick={() => setHidden({ ...hidden, solo: hidden.solo?.key === 'route' ? undefined : { key: 'route', label: '추적 경로', gids: new Set(route.nodes.map(n => n.globalId)) } })} style={{ cursor: 'pointer', color: T.accent, display: 'grid' }}><Focus size={13} /></span>
            <X size={14} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={() => setRoute(undefined)} /></div>}

          {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems()} onClose={() => setMenu(undefined)} />}

          {/* 섹션 박스: 단면 모드일 때만 */}
          {clip && bounds && (
            <Floating id="clip" anchor={{ top: 8, left: '50%', transform: 'translateX(-50%)', padding: '8px 10px', fontSize: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '4px 8px', alignItems: 'center', minWidth: 380 }}>
              {(['X', 'Y', 'Z'] as const).map((ax, a) => <Axis key={ax} name={ax} min={bounds.min[a]} max={bounds.max[a]} lo={clip[a * 2]} hi={clip[a * 2 + 1]}
                onChange={(lo, hi) => setClip(c => { const n = [...c!]; n[a * 2] = lo; n[a * 2 + 1] = hi; return n })} />)}
              <span style={{ color: T.ink[2] }}>층</span>
              <div style={{ gridColumn: '2 / 4', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {storeys.filter(st => st.elevation != null).map(st => <button key={st.id} onClick={() => setClip(c => { const n = [...c!]; n[3] = st.elevation! + 1.5; return n })} title="바닥 +1.5m 에서 수평 절단" style={{ whiteSpace: 'nowrap' }}>{st.name}</button>)}
                <button onClick={() => setClip([...bounds.min.flatMap((m, i) => [m, bounds.max[i]])])} title="박스 초기화">초기화</button>
              </div>
            </div>
            </Floating>
          )}

          {/* 측정 목록 */}
          {measuring && (
            <Floating id="measure" anchor={{ top: clip ? 128 : 8, left: 8, padding: '8px 10px', fontSize: 12 }}>
            <div style={{ minWidth: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}><Ruler size={13} /> <b style={{ flex: 1 }}>측정</b>
                <Trash2 size={13} style={{ cursor: 'pointer', color: measures.length ? T.ink[2] : T.bg.line }} onClick={() => { scene.current?.clearMeasures(); setMeasures([]) }} /></div>
              <div style={{ color: T.ink[2] }}>표면의 두 점을 클릭하세요 · Esc 로 종료</div>
              {measures.map((m, i) => <div key={i} style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <b style={{ width: 64 }}>{m.d.toFixed(2)} m</b>
                <span style={{ color: T.ink[2] }}>Δx {Math.abs(m.b[0] - m.a[0]).toFixed(2)} · Δy {Math.abs(m.b[1] - m.a[1]).toFixed(2)} · Δz {Math.abs(m.b[2] - m.a[2]).toFixed(2)}</span></div>)}
            </div>
            </Floating>
          )}

          {/* 하단 툴바 — 플로팅(드래그 이동·위치 기억) */}
          <Floating id="toolbar" anchor={{ bottom: 8, left: '50%', transform: 'translateX(-50%)', gap: 2, padding: 4, borderRadius: 10 }}>
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
            <Tool icon={Magnet} label="스냅 — 빈 곳 클릭 시 가까운 요소, 측정 시 꼭짓점·모서리" active={snap} onClick={() => setSnap(!snap)} />
            <Tool icon={Palette} label="속성별 색상 — 종류·층·속성값으로 칠하기" active={colorMode} onClick={() => setColorMode(!colorMode)} />
            <Gap />
            <Tool icon={copied ? Check : Link} label="현재 화면을 링크로 복사 (뷰·선택·단면 포함)" onClick={share} />
          </Floating>

          {/* 그리드 설정: 평면(건축 z-up 기준 이름)·간격 — 그리드가 켜져 있을 때만 */}
          {opts.grid && <Floating id="grid" anchor={{ left: 8, bottom: 60, gap: 4, padding: '4px 8px', fontSize: 12 }}>
            {([['floor', '바닥 XY'], ['front', '정면 XZ'], ['side', '측면 YZ']] as const).map(([p, l]) =>
              <button key={p} onClick={() => setGridCfg({ ...gridCfg, plane: p })} style={{ padding: '2px 8px', border: 0, borderRadius: 5, cursor: 'pointer', background: gridCfg.plane === p ? T.accent : 'transparent', color: gridCfg.plane === p ? T.bg.surface : T.ink[2], fontSize: 12 }}>{l}</button>)}
            <input type="number" min={0.1} max={50} step={0.5} value={gridCfg.step} onChange={e => { const v = +e.target.value; if (Number.isFinite(v) && v >= 0.1 && v <= 50) setGridCfg({ ...gridCfg, step: v }) }} title="간격 (m)" style={{ width: 48, padding: '2px 4px', border: `1px solid ${T.bg.line}`, borderRadius: 5, fontSize: 12 }} /><span style={{ color: T.ink[2] }}>m</span>
          </Floating>}

          <AlertToast modelId={modelId} fresh={freshAlerts} dismiss={dismissAlert} onFocus={g => focusOn(g)} />
        </div>
      </Panel>
      <Separator style={sep} />

      <Panel defaultSize={340} minSize={200} collapsible collapsedSize={0}>
        <aside style={{ overflow: 'auto', height: '100%', padding: 12, boxSizing: 'border-box' }}>
          {selection.length === 1 && detail && 'properties' in detail && <ObjectSummary modelId={modelId} detail={detail} asset={selAsset} openWos={assetDetail?.workOrders.filter(w => w.status !== 'DONE')} onFm={() => setTab('fm')} />}
          <div style={{ display: 'flex', borderBottom: `1px solid ${T.bg.line}`, marginBottom: 10 }}>
            {(['props', 'fm'] as const).map(t => <button key={t} onClick={() => setTab(t)}
              style={{ flex: 1, padding: '6px 0', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: tab === t ? T.accent : T.ink[2], borderBottom: tab === t ? `2px solid ${T.accent}` : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}>
              {t === 'props' ? '속성' : `자산·점검${selection.length === 1 && assetByGid.has(selection[0]) ? ' ●' : ''}`}</button>)}
          </div>
          {tab === 'fm' && <FmPanel modelId={modelId} selection={selection} byGid={byGid} detail={detail && 'properties' in detail ? detail : undefined} assets={assets} reload={reloadAssets} viewpoint={viewpointForWorkOrder} />}
          {tab === 'props' && <>
          {!selection.length && <p style={{ color: T.ink[2] }} title="Cmd/Ctrl+클릭: 추가 선택 · Shift+클릭(트리): 범위 · Esc: 해제 · 더블클릭: 맞춤">요소를 클릭하면 속성이 표시됩니다. <span style={{ color: T.ink[3], cursor: 'help' }}>단축키 ?</span></p>}
          {selection.length === 1 && detail && !('properties' in detail) && <p style={{ color: T.ink[2] }}>{detail.kind === 'space' ? '공간(구역) 형상입니다. 구역 정보는 왼쪽 공간 트리에서 확인하세요.' : '개구부 형상입니다 (요소 아님).'}</p>}
          {selection.length === 1 && detail && 'properties' in detail && !scene.current?.has(detail.globalId) && <p style={{ color: T.warn, fontSize: 12 }}>이 요소는 3D 형상이 없습니다 (IFC 에 형상 정보가 없거나 변환에서 제외됨).</p>}
          {selection.length === 1 && detail && 'properties' in detail && <><StatusEditor key={detail.globalId} modelId={modelId} e={detail} reload={reloadStatus} /><Props e={detail} /></>}
          {selection.length > 1 && <MultiProps selection={selection} byGid={byGid} details={details} />}
          </>}
        </aside>
      </Panel>
    </Group>
  )
}

/** URL 쿼리의 뷰포인트: v=카메라 6수, sel=GlobalId 목록, clip=섹션 박스 6수, focus=포커스 모드 */
function readViewpoint(q: URLSearchParams): { v?: View; sel?: string; clip?: number[]; focus: boolean } {
  const n = q.get('v')?.split(',').map(Number), c = q.get('clip')?.split(',').map(Number)
  return { v: n?.length === 6 ? { p: n.slice(0, 3), t: n.slice(3) } : undefined, sel: q.get('sel') ?? undefined, clip: c?.length === 6 && c.every(Number.isFinite) ? c : undefined, focus: q.has('focus') }
}

const sep = { width: 4, background: T.bg.line, cursor: 'col-resize' }
