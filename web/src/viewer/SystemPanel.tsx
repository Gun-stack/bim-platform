/* oxlint-disable react/only-export-components */
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, BatteryCharging, Bell, Cable, ChevronDown, ChevronUp, Droplets, Fan, Flame, Focus, Lightbulb, Network, PlugZap, Siren, Snowflake, Thermometer, Waves, Wind, X, ArrowUpDown, Car, type LucideIcon } from 'lucide-react'
import { TEAMS } from '../teams'
import { api, post, type PowerResult, type Route, type StatusRow, type System, type SystemMember } from '../api'
import { hex, isAbnormal, statusHex } from '../status'
import { btn as btnBase } from '../ui'
import { T, num } from '../theme'

/** 계통별 색 (ColorPanel 팔레트와 별개로 의미색 고정) */
export const SYSTEM_COLOR: Record<string, number> = { ELECTRICAL: num(T.warn), DOMESTICCOLDWATER: num(T.accent), WASTEWATER: 0x78350f, FIREPROTECTION: num(T.crit), SIGNAL: 0x9333ea, AIRCONDITIONING: 0x0d9488, CHILLEDWATER: 0x0284c7, VENTILATION: 0x65a30d, DOMESTICHOTWATER: 0xe11d48, GAS: 0xca8a04, DATA: 0x4f46e5, LIGHTING: 0xeab308,
  비상전원: num(T.warn), 화재감지: 0x9333ea, 수송: 0x78716c, 주차관제: 0x0f766e }
export const systemColor = (s: { name: string; predefinedType: string | null }) => SYSTEM_COLOR[s.name] ?? SYSTEM_COLOR[s.predefinedType ?? ''] ?? num(T.ink[3])
const SYSTEM_ICON: Record<string, LucideIcon> = { ELECTRICAL: Cable, DOMESTICCOLDWATER: Droplets, WASTEWATER: Waves, FIREPROTECTION: Flame, SIGNAL: Bell, AIRCONDITIONING: Wind, CHILLEDWATER: Snowflake, VENTILATION: Fan, DOMESTICHOTWATER: Thermometer, GAS: Flame, DATA: Network, LIGHTING: Lightbulb, 비상전원: BatteryCharging, 화재감지: Bell, 수송: ArrowUpDown, 주차관제: Car }

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
  useEffect(() => { api<System[]>(`/models/${modelId}/systems`).then(setSystems) }, [modelId])
  useEffect(() => {   // 멤버는 전부 미리 받아둔다 (색상 모드·솔로에 필요, 모델당 수백 개)
    if (!systems.length) return
    Promise.all(systems.map(s => api<SystemMember[]>(`/models/${modelId}/systems/${s.id}/elements`).then(m => [s.id, m] as const))).then(r => setMembers(new Map(r)))
  }, [systems, modelId, setMembers])

  const gid = selection.length === 1 ? selection[0] : undefined
  const inSystems = useMemo(() => systems.filter(s => (members.get(s.id) ?? []).some(m => m.globalId === gid)), [systems, members, gid])
  const signal = inSystems.length > 0 && inSystems.every(s => s.predefinedType === 'SIGNAL')
  // 실무 IFC 는 계통(IfcSystem) 없이 포트 연결만 있는 경우가 많다 — 소속 계통이 없으면 scope=all 로 전체 연결 그래프를 탄다
  const trace = (dir: 'up' | 'down') => { if (!gid) return; setBusy(true); api<Route>(`/models/${modelId}/elements/${encodeURIComponent(gid)}/route?dir=${dir}${inSystems.length ? '' : '&scope=all'}`).then(setRoute).catch(() => setRoute(undefined)).finally(() => setBusy(false)) }

  const traceSection = <>
      {!gid && <div style={{ color: T.ink[2], fontSize: 12, padding: 6 }}>장비를 하나 선택하면 상류·하류를 추적할 수 있습니다.</div>}
      {gid && <>
        {systems.length > 0 && <div style={{ fontSize: 12, color: T.ink[2], padding: '0 6px 6px' }}>선택 요소 계통: {inSystems.length ? inSystems.map(s => s.name).join(', ') : '없음 — 전체 연결에서 추적'}</div>}
        <div style={{ display: 'flex', gap: 6, padding: '0 6px' }}>
          {/* 신호 계통(화재감지)은 흐름이 감지기 → 수신기 라 라벨을 바꾼다 */}
          <button disabled={busy} onClick={() => trace('up')} style={btn}><ArrowUpToLine size={13} /> {signal ? '감지기 쪽' : '상류 (원천까지)'}</button>
          <button disabled={busy} onClick={() => trace('down')} style={btn}><ArrowDownToLine size={13} /> {signal ? '수신기까지' : '하류 (말단까지)'}</button>
        </div>
      </>}
      {route && <div style={{ marginTop: 8, padding: 8, background: T.bg.raised, borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <b style={{ flex: 1 }}>{route.direction === 'up' ? (signal ? '감지기 쪽' : '상류 경로') : (signal ? '수신기까지 경로' : '하류 범위')} · {route.nodes.length}개</b>
          <span title="경로만 보기" onClick={() => onSolo(`${route.direction === 'up' ? '상류' : '하류'} 경로`, route.nodes.map(n => n.globalId), 'route')} style={{ cursor: 'pointer', color: T.accent, display: 'grid', placeItems: 'center' }}><Focus size={14} /></span>
          <X size={14} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={() => setRoute(undefined)} />
        </div>
        {route.direction === 'up' || route.nodes.length <= 12
          ? route.nodes.map(n => <RouteRow key={n.globalId} n={n} onClick={() => onSelect([n.globalId])} />)
          : Object.entries(groupBy(route.nodes, n => n.ifcClass)).map(([cls, ns]) => <div key={cls} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '2px 0', cursor: 'pointer' }} onClick={() => onSelect(ns.map(n => n.globalId))}>
              <span style={{ flex: 1 }}>{cls.replace('Ifc', '')}</span><span style={{ color: T.ink[2] }}>{ns.length}</span></div>)}
      </div>}
  </>

  // 실무 IFC: 계통은 없어도 포트 연결이 있으면 추적은 가능
  if (!systems.length) return (
    <div style={{ padding: '4px 6px' }}>
      <p style={{ color: T.ink[2], padding: 8, margin: 0 }}>이 모델에는 계통(IfcSystem) 정보가 없습니다.<br /><span style={{ fontSize: 12 }}>연결(포트) 정보가 있으면 상류·하류 추적은 됩니다.</span></p>
      {traceSection}
    </div>)
  return (
    <div style={{ padding: '4px 6px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12, color: T.ink[2] }}>
        <input type="checkbox" checked={colorMode} onChange={e => setColorMode(e.target.checked)} /> 계통별 색으로 보기</label>
      {groupByTeam(systems).map(([team, ss]) => <div key={team?.key ?? 'etc'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 6px 2px', fontSize: 11, fontWeight: 600, color: team?.color ?? T.ink[2] }}>
          {team && <span style={{ width: 8, height: 8, borderRadius: 999, background: team.color, flexShrink: 0, display: 'inline-block' }} />}{team?.name ?? '기타'}<span style={{ fontWeight: 400, color: T.ink[3] }}>{ss.reduce((n, s) => n + (s.memberCount ?? 0), 0)}</span>
          {team && <span title={`${team.name} 계통만 보기`} onClick={() => onSolo(team.name, ss.flatMap(s => (members.get(s.id) ?? []).map(m => m.globalId)), 'team:' + team.key)} style={{ marginLeft: 'auto', cursor: 'pointer', color: T.ink[2], display: 'grid', placeItems: 'center' }}><Focus size={12} /></span>}
        </div>
      {ss.map(s => { const Icon = SYSTEM_ICON[s.name] ?? SYSTEM_ICON[s.predefinedType ?? ''] ?? Cable, c = systemColor(s); return (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 6px 0 14px', borderRadius: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: hex(c), flexShrink: 0 }} />
          <Icon size={14} style={{ color: hex(c) }} />
          <span style={{ flex: 1 }}>{s.name}</span>
          <span style={{ color: T.ink[2], fontSize: 11 }}>{s.memberCount} · 연결 {s.connectionCount}</span>
          <span title="이 계통만 보기" onClick={() => onSolo(`계통 ${s.name}`, (members.get(s.id) ?? []).map(m => m.globalId), 'sys:' + s.id)} style={{ cursor: 'pointer', color: T.ink[3], display: 'grid', placeItems: 'center' }}><Focus size={14} /></span>
        </div>) })}</div>)}

      <div style={{ borderTop: `1px solid ${T.bg.line}`, margin: '8px 0' }} />
      {traceSection}
    </div>
  )
}

/** 상태판: ALARM/FAULT 목록 + 상태 색 보기 + 정전/복전. 좌측 패널 최상단(탭 무관)에 놓인다 — 뷰어를 열면 제일 먼저 볼 것. 요소별 상태 변경은 우측 속성 패널(StatusEditor) */
export function StatusBoard({ rows, modelId, reload, onSelect, statusView, setStatusView, power, setPower, collapsed, setCollapsed }: {
  rows: StatusRow[]; modelId: string; reload: () => Promise<unknown>; onSelect: (g: string[]) => void; collapsed: boolean; setCollapsed: (b: boolean) => void
  statusView: boolean; setStatusView: (b: boolean) => void; power?: PowerResult; setPower: (p?: PowerResult) => void
}) {
  const [busy, setBusy] = useState(false)
  const abnormal = rows.filter(r => isAbnormal(r.status.Status))
  const togglePower = () => { setBusy(true); post<PowerResult>(`/models/${modelId}/power?source=${power?.source === 'GENERATOR' ? 'UTILITY' : 'GENERATOR'}`, {}).then(p => setPower(p.source === 'GENERATOR' ? p : undefined)).then(reload).finally(() => setBusy(false)) }
  return (
    <div style={{ padding: '6px 10px', background: abnormal.length ? T.critSoft : T.okSoft, borderBottom: `1px solid ${T.bg.line}` }}>
      <div onClick={() => setCollapsed(!collapsed)} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <Siren size={14} style={{ color: abnormal.length ? T.crit : T.ok }} />
        <b style={{ flex: 1 }}>상태판</b>
        <span style={{ fontSize: 12, fontWeight: 600, color: abnormal.length ? T.crit : T.ok }}>{abnormal.length ? `이상 ${abnormal.length}` : '전부 정상'}</span>
        {power?.source === 'GENERATOR' && <span style={{ fontSize: 11, color: T.warn }}>· 정전</span>}
        {collapsed ? <ChevronDown size={14} style={{ color: T.ink[2] }} /> : <ChevronUp size={14} style={{ color: T.ink[2] }} />}
      </div>
      {!collapsed && <>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.ink[2], margin: '6px 0 4px' }}>
        <input type="checkbox" checked={statusView} onChange={e => setStatusView(e.target.checked)} /> 상태 색으로 보기
        <span style={{ display: 'inline-flex', gap: 6, marginLeft: 4, color: T.ink[2], fontSize: 11 }}>{[[T.ok, '정상'], [T.crit, '경보'], [T.warn, '장애'], [T.ink[3], '점유·소등']].map(([c, l]) => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: c }} />{l}</span>)}</span></label>
      {abnormal.map(r => <div key={r.globalId} onClick={() => onSelect([r.globalId])} title="클릭: 구역 강조 + 카메라 이동" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, background: T.critSoft }}>
        <AlertTriangle size={12} style={{ color: statusHex(r.status.Status) }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        <span style={{ color: T.ink[2] }}>{r.spatialName}</span><b style={{ color: statusHex(r.status.Status) }}>{r.status.Status}</b></div>)}
      <button disabled={busy} onClick={togglePower} style={{ ...btn, marginTop: 8, width: '100%', background: power ? T.warnSoft : T.bg.surface, borderColor: power ? T.warn : T.bg.line, color: power ? T.warn : T.ink[1] }}>
        <PlugZap size={13} /> {power ? `정전 중 — 비상발전 운전 (무전원 ${power.unpowered.length}) · 클릭하면 복전` : '정전 시나리오 (발전기 절체)'}</button>
      </>}
    </div>
  )
}

function RouteRow({ n, onClick }: { n: { depth: number; name: string | null; ifcClass: string; spatialName: string | null }; onClick: () => void }) {
  return <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0', paddingLeft: Math.min(n.depth, 8) * 8, cursor: 'pointer' }}>
    <span style={{ color: T.ink[3] }}>{n.depth === 0 ? '●' : '↑'}</span>
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={n.name ?? ''}>{n.name}</span>
    <span style={{ color: T.ink[2], fontSize: 11 }}>{n.spatialName}</span>
  </div>
}
/** 계통을 팀 순서(TEAMS)로 묶고, 팀 안에서는 TEAMS.systems 에 적힌 순서(원천 계통 먼저). 어느 팀에도 없는 계통은 '기타' */
const groupByTeam = (systems: System[]) => {
  const groups = TEAMS.map(t => [t, t.systems.map(n => systems.find(s => s.name === n)).filter(Boolean) as System[]] as const).filter(([, ss]) => ss.length)
  const rest = systems.filter(s => !TEAMS.some(t => t.systems.includes(s.name)))
  return rest.length ? [...groups, [undefined, rest] as const] : groups
}
const groupBy = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => ((m[k(x)] ??= []).push(x), m), {} as Record<string, T[]>)
const btn = { ...btnBase, padding: '5px 8px', flex: 1, justifyContent: 'center' }
