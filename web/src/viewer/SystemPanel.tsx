import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDownToLine, ArrowUpToLine, BatteryCharging, Bell, Cable, CheckCircle2, Droplets, Fan, Flame, Focus, Network, PlugZap, Siren, Snowflake, Thermometer, Waves, Wind, X, ArrowUpDown, type LucideIcon } from 'lucide-react'
import { api, post, type PowerResult, type Route, type StatusRow, type System, type SystemMember } from '../api'

/** 계통별 색 (ColorPanel 팔레트와 별개로 의미색 고정) */
export const SYSTEM_COLOR: Record<string, number> = { ELECTRICAL: 0xf59e0b, DOMESTICCOLDWATER: 0x2563eb, WASTEWATER: 0x78350f, FIREPROTECTION: 0xdc2626, SIGNAL: 0x9333ea, AIRCONDITIONING: 0x0d9488, CHILLEDWATER: 0x0284c7, VENTILATION: 0x65a30d, DOMESTICHOTWATER: 0xe11d48, GAS: 0xca8a04, DATA: 0x4f46e5,
  비상전원: 0xea580c, 화재감지: 0x9333ea, 수송: 0x78716c }
export const systemColor = (s: { name: string; predefinedType: string | null }) => SYSTEM_COLOR[s.name] ?? SYSTEM_COLOR[s.predefinedType ?? ''] ?? 0x888888
const SYSTEM_ICON: Record<string, LucideIcon> = { ELECTRICAL: Cable, DOMESTICCOLDWATER: Droplets, WASTEWATER: Waves, FIREPROTECTION: Flame, SIGNAL: Bell, AIRCONDITIONING: Wind, CHILLEDWATER: Snowflake, VENTILATION: Fan, DOMESTICHOTWATER: Thermometer, GAS: Flame, DATA: Network, 비상전원: BatteryCharging, 화재감지: Bell, 수송: ArrowUpDown }
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')

/** 좌측 "계통" 탭: 계통 목록(색·멤버 수·솔로), 선택 요소의 상류/하류 추적 */
export const STATUS_COLOR: Record<string, number> = { NORMAL: 0x16a34a, ONLINE: 0x16a34a, RUNNING: 0x16a34a, STANDBY: 0x6b7280, TRANSFERRED: 0xea580c, ALARM: 0xdc2626, FAULT: 0xf59e0b, OFFLINE: 0xf59e0b }

export default function SystemPanel({ modelId, selection, members, setMembers, route, setRoute, onSolo, onSelect, colorMode, setColorMode, statusRows, reloadStatus, power, setPower, statusView, setStatusView, onFocus }: {
  modelId: string; selection: string[]
  members: Map<number, SystemMember[]>; setMembers: (m: Map<number, SystemMember[]>) => void
  route?: Route; setRoute: (r?: Route) => void
  onSolo: (label: string, gids: string[], key: string) => void; onSelect: (gids: string[]) => void
  colorMode: boolean; setColorMode: (b: boolean) => void
  statusRows: StatusRow[]; reloadStatus: () => Promise<unknown>
  power?: PowerResult; setPower: (p?: PowerResult) => void
  statusView: boolean; setStatusView: (b: boolean) => void
  onFocus: (gid: string) => void
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
  const signal = inSystems.length > 0 && inSystems.every(s => s.predefinedType === 'SIGNAL')
  const trace = (dir: 'up' | 'down') => { if (!gid) return; setBusy(true); api(`/models/${modelId}/elements/${encodeURIComponent(gid)}/route?dir=${dir}`).then(setRoute).finally(() => setBusy(false)) }

  if (!systems.length) return <p style={{ color: '#888', padding: 8 }}>이 모델에는 계통(IfcDistributionSystem) 정보가 없습니다.<br /><span style={{ fontSize: 12 }}>samples/mep-building.ifc 로 확인할 수 있습니다.</span></p>
  return (
    <div style={{ padding: '4px 6px' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', fontSize: 12, color: '#444' }}>
        <input type="checkbox" checked={colorMode} onChange={e => setColorMode(e.target.checked)} /> 계통별 색으로 보기</label>
      {systems.map(s => { const Icon = SYSTEM_ICON[s.name] ?? SYSTEM_ICON[s.predefinedType ?? ''] ?? Cable, c = systemColor(s); return (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 6px', borderRadius: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: hex(c), flexShrink: 0 }} />
          <Icon size={14} style={{ color: hex(c) }} />
          <span style={{ flex: 1 }}>{s.name}</span>
          <span style={{ color: '#999', fontSize: 11 }}>{s.memberCount} · 연결 {s.connectionCount}</span>
          <span title="이 계통만 보기" onClick={() => onSolo(`계통 ${s.name}`, (members.get(s.id) ?? []).map(m => m.globalId), 'sys:' + s.id)} style={{ cursor: 'pointer', color: '#777', display: 'grid', placeItems: 'center' }}><Focus size={14} /></span>
        </div>) })}

      <div style={{ borderTop: '1px solid #e5e5e5', margin: '8px 0' }} />
      <StatusBoard rows={statusRows} modelId={modelId} gid={gid} reload={reloadStatus} onSelect={g => onFocus(g[0])} statusView={statusView} setStatusView={setStatusView} power={power} setPower={setPower} />
      <div style={{ borderTop: '1px solid #e5e5e5', margin: '8px 0' }} />
      {!gid && <div style={{ color: '#888', fontSize: 12, padding: 6 }}>요소를 하나 선택하면 흐름을 추적할 수 있습니다.</div>}
      {gid && <>
        <div style={{ fontSize: 12, color: '#666', padding: '0 6px 6px' }}>선택 요소 계통: {inSystems.length ? inSystems.map(s => s.name).join(', ') : '없음'}</div>
        <div style={{ display: 'flex', gap: 6, padding: '0 6px' }}>
          {/* 신호 계통(화재감지)은 흐름이 감지기 → 수신기 라 라벨을 바꾼다 */}
          <button disabled={!inSystems.length || busy} onClick={() => trace('up')} style={btn}><ArrowUpToLine size={13} /> {signal ? '감지기 쪽' : '상류 (원천까지)'}</button>
          <button disabled={!inSystems.length || busy} onClick={() => trace('down')} style={btn}><ArrowDownToLine size={13} /> {signal ? '수신기까지' : '하류 (말단까지)'}</button>
        </div>
      </>}
      {route && <div style={{ marginTop: 8, padding: 8, background: '#f5f5f5', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <b style={{ flex: 1 }}>{route.direction === 'up' ? (signal ? '감지기 쪽' : '상류 경로') : (signal ? '수신기까지 경로' : '하류 범위')} · {route.nodes.length}개</b>
          <span title="경로만 보기" onClick={() => onSolo(`${route.direction === 'up' ? '상류' : '하류'} 경로`, route.nodes.map(n => n.globalId), 'route')} style={{ cursor: 'pointer', color: '#2563eb', display: 'grid', placeItems: 'center' }}><Focus size={14} /></span>
          <X size={14} style={{ cursor: 'pointer', color: '#888' }} onClick={() => setRoute(undefined)} />
        </div>
        {route.direction === 'up' || route.nodes.length <= 12
          ? route.nodes.map(n => <RouteRow key={n.globalId} n={n} onClick={() => onSelect([n.globalId])} />)
          : Object.entries(groupBy(route.nodes, n => n.ifcClass)).map(([cls, ns]) => <div key={cls} style={{ display: 'flex', gap: 6, fontSize: 12, padding: '2px 0', cursor: 'pointer' }} onClick={() => onSelect(ns.map(n => n.globalId))}>
              <span style={{ flex: 1 }}>{cls.replace('Ifc', '')}</span><span style={{ color: '#888' }}>{ns.length}</span></div>)}
      </div>}
    </div>
  )
}

/** 상태판: ALARM/FAULT 목록, 선택 요소 경보/복구 시뮬레이션, 정전/복전 */
function StatusBoard({ rows, modelId, gid, reload, onSelect, statusView, setStatusView, power, setPower }: {
  rows: StatusRow[]; modelId: string; gid?: string; reload: () => Promise<unknown>; onSelect: (g: string[]) => void
  statusView: boolean; setStatusView: (b: boolean) => void; power?: PowerResult; setPower: (p?: PowerResult) => void
}) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>()
  const abnormal = rows.filter(r => r.status.Status === 'ALARM' || r.status.Status === 'FAULT')
  const sel = gid ? rows.find(r => r.globalId === gid) : undefined
  const setStatus = (Status: string) => { if (!gid) return; setBusy(true); setMsg(undefined)
    post(`/models/${modelId}/elements/${encodeURIComponent(gid)}/status`, Status === 'ALARM' ? { Status, AlarmAt: new Date().toISOString().slice(0, 16) } : { Status }, 'PATCH')
      .then(r => { const w = r.workOrder; if (!w) return; setMsg(w.suppressedBy ? `상위 장비 이상(${w.suppressedBy.name}) — 작업지시 억제` : w.reopened ? `10분 내 완료된 작업지시 다시 열림 (${w.assetTag})` : w.existing ? `열린 작업지시 있음 — 재사용 (${w.assetTag})` : `작업지시 자동 생성 (${w.assetTag})`) }).then(reload).catch(e => setMsg(e.message)).finally(() => setBusy(false)) }
  const togglePower = () => { setBusy(true); post(`/models/${modelId}/power?source=${power?.source === 'GENERATOR' ? 'UTILITY' : 'GENERATOR'}`, {}).then((p: PowerResult) => setPower(p.source === 'GENERATOR' ? p : undefined)).then(reload).finally(() => setBusy(false)) }
  return (
    <div style={{ padding: '0 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Siren size={14} style={{ color: abnormal.length ? '#dc2626' : '#16a34a' }} />
        <b style={{ flex: 1 }}>상태판</b>
        <span style={{ fontSize: 11, color: abnormal.length ? '#dc2626' : '#16a34a' }}>{abnormal.length ? `이상 ${abnormal.length}` : '전부 정상'}</span>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444', marginBottom: 4 }}>
        <input type="checkbox" checked={statusView} onChange={e => setStatusView(e.target.checked)} /> 상태 색으로 보기 (정상 초록 · 경보 빨강 · 장애 주황)</label>
      {abnormal.map(r => <div key={r.globalId} onClick={() => onSelect([r.globalId])} title="클릭: 구역 강조 + 카메라 이동" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px', cursor: 'pointer', borderRadius: 4, background: '#fff5f5' }}>
        <AlertTriangle size={12} style={{ color: r.status.Status === 'ALARM' ? '#dc2626' : '#f59e0b' }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
        <span style={{ color: '#888' }}>{r.spatialName}</span><b style={{ color: r.status.Status === 'ALARM' ? '#dc2626' : '#f59e0b' }}>{r.status.Status}</b></div>)}
      {sel && <div style={{ marginTop: 6, padding: 6, background: '#f5f5f5', borderRadius: 6, fontSize: 12 }}>
        <div style={{ marginBottom: 4 }}>선택: <b>{sel.name}</b> · <b style={{ color: '#' + (STATUS_COLOR[sel.status.Status ?? ''] ?? 0x444444).toString(16).padStart(6, '0') }}>{sel.status.Status}</b></div>
        <div style={{ display: 'flex', gap: 4 }}>
          {sel.ifcClass === 'IfcSensor' && <button disabled={busy} onClick={() => setStatus('ALARM')} style={btn}><Siren size={12} /> 경보 발생</button>}
          <button disabled={busy} onClick={() => setStatus('FAULT')} style={btn}><AlertTriangle size={12} /> 장애</button>
          <button disabled={busy} onClick={() => setStatus('NORMAL')} style={btn}><CheckCircle2 size={12} /> 정상 복구</button>
        </div>
        {msg && <div style={{ color: '#2563eb', marginTop: 4 }}>{msg}</div>}
      </div>}
      <button disabled={busy} onClick={togglePower} style={{ ...btn, marginTop: 8, width: '100%', background: power ? '#fff7ed' : '#fff', borderColor: power ? '#f59e0b' : '#ddd', color: power ? '#9a3412' : '#222' }}>
        <PlugZap size={13} /> {power ? `정전 중 — 비상발전 운전 (무전원 ${power.unpowered.length}) · 클릭하면 복전` : '정전 시나리오 (발전기 절체)'}</button>
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
