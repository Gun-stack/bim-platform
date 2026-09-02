/* oxlint-disable react/only-export-components, react-hooks/exhaustive-deps */
import { useMemo, useState, type ReactNode } from 'react'
import type React from 'react'
import { ArrowLeft, Box, Building2, BrickWall, ChevronDown, ChevronRight, Combine, DoorOpen, Eye, EyeOff, Focus, Grid3x3, Layers, LayoutGrid, MapPin, Search, Sofa, Square, Tag, Wind, type LucideIcon } from 'lucide-react'
import { ifcKo } from '../ifcNames'
import type { ElementRow, Model, SpatialNode } from '../api'
import type { Stats } from './scene'
import { selQ } from '../context'
import { T } from '../theme'

/** 트리 한 행. children 은 지연 계산(펼칠 때만) */
export type Row = { key: string; gid?: string; label: string; sub?: string; icon: LucideIcon; count: number; badge?: number; hidden: boolean; solo: boolean; gids: () => string[]; children?: () => Row[] }
export type SelectMode = 'set' | 'toggle' | 'range'

/** 숨김 3종 + 솔로(이것만 보기). 보임 = (solo 없음 || gid ∈ solo) && !hidden */
export type Hidden = { nodes: Set<number>; classes: Set<string>; gids: Set<string>; solo?: { key: string; label: string; gids: Set<string> } }
export type Opts = { openings: boolean; spaces: boolean; merged: boolean; grid: boolean }

export const STRUCT = ['IfcWall', 'IfcWallStandardCase', 'IfcSlab', 'IfcRoof', 'IfcCovering', 'IfcCurtainWall']   // 구조체 숨김 토글 대상 (포커스 모드도 사용)
const CLASS_ICON: [RegExp, LucideIcon][] = [[/Door/, DoorOpen], [/Window/, LayoutGrid], [/Furnish|Furniture/, Sofa], [/Wall/, Square], [/Slab|Roof|Covering/, Layers], [/Flow|Duct|Pipe|Terminal/, Wind], [/Site/, MapPin], [/Building$/, Building2], [/Storey/, Layers], [/Space/, Box]]
const classIcon = (c: string) => CLASS_ICON.find(([re]) => re.test(c))?.[1] ?? Tag

export default function LeftPanel({ model, stats, spatial, elements, hidden, setHidden, opts, setOpts, selected, onSelect, onContext, systemPanel, statusBoard, abnormal, onFit }: {
  model?: Model; stats: Stats; spatial: SpatialNode[]; elements: ElementRow[]
  hidden: Hidden; setHidden: (h: Hidden) => void; opts: Opts; setOpts: (f: (o: Opts) => Opts) => void
  selected: Set<string>; onSelect: (gids: string[], mode: SelectMode) => void; onContext: (e: React.MouseEvent, gids: string[]) => void
  systemPanel?: ReactNode; statusBoard?: ReactNode; abnormal: Map<string, string>; onFit: () => void   // abnormal: gid → ALARM|FAULT (트리 배지)
}) {
  const [tab, setTab] = useState<'spatial' | 'class' | 'system'>('spatial')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())   // 펼친 행 key. Site·Building 은 기본 펼침
  const [anchor, setAnchor] = useState<string>()             // Shift 범위 선택 시작 행
  const sel1 = selected.size === 1 ? [...selected][0] : undefined   // 내비 링크가 선택 객체를 끌고 간다 (?sel=)

  const byNode = useMemo(() => { const m = new Map<number | null, ElementRow[]>(); for (const e of elements) (m.get(e.spatialNodeId) ?? m.set(e.spatialNodeId, []).get(e.spatialNodeId)!).push(e); return m }, [elements])
  const childrenOf = useMemo(() => {   // 층은 elevation 순 (IFC 저장 순서는 툴마다 제멋대로)
    const m = new Map<number | null, SpatialNode[]>(); for (const s of spatial) (m.get(s.parentId) ?? m.set(s.parentId, []).get(s.parentId)!).push(s)
    for (const arr of m.values()) arr.sort((a, b) => (a.elevation ?? Infinity) - (b.elevation ?? Infinity))
    return m }, [spatial])
  const desc = (n: SpatialNode): string[] => [...(byNode.get(n.id) ?? []).map(e => e.globalId), ...(childrenOf.get(n.id) ?? []).flatMap(desc)]

  const storeyOf = useMemo(() => { const byId = new Map(spatial.map(s => [s.id, s])); const m = new Map<number, string>(); for (const s of spatial) { let n: SpatialNode | undefined = s; while (n && n.ifcClass !== 'IfcBuildingStorey') n = n.parentId == null ? undefined : byId.get(n.parentId); if (n?.name) m.set(s.id, n.name) } return m }, [spatial])
  const elRow = (e: ElementRow): Row => ({ key: 'e:' + e.globalId, gid: e.globalId, label: e.name ?? '(이름 없음)', sub: ifcKo(e.ifcClass) + (e.spatialNodeId != null && storeyOf.get(e.spatialNodeId) ? ' · ' + storeyOf.get(e.spatialNodeId) : ''), icon: classIcon(e.ifcClass), count: 0,
    hidden: hidden.gids.has(e.globalId) || hidden.classes.has(e.ifcClass), solo: hidden.solo?.key === 'e:' + e.globalId, gids: () => [e.globalId] })
  const spRow = (n: SpatialNode): Row => {
    const g = desc(n); return { badge: g.reduce((k, g) => k + (abnormal.has(g) ? 1 : 0), 0), key: 'n:' + n.id, label: n.name ?? '(이름 없음)', sub: n.ifcClass.replace('Ifc', '') + (n.elevation != null ? ` ${n.elevation.toFixed(2)}m` : ''), icon: classIcon(n.ifcClass), count: g.length,
      hidden: hidden.nodes.has(n.id), solo: hidden.solo?.key === 'n:' + n.id, gids: () => g,
      children: () => [...(childrenOf.get(n.id) ?? []).map(spRow), ...(byNode.get(n.id) ?? []).map(elRow)] }
  }
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const roots: Row[] = useMemo(() => {
    if (tab !== 'class') {
      const rows = (childrenOf.get(null) ?? []).map(spRow)
      const orphan = byNode.get(null) ?? []
      if (orphan.length) rows.push({ key: 'orphan', label: '위치 미지정', icon: Tag, count: orphan.length, hidden: false, solo: hidden.solo?.key === 'orphan', gids: () => orphan.map(e => e.globalId), children: () => orphan.map(elRow) })
      return rows
    }
    const byClass = new Map<string, ElementRow[]>()
    for (const e of elements) (byClass.get(e.ifcClass) ?? byClass.set(e.ifcClass, []).get(e.ifcClass)!).push(e)
    return [...byClass].sort((a, b) => b[1].length - a[1].length).map(([c, es]) => ({ key: 'c:' + c, label: ifcKo(c), sub: c.replace('Ifc', ''), icon: classIcon(c), count: es.length, hidden: hidden.classes.has(c), solo: hidden.solo?.key === 'c:' + c, gids: () => es.map(e => e.globalId), children: () => es.map(elRow) }))
  }, [tab, elements, hidden, byNode, childrenOf, abnormal])

  const clone = (): Hidden => ({ nodes: new Set(hidden.nodes), classes: new Set(hidden.classes), gids: new Set(hidden.gids), solo: hidden.solo })
  const flipHidden = (h: Hidden, r: Row) => {
    const flip = <T,>(set: Set<T>, v: T) => { if (set.has(v)) set.delete(v); else set.add(v) }
    if (r.key.startsWith('n:')) flip(h.nodes, +r.key.slice(2))
    else if (r.key.startsWith('c:')) flip(h.classes, r.key.slice(2))
    else if (r.gid) flip(h.gids, r.gid)
    else for (const g of r.gids()) flip(h.gids, g)   // 컨테이너 없음 묶음
  }
  const toggle = (r: Row) => { const h = clone(); flipHidden(h, r); setHidden(h) }
  /** 이것만 보기. 같은 행이면 해제, 다른 행이면 교체. 숨겨진 행을 솔로하면 그 행의 숨김은 푼다 (솔로 = 보여달라는 뜻) */
  const solo = (r: Row) => {
    const h = clone()
    if (r.hidden && !r.solo) flipHidden(h, r)
    h.solo = r.solo ? undefined : { key: r.key, label: r.label, gids: new Set(r.gids()) }
    setHidden(h)
  }
  const allVisible = () => { setHidden({ nodes: new Set(), classes: new Set(), gids: new Set() }); try { localStorage.setItem('viewer.structHidden', '0') } catch { /* 저장 불가 환경 */ } }
  /** 표시 옵션 토글 — 사용자 클릭만 저장. focusOn 등 프로그램적 변경은 저장값을 안 건드림 */
  const flipOpt = (k: keyof Opts) => { const n = { ...opts, [k]: !opts[k] }; try { localStorage.setItem('viewer.opts', JSON.stringify(n)) } catch { /* 저장 불가 환경 */ } setOpts(() => n) }
  const anyHidden = hidden.nodes.size + hidden.classes.size + hidden.gids.size > 0 || !!hidden.solo

  const isOpen = (r: Row, depth: number) => open.has(r.key) || (!open.has('!' + r.key) && r.key.startsWith('n:') && depth < 2)
  // isOpen 이 open 을 읽으므로 open 은 실제 의존성 (lint 는 클로저를 못 봄)
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const flat = useMemo(() => {   // 보이는 행을 순서대로 — Shift 범위·선택 배경에 쓴다
    const out: { row: Row; depth: number; open: boolean }[] = []
    const walk = (rows: Row[], depth: number) => { for (const r of rows) { const o = !!r.children && isOpen(r, depth); out.push({ row: r, depth, open: o }); if (o) walk(r.children!(), depth + 1) } }
    walk(roots, 0); return out
  }, [roots, open])
  const toggleOpen = (r: Row, depth: number) => { const o = new Set(open); const cur = isOpen(r, depth); o.delete(r.key); o.delete('!' + r.key); o.add(cur ? '!' + r.key : r.key); setOpen(o) }
  /** 행 클릭 → 선택. Shift 는 앵커부터 이 행까지(보이는 행 기준), Cmd/Ctrl 은 토글 */
  const clickRow = (r: Row, e: React.MouseEvent) => {
    if (e.shiftKey && anchor) {
      const keys = flat.map(f => f.row.key), a = keys.indexOf(anchor), b = keys.indexOf(r.key)
      if (a >= 0 && b >= 0) { const [lo, hi] = a < b ? [a, b] : [b, a]; return onSelect([...new Set(flat.slice(lo, hi + 1).flatMap(f => f.row.gids()))], 'set') }
    }
    setAnchor(r.key)
    onSelect(r.gids(), e.metaKey || e.ctrlKey ? 'toggle' : 'set')
  }
  const rowSelected = (r: Row) => r.gid ? selected.has(r.gid) : r.count > 0 && r.gids().every(g => selected.has(g))

  // 검색: 요소 이름/GlobalId/클래스 → 평면 목록
  const found = useMemo(() => { const t = q.trim().toLowerCase(); return t ? elements.filter(e => e.globalId === q.trim() || e.name?.toLowerCase().includes(t) || e.ifcClass.toLowerCase().includes(t) || ifcKo(e.ifcClass).includes(t)).slice(0, 100) : [] }, [elements, q])

  return (
    <aside style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: 13, background: T.bg.raised }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: `1px solid ${T.bg.line}` }}>
        <div style={{ display: 'flex', fontSize: 12 }}>
          <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: T.accent }}><ArrowLeft size={13} /> 모델 목록</a>
          <a href={`#/models/${model?.id}/monitor${selQ(sel1)}`} style={{ marginLeft: 'auto', textDecoration: 'none', color: T.accent }}>모니터링</a>
          <a href={`#/models/${model?.id}/fm${selQ(sel1)}`} style={{ marginLeft: 10, textDecoration: 'none', color: T.accent }}>시설관리 →</a>
        </div>
        <div style={{ fontWeight: 600, fontSize: 14, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={model?.name}>{model?.name ?? '…'}</div>
        <div style={{ color: T.ink[3], fontSize: 12 }} title={`렌더: ${stats.calls} draw calls · ${stats.triangles.toLocaleString()} 삼각형 · ${stats.fps} fps`}>{model?.ifcSchema} · 층 {spatial.filter(s => s.ifcClass === 'IfcBuildingStorey').length} · 요소 {model?.elementCount?.toLocaleString()}{abnormal.size > 0 && <b style={{ color: T.crit, marginLeft: 6 }}>· 이상 {abnormal.size}</b>}</div>
      </div>

      {statusBoard}
      <div style={{ display: 'flex', gap: 6, padding: '8px 12px', borderBottom: `1px solid ${T.bg.line}` }}>
        <Toggle icon={Square} label="개구부 표시" on={opts.openings} onClick={() => flipOpt('openings')} />
        <Toggle icon={Box} label="공간(구역) 표시" on={opts.spaces} onClick={() => flipOpt('spaces')} />
        <Toggle icon={Grid3x3} label="그리드 (평면·간격은 캔버스 좌하단)" on={opts.grid} onClick={() => flipOpt('grid')} />
        <Toggle icon={Combine} label="병합 렌더 (성능)" on={opts.merged} onClick={() => flipOpt('merged')} />
        <Toggle icon={BrickWall} label="구조체 숨김 (벽·슬래브·지붕)" on={STRUCT.every(c => hidden.classes.has(c))} onClick={() => { const h = clone(); const on = STRUCT.every(c => h.classes.has(c)); for (const c of STRUCT) { if (on) h.classes.delete(c); else h.classes.add(c) } setHidden(h); try { localStorage.setItem('viewer.structHidden', on ? '0' : '1') } catch { /* 저장 불가 환경 */ } }} />
        <span style={{ flex: 1 }} />
        <Toggle icon={Eye} label="숨긴 것 모두 표시" on={false} disabled={!anyHidden} onClick={allVisible} />
      </div>

      <div style={{ position: 'relative', margin: '8px 12px 4px' }}>
        <Search size={14} style={{ position: 'absolute', left: 8, top: 8, color: T.ink[2] }} />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="이름 · 종류 · ID 검색" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 8px 6px 28px', border: `1px solid ${T.bg.line}`, borderRadius: 6, fontSize: 13 }} />
      </div>

      {!q && <div style={{ display: 'flex', margin: '0 12px', borderBottom: `1px solid ${T.bg.line}` }}>
        {(['spatial', 'class', 'system'] as const).map(t => <button key={t} onClick={() => setTab(t)}
          style={{ flex: 1, padding: '6px 0', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: tab === t ? T.accent : T.ink[2], borderBottom: tab === t ? `2px solid ${T.accent}` : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}>
          {{ spatial: '공간', class: '종류', system: '계통' }[t]}</button>)}
      </div>}

      {tab === 'system' && !q ? <div style={{ flex: 1, overflow: 'auto' }}>{systemPanel}</div> :
      <div style={{ flex: 1, overflow: 'auto', padding: '4px 6px 80px' }} onClick={e => { if (e.target === e.currentTarget) { onSelect([], 'set') } }}>   {/* 하단 여백: 좌하단 맥락 독 위로 스크롤 */}
        {q ? (found.length ? found.map(e => { const r = elRow(e); return <TreeRow key={r.key} row={r} depth={0} open={false} selected={rowSelected(r)} onToggle={toggle} onSolo={solo} onOpen={() => {}} onClick={ev => { clickRow(r, ev); if (!ev.metaKey && !ev.ctrlKey && !ev.shiftKey) setTimeout(onFit, 0) }} onContext={ev => onContext(ev, r.gids())} /> })
                          : <div style={{ color: T.ink[2], padding: 8 }}>결과 없음</div>)
           : flat.map(f => <TreeRow key={f.row.key} row={f.row} depth={f.depth} open={f.open} selected={rowSelected(f.row)} onToggle={toggle} onSolo={solo} onOpen={() => toggleOpen(f.row, f.depth)} onClick={ev => clickRow(f.row, ev)} onContext={ev => onContext(ev, f.row.gids())} />)}
      </div>}
    </aside>
  )
}

function TreeRow({ row, depth, open, selected, onToggle, onSolo, onOpen, onClick, onContext }: {
  row: Row; depth: number; open: boolean; selected: boolean; onToggle: (r: Row) => void; onSolo: (r: Row) => void; onOpen: () => void; onClick: (e: React.MouseEvent) => void; onContext: (e: React.MouseEvent) => void
}) {
  const [hov, setHov] = useState(false)
  const Icon = row.icon
  return (
    <div onPointerEnter={() => setHov(true)} onPointerLeave={() => setHov(false)} onClick={onClick} onContextMenu={onContext}
         style={{ display: 'flex', alignItems: 'center', gap: 4, height: 26, paddingLeft: 4 + depth * 14, paddingRight: 4, borderRadius: 5, userSelect: 'none',
                  background: selected ? T.accentSoft : hov ? T.accentSoft : 'transparent', opacity: row.hidden ? 0.45 : 1, fontWeight: row.solo ? 600 : 400, cursor: 'pointer' }}>
      <span onClick={e => { e.stopPropagation(); onOpen() }} style={{ width: 14, display: 'grid', placeItems: 'center', color: T.ink[2] }}>
        {row.children && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}</span>
      <Icon size={14} style={{ color: T.ink[2], flexShrink: 0 }} />
      <span title={row.label} style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.label}{row.sub && <span style={{ color: T.ink[2], marginLeft: 6, fontSize: 11 }}>{row.sub}</span>}</span>
      {!!row.badge && <span title={`이상 ${row.badge}`} style={{ color: T.bg.base, fontSize: 10, fontWeight: 700, background: T.crit, borderRadius: 8, padding: '0 5px' }}>{row.badge}</span>}
      {row.count > 0 && <span style={{ color: T.ink[2], fontSize: 11, background: T.bg.line, borderRadius: 8, padding: '0 6px' }}>{row.count}</span>}
      <span onClick={e => { e.stopPropagation(); onSolo(row) }} title={row.solo ? '이것만 보기 해제' : '이것만 보기 (Alt+눈 클릭)'} style={{ width: 20, display: 'grid', placeItems: 'center', color: row.solo ? T.accent : hov ? T.ink[3] : 'transparent' }}>
        <Focus size={14} /></span>
      <span onClick={e => { e.stopPropagation(); if (e.altKey) onSolo(row); else onToggle(row) }} title={row.hidden ? '표시' : '숨김 · Alt+클릭: 이것만 보기'} style={{ width: 20, display: 'grid', placeItems: 'center', color: row.hidden ? T.ink[3] : hov ? T.ink[2] : 'transparent' }}>
        {row.hidden ? <EyeOff size={14} /> : <Eye size={14} />}</span>
    </div>
  )
}

function Toggle({ icon: Icon, label, on, onClick, disabled }: { icon: LucideIcon; label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  const [hov, setHov] = useState(false)
  return <span style={{ position: 'relative' }} onPointerEnter={() => setHov(true)} onPointerLeave={() => setHov(false)}>
    <button onClick={onClick} disabled={disabled} aria-label={label}
      style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid ' + (on ? T.accent : T.bg.line), borderRadius: 6, cursor: disabled ? 'default' : 'pointer', background: on ? T.accent : T.bg.surface, color: on ? T.bg.surface : disabled ? T.bg.line : T.ink[2] }}>
      <Icon size={15} /></button>
    {hov && <Tip>{label}</Tip>}
  </span>
}
const Tip = ({ children }: { children: ReactNode }) => <span style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 5, background: T.ink[1], color: T.ink[1], padding: '3px 8px', borderRadius: 4, fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none' }}>{children}</span>
