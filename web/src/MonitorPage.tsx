import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, ArrowLeft, Box, Car, ExternalLink, Gauge, Layers, PlugZap, Siren, Volume2, VolumeX, Wrench } from 'lucide-react'
import { api, post, type Model } from './api'
import { TEAMS } from './teams'
import { day } from './viewer/FmPanel'
import { readings, inlineReadings, LEVEL_COLOR } from './readings'

type Row = { globalId: string; ifcClass: string; name: string; storey: string | null; zone: string | null; elevation: number | null; systems: string[]
  status: (Record<string, unknown> & { Status?: string }) | null; assetId: string | null; assetTag: string | null; assetStatus: string | null; lastResult: string | null; openWorkOrders: number
  woAssignee?: string | null; woDueOn?: string | null; woStatus?: string | null }
type Ev = { at: string | null; kind: 'STATUS' | 'WORK_ORDER'; globalId: string | null; name: string | null; status: string | null; storey: string | null; woTitle: string | null; woStatus: string | null }

const STATUS: Record<string, { label: string; color: string }> = { NORMAL: { label: '정상', color: '#16a34a' }, ONLINE: { label: '온라인', color: '#16a34a' }, RUNNING: { label: '운전', color: '#16a34a' }, STANDBY: { label: '대기(정상)', color: '#64748b' }, TRANSFERRED: { label: '절체', color: '#ea580c' }, ALARM: { label: '경보', color: '#dc2626' }, FAULT: { label: '장애', color: '#f59e0b' }, OFFLINE: { label: '오프라인', color: '#f59e0b' } }
const worst = (r: Row) => inlineReadings(r.status, r.name).reduce((m, x) => x.level === 'crit' ? 'crit' : m === 'crit' ? m : x.level === 'warn' ? 'warn' : m, 'ok' as 'ok' | 'warn' | 'crit')
const rank = (r: Row, dead = false) => ({ ALARM: 0, FAULT: 1, OFFLINE: 1, TRANSFERRED: 2 }[r.status?.Status ?? ''] ?? (dead ? 2 : worst(r) === 'crit' ? 2 : worst(r) === 'warn' ? 3 : r.openWorkOrders ? 3 : r.lastResult === 'DEFECT' ? 4 : 9))
const isAbn = (r: Row) => r.status?.Status === 'ALARM' || r.status?.Status === 'FAULT'
const kiosk = new URLSearchParams(location.hash.split('?')[1] ?? '').has('kiosk')   // 벽면 화면: 내비 숨김·글자 확대·이상만

/** #/models/{id}/monitor — 건물 요약 → 팀 KPI → 팀 × 층 격자 + 최근 이벤트. 5초 자동 갱신. ?kiosk=1 은 관제실 벽면용 */
export default function MonitorPage({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<Model>()
  const [rows, setRows] = useState<Row[]>([]); const [power, setPower] = useState('UNKNOWN'); const [events, setEvents] = useState<Ev[]>([])
  const [team, setTeam] = useState<string>(); const [storeyF, setStoreyF] = useState<string>(); const [mode, setMode] = useState<'abnormal' | 'equipment' | 'all'>(kiosk ? 'abnormal' : 'equipment'); const [tick, setTick] = useState(new Date())
  const [unpowered, setUnpowered] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState<Set<string>>(new Set()); const [sound, setSound] = useState(false); const prevAbn = useRef<Set<string> | null>(null); const soundRef = useRef(false); soundRef.current = sound
  const load = useCallback(() => Promise.all([api(`/models/${modelId}/monitor`), api(`/models/${modelId}/power`).catch(() => ({ unpowered: [] })), api(`/models/${modelId}/monitor/events`).catch(() => [])])
    .then(([d, pw, ev]) => {
      const abn = new Set<string>((d.rows as Row[]).filter(isAbn).map(r => r.globalId))
      if (prevAbn.current) { const fresh = [...abn].filter(g => !prevAbn.current!.has(g)); if (fresh.length) { setFlash(new Set(fresh)); setTimeout(() => setFlash(new Set()), 4000); if (soundRef.current) beep() } }
      prevAbn.current = abn
      setRows(d.rows); setPower(d.power); setUnpowered(new Set(pw.unpowered)); setEvents(ev); setTick(new Date()) }), [modelId])
  useEffect(() => { api(`/models/${modelId}`).then(setModel); load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [modelId, load])

  // 팀 우선순위: 소방 > 수송 > 설비 > 통신·제어 > 전기 (TEAMS 순서). 예외: 조명제어반은 통신 계통에도 걸리지만 전기팀
  const teamOf = (r: Row) => r.name?.includes('조명제어반') ? TEAMS.find(t => t.key === 'elec') : TEAMS.find(t => r.systems.some(s => t.systems.includes(s)))
  const storeyList = useMemo(() => [...new Map(rows.filter(r => r.storey).map(r => [r.storey!, r.elevation ?? 0])).entries()].sort((a, b) => b[1] - a[1]), [rows])
  const storeys = storeyList.map(e => e[0]).filter(s => !storeyF || s === storeyF)
  const visibleTeams = TEAMS.filter(t => !team || t.key === team)
  const dead = (r: Row) => unpowered.has(r.globalId)
  const cell = (st: string, t: typeof TEAMS[number]) => rows.filter(r => r.storey === st && teamOf(r)?.key === t.key && (mode === 'all' || (mode === 'equipment' ? !!r.status || rank(r, dead(r)) < 9 : rank(r, dead(r)) < 9))).sort((a, b) => rank(a, dead(a)) - rank(b, dead(b)) || (a.zone ?? '').localeCompare(b.zone ?? '') || a.name.localeCompare(b.name))
  const kpi = (t: typeof TEAMS[number]) => { const rs = rows.filter(r => teamOf(r)?.key === t.key); return { total: rs.length, alarm: rs.filter(r => r.status?.Status === 'ALARM').length, fault: rs.filter(r => r.status?.Status === 'FAULT').length, wo: rs.reduce((n, r) => n + (r.openWorkOrders ?? 0), 0), assets: rs.filter(r => r.assetId).length, dead: rs.filter(r => unpowered.has(r.globalId)).length } }
  const val = (prefix: string, key: string) => rows.find(r => r.name?.startsWith(prefix))?.status?.[key]
  /** 팀 카드의 대표 지표 — 정상일 때도 카드가 비지 않게 */
  const metric = (t: typeof TEAMS[number]) => ({
    fire: () => `수신기 경보 ${val('FACP', 'ActiveAlarms') ?? 0} · 장애 ${val('FACP', 'Faults') ?? 0} · 소화펌프 ${STATUS[String(val('FP-1', 'Status'))]?.label ?? '—'}`,
    trans: () => `주차 ${val('PCS', 'Occupied') ?? '—'}/${val('PCS', 'Capacity') ?? '—'} · EL-1 ${val('EL-1 승객', 'Floor') ?? '—'}`,
    mech: () => `냉동기 ${val('CH-1', 'LoadPercent') ?? '—'}% · 저수조 ${val('WT-1', 'LevelPercent') ?? '—'}% · 소화수조 ${val('FT-1', 'LevelPercent') ?? '—'}%`,
    comm: () => `UPS ${val('UPS-1', 'LoadPercent') ?? '—'}% · 온라인 ${rows.filter(r => teamOf(r)?.key === 'comm' && r.status?.Status === 'ONLINE').length}/${rows.filter(r => teamOf(r)?.key === 'comm' && r.status).length}`,
    elec: () => `변압기 ${val('TR-1', 'LoadPercent') ?? '—'}% · 발전기 ${STATUS[String(val('EG-1', 'Status'))]?.label ?? '—'} · 태양광 ${val('PV-1', 'OutputKW') ?? '—'}kW`,
  } as Record<string, () => string>)[t.key]?.()
  const tot = { alarm: rows.filter(r => r.status?.Status === 'ALARM').length, fault: rows.filter(r => r.status?.Status === 'FAULT').length, wo: rows.reduce((n, r) => n + (r.openWorkOrders ?? 0), 0), dead: unpowered.size, noAsset: rows.filter(r => !r.assetId).length, unassigned: rows.filter(r => r.openWorkOrders && !r.woAssignee).length, reading: rows.filter(r => !isAbn(r) && worst(r) !== 'ok').length }
  const abnByStorey = (st: string) => rows.filter(r => r.storey === st && isAbn(r)).length
  const storeyClip = (st: string) => { const i = storeyList.findIndex(e => e[0] === st); const z0 = storeyList[i][1], z1 = i > 0 ? storeyList[i - 1][1] : z0 + 3.5; return `#/models/${modelId}?clip=-999,999,-999,999,${(z0 - 0.3).toFixed(1)},${(z1 - 0.05).toFixed(1)}` }
  const fs = kiosk ? 1.25 : 1

  return (
    <main style={{ fontFamily: 'system-ui', fontSize: 13 * fs, padding: kiosk ? '14px 18px' : '20px 24px', minHeight: '100vh', background: '#f6f7f9' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        {!kiosk && <a href="#/" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> 모델 목록</a>}
        <h1 style={{ margin: 0, fontSize: 18 * fs, display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={18} /> {model?.name ?? '…'} <span style={{ color: '#888', fontWeight: 400 }}>설비 모니터링</span></h1>
        <span style={{ display: 'inline-flex', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', fontSize: 12 * fs }}>
          {([['abnormal', '이상만'], ['equipment', '장비'], ['all', '전체']] as const).map(([k, l]) => <button key={k} onClick={() => setMode(k)} style={{ padding: '4px 10px', border: 0, cursor: 'pointer', background: mode === k ? '#1f2937' : '#fff', color: mode === k ? '#fff' : '#444', fontSize: 'inherit' }}>{l}</button>)}</span>
        <label title="새 경보·장애가 들어오면 알림음" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 * fs, color: sound ? '#1f2937' : '#999', cursor: 'pointer' }}><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); if (e.target.checked) beep() }} style={{ display: 'none' }} />{sound ? <Volume2 size={14} /> : <VolumeX size={14} />} 알림음</label>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 * fs }}>갱신 {tick.toLocaleTimeString()} · 5초</span>
        {!kiosk && <><a href={`#/models/${modelId}`} style={btn}><ExternalLink size={13} /> 3D 뷰어</a><a href={`#/models/${modelId}/fm`} style={btn}><Wrench size={13} /> 시설관리</a></>}
      </div>

      {/* 건물 전체 요약 — 관제 화면의 첫 줄은 총계 */}
      <div className={flash.size ? 'pulse' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '10px 16px', marginBottom: 12, borderRadius: 10, background: tot.alarm ? '#fef2f2' : tot.fault ? '#fffbeb' : '#f0fdf4', border: '1px solid ' + (tot.alarm ? '#fecaca' : tot.fault ? '#fde68a' : '#bbf7d0'), fontSize: 13 * fs }}>
        <b style={{ fontSize: 15 * fs, color: tot.alarm ? '#b91c1c' : tot.fault ? '#b45309' : '#15803d' }}>{tot.alarm ? `경보 ${tot.alarm}건` : tot.fault ? `장애 ${tot.fault}건 · 경보 없음` : '건물 정상'}</b>
        <Stat icon={Siren} label="경보" n={tot.alarm} color="#dc2626" /><Stat icon={AlertTriangle} label="장애" n={tot.fault} color="#f59e0b" />
        <Stat icon={Gauge} label="계측 주의" n={tot.reading} color="#b45309" />
        <Stat icon={Wrench} label="열린 작업지시" n={tot.wo} color="#1d4ed8" sub={tot.unassigned ? `미배정 ${tot.unassigned}` : undefined} />
        <Stat icon={PlugZap} label={power === 'GENERATOR' ? '정전 — 비상발전' : power === 'UTILITY' ? '한전 수전' : '전원 —'} n={tot.dead} color={power === 'GENERATOR' ? '#c2410c' : '#15803d'} sub={tot.dead ? '무전원' : '정상'} />
        <Stat icon={Car} label="주차" n={`${val('PCS', 'Occupied') ?? '—'}/${val('PCS', 'Capacity') ?? '—'}`} color="#0f766e" sub={val('DISP', 'Text') as string | undefined} />
        {tot.noAsset > 0 && !kiosk && <button onClick={() => post(`/models/${modelId}/assets/bulk`, {}).then(load)} style={{ ...btn, marginLeft: 'auto', cursor: 'pointer' }} title="배관·트레이 제외 장비 전부"><Box size={12} /> 미등록 {tot.noAsset}개 자산 등록</button>}
        <span style={{ marginLeft: tot.noAsset && !kiosk ? 0 : 'auto', color: '#888', fontSize: 12 * fs }}>마지막 이벤트 {events[0]?.at ? new Date(events[0].at).toLocaleTimeString() : '—'}</span>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
        {TEAMS.map(t => { const k = kpi(t), Icon = t.icon, active = team === t.key; return (
          <div key={t.key} onClick={() => setTeam(active ? undefined : t.key)} style={{ flex: '1 1 0', minWidth: 0, background: '#fff', border: '2px solid ' + (active ? t.color : '#e5e7eb'), borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><Icon size={16} style={{ color: t.color, flexShrink: 0 }} /><b style={{ whiteSpace: 'nowrap' }}>{t.name}</b>
              <span style={{ color: '#888', fontSize: 12 * fs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={t.systems.join(' · ')}>{t.systems.join(' · ')}</span></div>
            <div style={{ color: '#888', fontSize: 12 * fs, marginTop: 2, whiteSpace: 'nowrap' }}>장비 {k.total} · 자산 {k.assets}{k.dead ? <b style={{ color: '#374151', marginLeft: 6 }}>무전원 {k.dead}</b> : ''}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12 * fs, whiteSpace: 'nowrap' }}>
              <span style={{ color: k.alarm ? '#dc2626' : '#999' }}><Siren size={12} style={{ verticalAlign: -2 }} /> 경보 <b>{k.alarm}</b></span>
              <span style={{ color: k.fault ? '#f59e0b' : '#999' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> 장애 <b>{k.fault}</b></span>
              <span style={{ color: k.wo ? '#1d4ed8' : '#999' }}><Wrench size={12} style={{ verticalAlign: -2 }} /> 작업지시 <b>{k.wo}</b></span>
            </div>
            <div style={{ color: '#555', fontSize: 11.5 * fs, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={metric(t)}>{metric(t)}</div>
          </div>) })}
      </div>

      <div className="monitor-body" style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0, overflowX: 'auto' }}><div style={{ display: 'grid', gridTemplateColumns: `64px repeat(${visibleTeams.length}, minmax(210px, 1fr))`, gap: 10, minWidth: 64 + visibleTeams.length * 220 }}>
          <div /> {visibleTeams.map(t => <div key={t.key} style={{ fontWeight: 600, color: t.color, display: 'flex', alignItems: 'center', gap: 6 }}><t.icon size={14} /> {t.name}</div>)}
          {storeys.map(st => { const n = abnByStorey(st); return <div key={st} style={{ display: 'contents' }}>
            <div style={{ paddingTop: 8 }}>
              <div onClick={() => setStoreyF(storeyF === st ? undefined : st)} title={storeyF === st ? '전체 층 보기' : '이 층만 보기'} style={{ fontWeight: 700, fontSize: 15 * fs, color: storeyF === st ? '#2563eb' : '#374151', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>{st}{n > 0 && <span style={{ fontSize: 10 * fs, background: '#dc2626', color: '#fff', borderRadius: 999, padding: '0 5px', fontWeight: 600 }}>{n}</span>}</div>
              {!kiosk && <a href={storeyClip(st)} title="뷰어에서 이 층 단면" style={{ color: '#94a3b8', display: 'inline-flex', marginTop: 2 }}><Layers size={13} /></a>}
            </div>
            {visibleTeams.map(t => { const rs = cell(st, t); return (
              <div key={st + t.key} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 6, minHeight: 44 }}>
                {rs.map(r => <RowView key={r.globalId} r={r} modelId={modelId} dead={dead(r)} fresh={flash.has(r.globalId)} fs={fs} />)}
                {!rs.length && <div style={{ color: '#bbb', fontSize: 12 * fs, padding: 4 }}>{mode === 'abnormal' ? '이상 없음' : '—'}</div>}
              </div>) })}
          </div> })}
        </div></div>

        {/* 최근 이벤트 — 격자는 '지금'만 보여주므로 '언제 무슨 일이' 는 여기 */}
        <div className="monitor-events" style={{ width: 300, flexShrink: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 10px', position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflow: 'auto' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={14} /> 최근 이벤트 <span style={{ color: '#999', fontWeight: 400, fontSize: 11 * fs }}>{events.length}</span></div>
          {!events.length && <div style={{ color: '#bbb', fontSize: 12 * fs }}>아직 없음 — 상태 API 를 거친 변경·작업지시만 기록됩니다</div>}
          {events.map((e, i) => { const abn = e.status === 'ALARM' || e.status === 'FAULT'; return (
            <a key={i} href={e.globalId ? `#/models/${modelId}?sel=${encodeURIComponent(e.globalId)}&focus=1` : undefined} style={{ display: 'grid', gridTemplateColumns: `${40 * fs}px 1fr`, gap: 6, padding: '4px 4px', borderTop: '1px solid #f1f5f9', textDecoration: 'none', color: '#222', fontSize: 12 * fs }}>
              <span style={{ color: '#999', fontSize: 11 * fs, whiteSpace: 'nowrap' }}>{e.at ? new Date(e.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.kind === 'WORK_ORDER' ? <><Wrench size={11} style={{ verticalAlign: -1, color: '#1d4ed8' }} /> {e.woTitle}</> : <><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: STATUS[e.status ?? '']?.color ?? '#9ca3af', marginRight: 4 }} />{e.name} → <b style={{ color: abn ? STATUS[e.status!].color : '#16a34a' }}>{STATUS[e.status ?? '']?.label ?? e.status}</b></>}</div>
                <div style={{ color: '#999', fontSize: 11 * fs }}>{e.storey ?? ''}{e.kind === 'WORK_ORDER' ? ` · 작업지시 ${({ OPEN: '대기', IN_PROGRESS: '진행', DONE: '완료' } as Record<string, string>)[e.woStatus ?? ''] ?? e.woStatus}` : ''}</div>
              </span>
            </a>) })}
        </div>
      </div>
    </main>
  )
}

const Stat = ({ icon: Icon, label, n, color, sub }: { icon: typeof Siren; label: string; n: number | string; color: string; sub?: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><Icon size={14} style={{ color: (typeof n === 'number' && n === 0) ? '#9ca3af' : color }} /><span style={{ color: '#555' }}>{label}</span><b style={{ color: (typeof n === 'number' && n === 0) ? '#9ca3af' : color }}>{n}</b>{sub && <span style={{ color: '#888', fontSize: '0.9em' }}>{sub}</span>}</span>)

function RowView({ r, modelId, dead, fresh, fs }: { r: Row; modelId: string; dead?: boolean; fresh?: boolean; fs: number }) {
  const s = r.status?.Status, st = dead ? { label: '무전원', color: '#374151' } : s ? STATUS[s] : undefined
  const abnormal = isAbn(r); const rs = inlineReadings(r.status, r.name); const all = readings(r.status, r.name)
  return (
    <a href={`#/models/${modelId}?sel=${encodeURIComponent(r.globalId)}&focus=1`} title={`${r.ifcClass} · ${r.zone ?? r.storey}${all.length ? '\n' + all.map(x => `${x.label} ${x.text}`).join(' · ') : ''}\n클릭: 뷰어에서 구역 강조`} className={fresh ? 'fresh' : undefined}
       style={{ display: 'block', padding: '3px 6px', borderRadius: 5, textDecoration: 'none', color: '#222', fontSize: 12 * fs, background: abnormal ? (s === 'ALARM' ? '#fef2f2' : '#fffbeb') : dead ? '#f3f4f6' : worst(r) === 'crit' ? '#fff1f2' : worst(r) === 'warn' ? '#fffbeb' : 'transparent', opacity: dead ? 0.7 : 1 }}>
      <span style={{ display: 'grid', gridTemplateColumns: '10px minmax(60px, 1fr) minmax(0, auto) auto', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: st?.color ?? '#d1d5db' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.zone && <span style={{ color: '#999', marginLeft: 4 }}>{r.zone.split('-').pop()}</span>}</span>
        <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.openWorkOrders ? <b style={{ color: r.woAssignee ? '#1d4ed8' : '#b45309' }} title={`작업지시 ${r.openWorkOrders}건`}>WO {r.woAssignee ?? '미배정'}{r.woDueOn ? ` ~${day(r.woDueOn).slice(5)}` : ''}</b>
            : r.assetTag ? <><Box size={10} style={{ verticalAlign: -1 }} /> {r.assetTag}</> : ''}
          {r.lastResult === 'DEFECT' && !r.openWorkOrders ? <b style={{ color: '#b91c1c', marginLeft: 4 }}>결함</b> : ''}</span>
        <b style={{ color: st?.color ?? '#bbb', minWidth: 28, textAlign: 'right', whiteSpace: 'nowrap' }}>{st?.label ?? ''}</b>
      </span>
      {rs.length > 0 && <span style={{ display: 'block', paddingLeft: 16, marginTop: 1, fontSize: 11 * fs, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {rs.slice(0, 3).map(x => <span key={x.key} style={{ color: LEVEL_COLOR[x.level], fontWeight: x.level === 'ok' ? 400 : 700, marginRight: 8 }}>{x.label} {x.text}</span>)}{rs.length > 3 && <span style={{ color: '#bbb' }}>+{rs.length - 3}</span>}</span>}
    </a>
  )
}
/** 알림음: 외부 파일 없이 WebAudio 로 짧은 비프 2회 */
const beep = () => { try { const c = new AudioContext(); [0, 0.25].forEach(t => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.15, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.18); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.2) }) } catch { /* 자동재생 차단 등 — 무시 */ } }
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', textDecoration: 'none', color: '#222', fontSize: 12 }
