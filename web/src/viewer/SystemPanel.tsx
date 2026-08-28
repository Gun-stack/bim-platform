import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, ArrowUpToLine, Cable, Droplets, Flame, Focus, Waves, X, type LucideIcon } from 'lucide-react'
import { api, type Route, type System, type SystemMember } from '../api'

/** 계통별 색 (ColorPanel 팔레트와 별개로 의미색 고정) */
export const SYSTEM_COLOR: Record<string, number> = { ELECTRICAL: 0xf59e0b, DOMESTICCOLDWATER: 0x2563eb, WASTEWATER: 0x78350f, FIREPROTECTION: 0xdc2626 }
const SYSTEM_ICON: Record<string, LucideIcon> = { ELECTRICAL: Cable, DOMESTICCOLDWATER: Droplets, WASTEWATER: Waves, FIREPROTECTION: Flame }
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** 좌측 "계통" 탭: 계통 목록(색·멤버 수·솔로), 선택 요소의 상류/하류 추적 */
export default function SystemPanel({ modelId, selection, members, setMembers, route, setRoute, onSolo, onSelect, colorMode, setColorMode }: {
  modelId: string; selection: string[]
  members: Map<number, SystemMember[]>; setMembers: (m: Map<number, SystemMember[]>) => void
  route?: Route; setRoute: (r?: Route) => void
  onSolo: (label: string, gids: string[], key: string) => void; onSelect: (gids: string[]) => void
  colorMode: boolean; setColorMode: (b: boolean) => void
}) {
  const [systems, setSystems] = useState<System[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api(`/models/${modelId}/systems`).then(setSystems) }, [modelId])
  useEffect(() => {   // 멤버는 전부 미리 받아둔다 (색상 모드·솔로에 필요, 모델당 수백 개)
    if (!systems.length) return
    Promise.all(systems.map(s => api(`/models/${modelId}/systems/${s.id}/elements`).then((m: SystemMember[]) => [s.id, m] as const))).then(r => setMembers(new Map(r)))
  }, [systems])

  const gid = selection.length === 1 ? selection[0] : undefined
  const inSystems = useMemo(() => systems.filter(s => (members.get(s.id) ?? []).some(m => m.globalId === gid)), [systems, members, gid])
  const trace = (dir: 'up' | 'down') => { if (!gid) return; setBusy(true); api(`/models/${modelId}/elements/${encodeURIComponent(gid)}/route?dir=${dir}`).then(setRoute).finally(() => setBusy(false)) }

  if (!systems.length) return <p style={{ color: '#888', padding: 8 }}>이 모델에는 계통(IfcDistributionSystem) 정보가 없습니다.<br /><span style={{ fontSize: 12 }}>samples/mep-building.ifc 로 확인할 수 있습니다.</span></p>
  return (
    <div style={{ padding: '4px 6px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12, color: '#444' }}>
        <input type="checkbox" checked={colorMode} onChange={e => setColorMode(e.target.checked)} /> 계통별 색으로 보기</label>
      {systems.map(s => { const Icon = SYSTEM_ICON[s.predefinedType ?? ''] ?? Cable, c = SYSTEM_COLOR[s.predefinedType ?? ''] ?? 0x888888; return (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 6px', borderRadius: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: hex(c), flexShrink: 0 }} />
          <Icon size={14} style={{ color: hex(c) }} />
          <span style={{ flex: 1 }}>{s.name}</span>
          <span style={{ color: '#999', fontSize: 11 }}>{s.memberCount} · 연결 {s.connectionCount}</span>
          <span title="이 계통만 보기" onClick={() => onSolo(`계통 ${s.name}`, (members.get(s.id) ?? []).map(m => m.globalId), 'sys:' + s.id)} style={{ cursor: 'pointer', color: '#777', display: 'grid', placeItems: 'center' }}><Focus size={14} /></span>
        </div>) })}

      <div style={{ borderTop: '1px solid #e5e5e5', margin: '8px 0' }} />
      {!gid && <div style={{ color: '#888', fontSize: 12, padding: 6 }}>요소를 하나 선택하면 흐름을 추적할 수 있습니다.</div>}
      {gid && <>
        <div style={{ fontSize: 12, color: '#666', padding: '0 6px 6px' }}>선택 요소 계통: {inSystems.length ? inSystems.map(s => s.name).join(', ') : '없음'}</div>
        <div style={{ display: 'flex', gap: 6, padding: '0 6px' }}>
          <button disabled={!inSystems.length || busy} onClick={() => trace('up')} style={btn}><ArrowUpToLine size={13} /> 상류 (원천까지)</button>
          <button disabled={!inSystems.length || busy} onClick={() => trace('down')} style={btn}><ArrowDownToLine size={13} /> 하류 (말단까지)</button>
        </div>
      </>}
      {route && <div style={{ marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <b style={{ flex: 1 }}>{route.direction === 'up' ? '상류 경로' : '하류 범위'} · {route.nodes.length}개</b>
          <span title="경로만 보기" onClick={() => onSolo(`${route.direction === 'up' ? '상류' : '하류'} 경로`, route.nodes.map(n => n.globalId), 'route')} style={{ cursor: 'pointer', color: '#2563eb', display: 'grid', placeItems: 'center' }}><Focus size={14} /></span>
          <X size={14} style={{ cursor: 'pointer', color: '#888' }} onClick={() => setRoute(undefined)} />
        </div>
        {route.direction === 'up'
          ? route.nodes.map(n => <RouteRow key={n.globalId} n={n} onClick={() => onSelect([n.globalId])} />)
          : Object.entries(groupBy(route.nodes, n => n.ifcClass)).map(([cls, ns]) => <div key={cls} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '2px 0', cursor: 'pointer' }} onClick={() => onSelect(ns.map(n => n.globalId))}>
              <span style={{ flex: 1 }}>{cls.replace('Ifc', '')}</span><span style={{ color: '#888' }}>{ns.length}</span></div>)}
      </div>}
    </div>
  )
}

function RouteRow({ n, onClick }: { n: { depth: number; name: string | null; ifcClass: string; spatialName: string | null }; onClick: () => void }) {
  return <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0', paddingLeft: Math.min(n.depth, 8) * 8, cursor: 'pointer' }}>
    <span style={{ color: '#aaa' }}>{n.depth === 0 ? '●' : '↑'}</span>
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.name ?? ''}>{n.name}</span>
    <span style={{ color: '#999', fontSize: 11 }}>{n.spatialName}</span>
  </div>
}
const groupBy = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => ((m[k(x)] ??= []).push(x), m), {} as Record<string, T[]>)
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, flex: 1, justifyContent: 'center' }
