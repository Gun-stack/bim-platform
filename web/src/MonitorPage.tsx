import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, ArrowLeft, Box, Cable, ExternalLink, Flame, PlugZap, Siren, Wrench, type LucideIcon } from 'lucide-react'
import { api, type Model } from './api'

type Row = { globalId: string; ifcClass: string; name: string; storey: string | null; zone: string | null; elevation: number | null; systems: string[]
  status: (Record<string, unknown> & { Status?: string }) | null; assetId: string | null; assetTag: string | null; assetStatus: string | null; lastResult: string | null; openWorkOrders: number }

/** 팀 ↔ 계통 매핑 (설정 한 곳). 계통 이름은 IFC 의 IfcDistributionSystem.Name */
const TEAMS: { key: string; name: string; icon: LucideIcon; color: string; systems: string[] }[] = [
  { key: 'elec', name: '전기팀', icon: Cable, color: '#f59e0b', systems: ['전기', '비상전원'] },
  { key: 'fire', name: '소방팀', icon: Flame, color: '#dc2626', systems: ['소방', '화재감지'] },
  { key: 'mech', name: '설비팀', icon: Wrench, color: '#2563eb', systems: ['급수', '배수', '공조', '냉난방'] },
]
const STATUS: Record<string, { label: string; color: string }> = { NORMAL: { label: '정상', color: '#16a34a' }, RUNNING: { label: '운전', color: '#16a34a' }, STANDBY: { label: '대기', color: '#6b7280' }, TRANSFERRED: { label: '절체', color: '#ea580c' }, ALARM: { label: '경보', color: '#dc2626' }, FAULT: { label: '장애', color: '#f59e0b' } }
const rank = (r: Row) => ({ ALARM: 0, FAULT: 1, TRANSFERRED: 2 }[r.status?.Status ?? ''] ?? (r.openWorkOrders ? 3 : r.lastResult === 'DEFECT' ? 4 : 9))

/** #/models/{id}/monitor — 팀 × 층 격자 상태판. 5초 자동 갱신 */
export default function MonitorPage({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<Model>()
  const [rows, setRows] = useState<Row[]>([]); const [power, setPower] = useState('UNKNOWN')
  const [team, setTeam] = useState<string>(); const [onlyAbnormal, setOnlyAbnormal] = useState(false); const [tick, setTick] = useState(new Date())
  const load = () => api(`/models/${modelId}/monitor`).then(d => { setRows(d.rows); setPower(d.power); setTick(new Date()) })
  useEffect(() => { api(`/models/${modelId}`).then(setModel); load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [modelId])

  const teamOf = (r: Row) => TEAMS.find(t => r.systems.some(s => t.systems.includes(s)))
  const storeys = useMemo(() => [...new Map(rows.filter(r => r.storey).map(r => [r.storey!, r.elevation ?? 0])).entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]), [rows])
  const visibleTeams = TEAMS.filter(t => !team || t.key === team)
  const cell = (st: string, t: typeof TEAMS[number]) => rows.filter(r => r.storey === st && teamOf(r)?.key === t.key && (!onlyAbnormal || rank(r) < 9)).sort((a, b) => rank(a) - rank(b) || (a.zone ?? '').localeCompare(b.zone ?? '') || a.name.localeCompare(b.name))
  const kpi = (t: typeof TEAMS[number]) => { const rs = rows.filter(r => teamOf(r)?.key === t.key); return { total: rs.length, alarm: rs.filter(r => r.status?.Status === 'ALARM').length, fault: rs.filter(r => r.status?.Status === 'FAULT').length, wo: rs.reduce((n, r) => n + (r.openWorkOrders ?? 0), 0), assets: rs.filter(r => r.assetId).length } }

  return (
    <main style={{ fontFamily: 'system-ui', fontSize: 13, padding: '20px 24px', minHeight: '100vh', background: '#f6f7f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <a href="#/" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> 모델 목록</a>
        <h1 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={18} /> {model?.name ?? '…'} <span style={{ color: '#888', fontWeight: 400 }}>설비 모니터링</span></h1>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 12, background: power === 'GENERATOR' ? '#fff7ed' : '#f0fdf4', color: power === 'GENERATOR' ? '#9a3412' : '#166534', border: '1px solid ' + (power === 'GENERATOR' ? '#fdba74' : '#bbf7d0') }}>
          <PlugZap size={13} /> {power === 'GENERATOR' ? '정전 — 비상발전 운전 중' : power === 'UTILITY' ? '한전 정상 수전' : '전원 정보 없음'}</span>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>갱신 {tick.toLocaleTimeString()} · 5초</span>
        <a href={`#/models/${modelId}`} style={btn}><ExternalLink size={13} /> 3D 뷰어</a><a href={`#/models/${modelId}/fm`} style={btn}><Wrench size={13} /> 시설관리</a>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {TEAMS.map(t => { const k = kpi(t), Icon = t.icon, active = team === t.key; return (
          <div key={t.key} onClick={() => setTeam(active ? undefined : t.key)} style={{ flex: 1, background: '#fff', border: '2px solid ' + (active ? t.color : '#e5e7eb'), borderRadius: 10, padding: '10px 14px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Icon size={16} style={{ color: t.color }} /><b>{t.name}</b><span style={{ color: '#888', fontSize: 12 }}>{t.systems.join(' · ')}</span>
              <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>장비 {k.total} · 자산 {k.assets}</span></div>
            <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 12 }}>
              <span style={{ color: k.alarm ? '#dc2626' : '#999' }}><Siren size={12} style={{ verticalAlign: -2 }} /> 경보 <b>{k.alarm}</b></span>
              <span style={{ color: k.fault ? '#f59e0b' : '#999' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> 장애 <b>{k.fault}</b></span>
              <span style={{ color: k.wo ? '#1d4ed8' : '#999' }}><Wrench size={12} style={{ verticalAlign: -2 }} /> 작업지시 <b>{k.wo}</b></span>
            </div>
          </div>) })}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#444' }}><input type="checkbox" checked={onlyAbnormal} onChange={e => setOnlyAbnormal(e.target.checked)} /> 이상만</label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `64px repeat(${visibleTeams.length}, 1fr)`, gap: 10 }}>
        <div /> {visibleTeams.map(t => <div key={t.key} style={{ fontWeight: 600, color: t.color, display: 'flex', alignItems: 'center', gap: 6 }}><t.icon size={14} /> {t.name}</div>)}
        {storeys.map(st => <>
          <div key={st} style={{ fontWeight: 700, fontSize: 15, paddingTop: 8, color: '#374151' }}>{st}</div>
          {visibleTeams.map(t => { const rs = cell(st, t); return (
            <div key={st + t.key} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 6, minHeight: 44 }}>
              {rs.map(r => <RowView key={r.globalId} r={r} modelId={modelId} />)}
              {!rs.length && <div style={{ color: '#bbb', fontSize: 12, padding: 4 }}>{onlyAbnormal ? '이상 없음' : '—'}</div>}
            </div>) })}
        </>)}
      </div>
    </main>
  )
}

function RowView({ r, modelId }: { r: Row; modelId: string }) {
  const s = r.status?.Status, st = s ? STATUS[s] : undefined
  const abnormal = s === 'ALARM' || s === 'FAULT'
  return (
    <a href={`#/models/${modelId}?sel=${encodeURIComponent(r.globalId)}&fm=1`} title={`${r.ifcClass} · ${r.zone ?? r.storey}`}
       style={{ display: 'grid', gridTemplateColumns: '10px 1fr auto auto', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 5, textDecoration: 'none', color: '#222', fontSize: 12, background: abnormal ? (s === 'ALARM' ? '#fef2f2' : '#fffbeb') : 'transparent' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: st?.color ?? '#d1d5db' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.zone && <span style={{ color: '#999', marginLeft: 4 }}>{r.zone.split('-').pop()}</span>}</span>
      <span style={{ color: '#888' }}>{r.assetTag ? <><Box size={10} style={{ verticalAlign: -1 }} /> {r.assetTag}</> : ''}{r.openWorkOrders ? <b style={{ color: '#1d4ed8', marginLeft: 4 }}>WO {r.openWorkOrders}</b> : ''}{r.lastResult === 'DEFECT' && !r.openWorkOrders ? <b style={{ color: '#b91c1c', marginLeft: 4 }}>결함</b> : ''}</span>
      <b style={{ color: st?.color ?? '#bbb', minWidth: 28, textAlign: 'right' }}>{st?.label ?? ''}</b>
    </a>
  )
}
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', textDecoration: 'none', color: '#222', fontSize: 12 }
