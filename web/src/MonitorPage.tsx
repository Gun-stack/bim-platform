import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, ArrowLeft, BarChart3, Box, Car, ClipboardList, ExternalLink, Gauge, Layers, TrendingUp, Users, PlugZap, Siren, Volume2, VolumeX, Wrench } from 'lucide-react'
import TrendModal from './TrendModal'
import ObjectDrawer from './ObjectDrawer'
import { objLinks, selQ } from './context'
import { api, post, type Model } from './api'
import { TEAMS, teamOfSystems } from './teams'
import { day, btn } from './ui'
import { statusUi, WO_STATUS, type WoStatus } from './status'
import { KEY_EQUIP, isAbn, overdue, rank, teamStats, worst, type Ev, type Row, type StatRow } from './monitor'
import { Section } from './Section'
import { useSections } from './useSections'
import { readings, inlineReadings, LEVEL_COLOR } from './readings'
import { useHashQuery } from './useHashQuery'

/** #/models/{id}/monitor — 건물 요약 → 팀 KPI → 팀 × 층 격자 + 최근 이벤트. 5초 자동 갱신. ?kiosk=1 은 관제실 벽면용 */
export default function MonitorPage({ modelId }: { modelId: string }) {
  const kiosk = useHashQuery().has('kiosk')   // 벽면 화면: 내비 숨김·글자 확대·이상만
  const [model, setModel] = useState<Model>()
  const [rows, setRows] = useState<Row[]>([]); const [power, setPower] = useState('UNKNOWN'); const [events, setEvents] = useState<Ev[]>([])
  const [team, setTeam] = useState<string>(); const [storeyF, setStoreyF] = useState<string>(); const [mode, setMode] = useState<'abnormal' | 'equipment' | 'all'>(kiosk ? 'abnormal' : 'equipment'); const [tick, setTick] = useState(new Date())
  const [unpowered, setUnpowered] = useState<Set<string>>(new Set())
  const [trend, setTrend] = useState<{ globalId: string; name: string | null } | null>(null)   // 계측 트렌드 모달
  const [sec, toggleSec] = useSections('monitor.sections', { teams: true, todo: true, key: true, grid: true, stats: false })
  const [days, setDays] = useState(30); const [stats, setStats] = useState<StatRow[]>([])   // 경보 통계 — 섹션이 열려 있을 때만 갱신
  const [flash, setFlash] = useState<Set<string>>(new Set()); const [sound, setSound] = useState(false); const prevAbn = useRef<Set<string> | null>(null); const soundRef = useRef(false); useEffect(() => { soundRef.current = sound }, [sound])
  const load = useCallback(() => Promise.all([api<{ power: string; rows: Row[] }>(`/models/${modelId}/monitor`), api<{ unpowered: string[] }>(`/models/${modelId}/power`).catch(() => ({ unpowered: [] as string[] })), api<Ev[]>(`/models/${modelId}/monitor/events`).catch(() => [] as Ev[])])
    .then(([d, pw, ev]) => {
      const abn = new Set<string>(d.rows.filter(isAbn).map(r => r.globalId))
      if (prevAbn.current) { const fresh = [...abn].filter(g => !prevAbn.current!.has(g)); if (fresh.length) { setFlash(new Set(fresh)); setTimeout(() => setFlash(new Set()), 4000); if (soundRef.current) beep() } }
      prevAbn.current = abn
      setRows(d.rows); setPower(d.power); setUnpowered(new Set(pw.unpowered)); setEvents(ev); setTick(new Date()) }), [modelId])
  useEffect(() => { api<Model>(`/models/${modelId}`).then(setModel); load(); const t = setInterval(load, 5000); return () => clearInterval(t) }, [modelId, load])
  useEffect(() => { if (sec.stats) api<StatRow[]>(`/models/${modelId}/monitor/stats?days=${days}`).then(setStats).catch(() => {}) }, [modelId, days, sec.stats, tick])

  // ?sel={gid} 딥링크: 해당 행으로 스크롤 + 4초 플래시 (기존 .fresh 재사용). 현재 필터에 안 잡히는 행이면 '전체' 모드로
  const sel = useHashQuery().get('sel')
  const gotRows = rows.length > 0
  useEffect(() => {
    if (!sel || !gotRows) return
    const r = rows.find(x => x.globalId === sel)
    if (r && rank(r, unpowered.has(r.globalId)) >= 9 && !(mode === 'equipment' && r.status)) setMode('all')
    setFlash(new Set([sel])); const t = setTimeout(() => setFlash(new Set()), 4000)
    requestAnimationFrame(() => document.querySelector(`[data-gid="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'center' }))
    return () => clearTimeout(t)
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, gotRows])

  const teamOf = (r: Row) => teamOfSystems(r.systems, r.name)
  const storeyList = useMemo(() => [...new Map(rows.filter(r => r.storey).map(r => [r.storey!, r.elevation ?? 0])).entries()].sort((a, b) => b[1] - a[1]), [rows])
  const storeys = storeyList.map(e => e[0]).filter(s => !storeyF || s === storeyF)
  const visibleTeams = TEAMS.filter(t => !team || t.key === team)
  const dead = (r: Row) => unpowered.has(r.globalId)
  const cell = (st: string, t: typeof TEAMS[number]) => rows.filter(r => r.storey === st && teamOf(r)?.key === t.key && (mode === 'all' || (mode === 'equipment' ? !!r.status || !!r.assetId || rank(r, dead(r)) < 9 : rank(r, dead(r)) < 9))).sort((a, b) => rank(a, dead(a)) - rank(b, dead(b)) || (a.zone ?? '').localeCompare(b.zone ?? '') || (a.name ?? '').localeCompare(b.name ?? ''))
  const kpi = (t: typeof TEAMS[number]) => { const rs = rows.filter(r => teamOf(r)?.key === t.key); return { total: rs.length, alarm: rs.filter(r => r.status?.Status === 'ALARM').length, fault: rs.filter(r => r.status?.Status === 'FAULT').length, wo: rs.reduce((n, r) => n + (r.openWorkOrders ?? 0), 0), assets: rs.filter(r => r.assetId).length, dead: rs.filter(r => unpowered.has(r.globalId)).length, due: rs.filter(overdue).length } }
  const val = (prefix: string, key: string) => rows.find(r => r.name?.startsWith(prefix))?.status?.[key]
  /** 팀 카드의 대표 지표 — 정상일 때도 카드가 비지 않게 */
  const metric = (t: typeof TEAMS[number]) => ({
    fire: () => `수신기 경보 ${val('FACP', 'ActiveAlarms') ?? 0} · 장애 ${val('FACP', 'Faults') ?? 0} · 소화펌프 ${statusUi(String(val('FP-1', 'Status')))?.label ?? '—'}`,
    trans: () => `주차 ${val('PCS', 'Occupied') ?? '—'}/${val('PCS', 'Capacity') ?? '—'} · EL-1 ${val('EL-1 승객', 'Floor') ?? '—'}`,
    mech: () => `냉동기 ${val('CH-1', 'LoadPercent') ?? '—'}% · 저수조 ${val('WT-1', 'LevelPercent') ?? '—'}% · 소화수조 ${val('FT-1', 'LevelPercent') ?? '—'}%`,
    comm: () => `UPS ${val('UPS-1', 'LoadPercent') ?? '—'}% · 온라인 ${rows.filter(r => teamOf(r)?.key === 'comm' && r.status?.Status === 'ONLINE').length}/${rows.filter(r => teamOf(r)?.key === 'comm' && r.status).length}`,
    elec: () => `변압기 ${val('TR-1', 'LoadPercent') ?? '—'}% · 발전기 ${statusUi(String(val('EG-1', 'Status')))?.label ?? '—'} · 태양광 ${val('PV-1', 'OutputKW') ?? '—'}kW`,
  } as Record<string, () => string>)[t.key]?.()
  const tot = { alarm: rows.filter(r => r.status?.Status === 'ALARM').length, fault: rows.filter(r => r.status?.Status === 'FAULT').length, wo: rows.reduce((n, r) => n + (r.openWorkOrders ?? 0), 0), dead: unpowered.size, noAsset: rows.filter(r => !r.assetId).length, unassigned: rows.filter(r => r.openWorkOrders && !r.woAssignee).length, reading: rows.filter(r => !isAbn(r) && worst(r) !== 'ok').length, due: rows.filter(overdue).length }
  const abnByStorey = (st: string) => rows.filter(r => r.storey === st && isAbn(r)).length
  const storeyClip = (st: string) => { const i = storeyList.findIndex(e => e[0] === st); const z0 = storeyList[i][1], z1 = i > 0 ? storeyList[i - 1][1] : z0 + 3.5; return `#/models/${modelId}?clip=-999,999,-999,999,${(z0 - 0.3).toFixed(1)},${(z1 - 0.05).toFixed(1)}` }
  const fs = kiosk ? 1.25 : 1

  return (
    <main style={{ fontFamily: 'system-ui', fontSize: 13 * fs, padding: kiosk ? '14px 18px' : '20px 24px', paddingRight: sel && !kiosk ? 460 : undefined, minHeight: '100vh', background: '#f6f7f9' }}>   {/* 객체 패널(440px)이 떠 있으면 그만큼 비워 최근 이벤트 열이 가려지지 않게 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        {!kiosk && <a href="#/" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> 모델 목록</a>}
        <h1 style={{ margin: 0, fontSize: 18 * fs, display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={18} /> {model?.name ?? '…'} <span style={{ color: '#888', fontWeight: 400 }}>설비 모니터링</span></h1>
        <label title="새 경보·장애가 들어오면 알림음" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 * fs, color: sound ? '#1f2937' : '#999', cursor: 'pointer' }}><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); if (e.target.checked) beep() }} style={{ display: 'none' }} />{sound ? <Volume2 size={14} /> : <VolumeX size={14} />} 알림음</label>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 * fs }}>갱신 {tick.toLocaleTimeString()} · 5초</span>
        {!kiosk && <><a href={`#/models/${modelId}${selQ(sel)}`} style={btn}><ExternalLink size={13} /> 3D 뷰어</a><a href={`#/models/${modelId}/fm${selQ(sel)}`} style={btn}><Wrench size={13} /> 시설관리</a></>}
      </div>

      {/* 건물 전체 요약 — 관제 화면의 첫 줄은 총계 */}
      <div className={flash.size ? 'pulse' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 18, padding: '10px 16px', marginBottom: 12, borderRadius: 10, background: tot.alarm ? '#fef2f2' : tot.fault ? '#fffbeb' : '#f0fdf4', border: '1px solid ' + (tot.alarm ? '#fecaca' : tot.fault ? '#fde68a' : '#bbf7d0'), fontSize: 13 * fs }}>
        <b style={{ fontSize: 15 * fs, color: tot.alarm ? '#b91c1c' : tot.fault ? '#b45309' : '#15803d' }}>{tot.alarm ? `경보 ${tot.alarm}건` : tot.fault ? `장애 ${tot.fault}건 · 경보 없음` : '건물 정상'}</b>
        <Stat icon={Siren} label="경보" n={tot.alarm} color="#dc2626" /><Stat icon={AlertTriangle} label="장애" n={tot.fault} color="#f59e0b" />
        <Stat icon={Gauge} label="계측 주의" n={tot.reading} color="#b45309" />
        <Stat icon={Wrench} label="열린 작업지시" n={tot.wo} color="#1d4ed8" sub={tot.unassigned ? `미배정 ${tot.unassigned}` : undefined} />
        <Stat icon={ClipboardList} label="점검 지연" n={tot.due} color="#b45309" />
        <Stat icon={PlugZap} label={power === 'GENERATOR' ? '정전 — 비상발전' : power === 'UTILITY' ? '한전 수전 정상' : '전원 정보 없음'} n={tot.dead} color={power === 'GENERATOR' ? '#c2410c' : '#15803d'} sub={tot.dead ? '무전원' : '정상'} />
        <Stat icon={Car} label="주차" n={`${val('PCS', 'Occupied') ?? '—'}/${val('PCS', 'Capacity') ?? '—'}`} color="#0f766e" sub={val('DISP', 'Text') as string | undefined} />
        {tot.noAsset > 0 && !kiosk && <button onClick={() => post(`/models/${modelId}/assets/bulk`, {}).then(load)} style={{ ...btn, marginLeft: 'auto', cursor: 'pointer' }} title="배관·트레이·덕트를 뺀 장비 전부를 자산으로 등록"><Box size={12} /> 미등록 {tot.noAsset}개 자산 등록</button>}
        <span style={{ marginLeft: tot.noAsset && !kiosk ? 0 : 'auto', color: '#888', fontSize: 12 * fs }}>마지막 이벤트 {events[0]?.at ? new Date(events[0].at).toLocaleTimeString() : '—'}</span>
      </div>

      <Section title="팀 현황" icon={Users} count={team ? `${TEAMS.find(t => t.key === team)!.name} 선택 중 — 클릭해서 해제` : '카드를 누르면 그 팀만'} open={sec.teams} onToggle={() => toggleSec('teams')} pad={10}>
      <div style={{ display: 'flex', gap: 12 }}>
        {TEAMS.map(t => { const k = kpi(t), Icon = t.icon, active = team === t.key; return (
          <div key={t.key} onClick={() => setTeam(active ? undefined : t.key)} style={{ flex: '1 1 0', minWidth: 0, background: '#fff', border: '2px solid ' + (active ? t.color : '#e5e7eb'), borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}><Icon size={16} style={{ color: t.color, flexShrink: 0 }} /><b style={{ whiteSpace: 'nowrap' }}>{t.name}</b>
              <span style={{ color: '#888', fontSize: 12 * fs, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }} title={t.systems.join(' · ')}>{t.systems.join(' · ')}</span></div>
            <div style={{ color: '#888', fontSize: 12 * fs, marginTop: 2, whiteSpace: 'nowrap' }}>장비 {k.total} · 자산 {k.assets}{k.due ? <b style={{ color: '#b45309', marginLeft: 6 }}>점검 지연 {k.due}</b> : ''}{k.dead ? <b style={{ color: '#374151', marginLeft: 6 }}>무전원 {k.dead}</b> : ''}</div>
            <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12 * fs, whiteSpace: 'nowrap' }}>
              <span style={{ color: k.alarm ? '#dc2626' : '#999' }}><Siren size={12} style={{ verticalAlign: -2 }} /> 경보 <b>{k.alarm}</b></span>
              <span style={{ color: k.fault ? '#f59e0b' : '#999' }}><AlertTriangle size={12} style={{ verticalAlign: -2 }} /> 장애 <b>{k.fault}</b></span>
              <span style={{ color: k.wo ? '#1d4ed8' : '#999' }}><Wrench size={12} style={{ verticalAlign: -2 }} /> 작업지시 <b>{k.wo}</b></span>
            </div>
            <div style={{ color: '#555', fontSize: 11.5 * fs, marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={metric(t)}>{metric(t)}</div>
          </div>) })}
      </div>
      </Section>

      {/* 1) 지금 처리할 것 — 층·팀 격자보다 먼저. 경보 → 장애 → 계측 위험/무전원 → 주의·작업지시 순 */}
      {(() => { const todo = rows.filter(r => (!team || teamOf(r)?.key === team) && rank(r, dead(r)) < 9).sort((a, b) => rank(a, dead(a)) - rank(b, dead(b)) || (b.elevation ?? 0) - (a.elevation ?? 0)); return (
        <Section title="지금 처리할 것" icon={Siren} color={todo.some(isAbn) ? '#dc2626' : undefined} count={<>{todo.length}{team ? ` · ${TEAMS.find(t => t.key === team)!.name}` : ''}{!todo.length && <span style={{ color: '#16a34a', marginLeft: 6 }}>이상·미처리 없음</span>}</>} open={sec.todo} onToggle={() => toggleSec('todo')} pad={10}>
          {todo.length > 0 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '2px 14px' }}>
            {todo.slice(0, 12).map(r => <div key={r.globalId} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', alignItems: 'center' }}><b style={{ color: '#6b7280', fontSize: 12 * fs }}>{r.storey}</b><RowView r={r} modelId={modelId} dead={dead(r)} fresh={flash.has(r.globalId)} fs={fs} onTrend={setTrend} /></div>)}
            {todo.length > 12 && <div style={{ color: '#888', fontSize: 12 * fs, padding: 4 }}>… 외 {todo.length - 12}건은 아래 격자에서</div>}</div>}
        </Section>) })()}

      {/* 2) 핵심 장비 — 팀을 골랐을 때 그 팀의 원천 장비를 카드로 (격자 순서와 무관하게 늘 같은 자리) */}
      {team && (() => { const t = TEAMS.find(x => x.key === team)!; const keys = KEY_EQUIP[team] ?? []; const eq = keys.map(k => rows.find(r => r.name?.startsWith(k))).filter(Boolean) as Row[]; return eq.length ? (
        <Section title={`${t.name} 핵심 장비`} icon={t.icon} color={t.color} count={`${eq.length}대 · 이상 ${eq.filter(r => isAbn(r) || worst(r) !== 'ok').length}`} open={sec.key} onToggle={() => toggleSec('key')} pad={10}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {eq.map(r => { const st = r.status?.Status, sc = dead(r) ? { label: '무전원', color: '#374151' } : statusUi(st), rs = inlineReadings(r.status, r.name), w = worst(r); return (
              <a key={r.globalId} href={`#/models/${modelId}?sel=${encodeURIComponent(r.globalId)}&focus=1`} className={flash.has(r.globalId) ? 'fresh' : undefined} style={{ textDecoration: 'none', color: '#222', background: isAbn(r) ? (st === 'ALARM' ? '#fef2f2' : '#fffbeb') : w === 'crit' ? '#fff1f2' : w === 'warn' ? '#fffbeb' : '#fff', border: '1px solid ' + (isAbn(r) ? (st === 'ALARM' ? '#fecaca' : '#fde68a') : '#e5e7eb'), borderLeft: '4px solid ' + (sc?.color ?? '#d1d5db'), borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 * fs }} title={r.name ?? undefined}>{r.name}</span><b style={{ color: sc?.color ?? '#bbb', fontSize: 12 * fs, whiteSpace: 'nowrap' }}>{sc?.label ?? '—'}</b></div>
                <div style={{ color: '#888', fontSize: 11 * fs, marginTop: 2 }}>{r.storey}{r.zone ? ` · ${r.zone.split('-').pop()}` : ''}{r.openWorkOrders ? <b style={{ color: r.woAssignee ? '#1d4ed8' : '#b45309', marginLeft: 6 }}>WO {r.woAssignee ?? '미배정'}</b> : ''}</div>
                {rs.length > 0 && <div style={{ fontSize: 11.5 * fs, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: '2px 10px', alignItems: 'center' }}>{rs.slice(0, 4).map(x => <span key={x.key} style={{ color: LEVEL_COLOR[x.level], fontWeight: x.level === 'ok' ? 400 : 700 }}>{x.label} <b style={{ fontWeight: x.level === 'ok' ? 500 : 700 }}>{x.text}</b></span>)}<span onClick={e => { e.preventDefault(); setTrend(r) }} title="계측 트렌드" style={{ color: '#2563eb', cursor: 'pointer', display: 'inline-flex' }}><TrendingUp size={12} /></span></div>}
              </a>) })}
          </div>
        </Section>) : null })()}

      <Section title="층 × 팀 전체 현황" icon={Layers} color="#6b7280" count={`${storeys.length}개 층 · ${visibleTeams.length}개 팀${team ? ` — ${TEAMS.find(t => t.key === team)!.name}` : ''}${storeyF ? ` · ${storeyF}` : ''}`} open={sec.grid} onToggle={() => toggleSec('grid')} pad={10}
        right={<span style={{ display: 'inline-flex', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', fontSize: 12 * fs }}>
          {([['abnormal', '이상만'], ['equipment', '장비'], ['all', '전체']] as const).map(([k, l]) => <button key={k} onClick={() => setMode(k)} style={{ padding: '3px 9px', border: 0, cursor: 'pointer', background: mode === k ? '#1f2937' : '#fff', color: mode === k ? '#fff' : '#444', fontSize: 'inherit' }}>{l}</button>)}</span>}>
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
                {rs.map(r => <RowView key={r.globalId} r={r} modelId={modelId} dead={dead(r)} fresh={flash.has(r.globalId)} fs={fs} onTrend={setTrend} />)}
                {!rs.length && <div style={{ color: '#bbb', fontSize: 12 * fs, padding: 4 }}>{mode === 'abnormal' ? '이상 없음' : '—'}</div>}
              </div>) })}
          </div> })}
        </div></div>

        {/* 최근 이벤트 — 격자는 '지금'만 보여주므로 '언제 무슨 일이' 는 여기 */}
        <div className="monitor-events" style={{ width: kiosk ? 400 : 300, flexShrink: 0,   /* 벽면에선 '최근 무슨 일'이 격자보다 자주 읽힌다 */ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '8px 10px', position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflow: 'auto' }}>
          <div style={{ fontWeight: 600, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={14} /> 최근 이벤트 <span style={{ color: '#999', fontWeight: 400, fontSize: 11 * fs }}>{events.length}</span></div>
          {!events.length && <div style={{ color: '#bbb', fontSize: 12 * fs }}>아직 이벤트가 없습니다</div>}
          {events.map((e, i) => { const abn = e.status === 'ALARM' || e.status === 'FAULT'; return (
            <a key={i} href={e.globalId ? e.kind === 'WORK_ORDER' ? `#/models/${modelId}/fm?sel=${encodeURIComponent(e.globalId)}` : `#/models/${modelId}?sel=${encodeURIComponent(e.globalId)}&focus=1` : undefined} style={{ display: 'grid', gridTemplateColumns: `${40 * fs}px 1fr`, gap: 6, padding: '4px 4px', borderTop: '1px solid #f1f5f9', textDecoration: 'none', color: '#222', fontSize: 12 * fs }}>
              <span style={{ color: '#999', fontSize: 11 * fs, whiteSpace: 'nowrap' }}>{e.at ? new Date(e.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.kind === 'WORK_ORDER' ? <><Wrench size={11} style={{ verticalAlign: -1, color: '#1d4ed8' }} /> {e.woTitle}</> : <><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusUi(e.status)?.color ?? '#9ca3af', marginRight: 4 }} />{e.name} → <b style={{ color: abn ? statusUi(e.status)!.color : '#16a34a' }}>{statusUi(e.status)?.label ?? e.status}</b></>}</div>
                <div style={{ color: '#999', fontSize: 11 * fs }}>{e.storey ?? ''}{e.kind === 'WORK_ORDER' ? ` · 작업지시 ${WO_STATUS[e.woStatus as WoStatus] ?? e.woStatus}` : ''}</div>
              </span>
            </a>) })}
        </div>
      </div>
      </Section>

      {/* 경보 통계 — 이력(op_event)이 있어서 나오는 것. 격자는 '지금', 여기는 '얼마나 자주·얼마나 오래' */}
      {(() => { const ts = teamStats(stats), total = stats.reduce((n, r) => n + r.alarms + r.faults, 0), recurring = stats.filter(r => r.alarms + r.faults >= 2).slice(0, 8); return (
        <Section title="경보 통계" icon={BarChart3} color="#6b7280" count={sec.stats ? `${days}일 · 에피소드 ${total} · 재발 장비 ${stats.filter(r => r.alarms + r.faults >= 2).length}` : '발생 빈도 · 복구 시간 · 재발'} open={sec.stats} onToggle={() => toggleSec('stats')} pad={10}
          right={<select value={days} onChange={e => setDays(+e.target.value)} onClick={e => e.stopPropagation()} style={{ fontSize: 12 * fs }}>{[7, 30, 90].map(d => <option key={d} value={d}>최근 {d}일</option>)}</select>}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12.5 * fs, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, minWidth: 520 }}><thead>
              <tr style={{ color: '#666', textAlign: 'right' }}><th style={{ ...th, textAlign: 'left' }}>팀</th><th style={th}>경보</th><th style={th}>장애</th><th style={th} title="정상→이상 전이부터 다시 정상이 기록될 때까지, 복구된 에피소드 평균">평균 복구</th><th style={th}>미복구</th><th style={th} title="기간 안에 2회 이상 발생한 장비">재발 장비</th></tr></thead><tbody>
              {ts.map(s => <tr key={s.team.key} style={{ textAlign: 'right', borderTop: '1px solid #f1f5f9', color: s.alarms + s.faults ? '#222' : '#aaa' }}>
                <td style={{ ...td, textAlign: 'left', color: s.team.color, fontWeight: 600 }}><s.team.icon size={12} style={{ verticalAlign: -2 }} /> {s.team.name}</td>
                <td style={{ ...td, color: s.alarms ? '#dc2626' : undefined, fontWeight: s.alarms ? 700 : 400 }}>{s.alarms}</td><td style={{ ...td, color: s.faults ? '#b45309' : undefined, fontWeight: s.faults ? 700 : 400 }}>{s.faults}</td>
                <td style={td}>{fmtMin(s.mttrMin)}</td><td style={{ ...td, color: s.open ? '#dc2626' : undefined }}>{s.open}</td><td style={td}>{s.recurring}</td></tr>)}
            </tbody></table>
            <div style={{ flex: 1, minWidth: 280, fontSize: 12 * fs }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>재발 상위 <span style={{ color: '#999', fontWeight: 400 }}>같은 장비에 반복되면 원인 점검 대상</span></div>
              {!recurring.length && <div style={{ color: '#bbb' }}>{stats.length ? '재발 장비 없음' : `최근 ${days}일 경보·장애 없음`}</div>}
              {recurring.map(r => <a key={r.globalId} href={`#/models/${modelId}?sel=${encodeURIComponent(r.globalId)}&focus=1`} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, padding: '3px 4px', borderTop: '1px solid #f1f5f9', textDecoration: 'none', color: '#222' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name ?? r.globalId}</span><span style={{ color: '#666' }}>{r.alarms ? `경보 ${r.alarms}` : ''}{r.alarms && r.faults ? ' · ' : ''}{r.faults ? `장애 ${r.faults}` : ''}</span>
                <span style={{ color: '#999' }}>{r.mttrMin == null ? (r.open ? '미복구' : '') : `복구 ${fmtMin(r.mttrMin)}`}</span></a>)}
            </div>
          </div>
        </Section>) })()}
      {sel && !kiosk && <ObjectDrawer modelId={modelId} gid={sel} tick={tick} reload={load} onClose={() => { location.hash = `#/models/${modelId}/monitor` }} />}
      {trend && <TrendModal modelId={modelId} globalId={trend.globalId} name={trend.name ?? trend.globalId} onClose={() => setTrend(null)} />}
    </main>
  )
}

const Stat = ({ icon: Icon, label, n, color, sub }: { icon: typeof Siren; label: string; n: number | string; color: string; sub?: string }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}><Icon size={14} style={{ color: (typeof n === 'number' && n === 0) ? '#9ca3af' : color }} /><span style={{ color: '#555' }}>{label}</span><b style={{ color: (typeof n === 'number' && n === 0) ? '#9ca3af' : color }}>{n}</b>{sub && <span style={{ color: '#888', fontSize: '0.9em' }}>{sub}</span>}</span>)

function RowView({ r, modelId, dead, fresh, fs, onTrend }: { r: Row; modelId: string; dead?: boolean; fresh?: boolean; fs: number; onTrend?: (t: { globalId: string; name: string | null }) => void }) {
  const hasNum = Object.entries(r.status ?? {}).some(([k, v]) => typeof v === 'number' && k !== 'UpdatedAt')
  const s = r.status?.Status, st = dead ? { label: '무전원', color: '#374151' } : statusUi(s)
  const abnormal = isAbn(r); const rs = inlineReadings(r.status, r.name); const all = readings(r.status, r.name)
  return (
    <a data-gid={r.globalId} href={`#/models/${modelId}/monitor${selQ(r.globalId)}`} title={`${r.ifcClass} · ${r.zone ?? r.storey}${all.length ? '\n' + all.map(x => `${x.label} ${x.text}`).join(' · ') : ''}\n클릭: 객체 패널 · 3D 아이콘: 뷰어에서 구역 강조`} className={fresh ? 'fresh' : undefined}
       style={{ display: 'block', padding: '3px 6px', borderRadius: 5, textDecoration: 'none', color: '#222', fontSize: 12 * fs, background: abnormal ? (s === 'ALARM' ? '#fef2f2' : '#fffbeb') : dead ? '#f3f4f6' : worst(r) === 'crit' ? '#fff1f2' : worst(r) === 'warn' ? '#fffbeb' : 'transparent', opacity: dead ? 0.7 : 1 }}>
      <span style={{ display: 'grid', gridTemplateColumns: '10px minmax(60px, 1fr) minmax(0, auto) auto', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: st?.color ?? '#d1d5db' }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}{r.zone && <span style={{ color: '#999', marginLeft: 4 }}>{r.zone.split('-').pop()}</span>}</span>
        <span style={{ color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.openWorkOrders ? <b onClick={e => { e.preventDefault(); e.stopPropagation(); location.hash = `#/models/${modelId}/fm?sel=${encodeURIComponent(r.globalId)}` }} style={{ color: r.woAssignee ? '#1d4ed8' : '#b45309', cursor: 'pointer' }} title={`작업지시 ${r.openWorkOrders}건 — 클릭: 칸반 카드로`}>WO {r.woAssignee ?? '미배정'}{r.woDueOn ? ` ~${day(r.woDueOn).slice(5)}` : ''}</b>
            : r.assetTag ? <><Box size={10} style={{ verticalAlign: -1 }} /> {r.assetTag}</> : ''}
          {r.lastResult === 'DEFECT' && !r.openWorkOrders ? <b style={{ color: '#b91c1c', marginLeft: 4 }}>결함</b> : ''}
          {overdue(r) ? <b style={{ color: '#b45309', marginLeft: 4 }} title={`다음 점검 ${day(r.nextDueOn!)} 지남`}>점검 지연</b> : ''}</span>
        <b style={{ color: st?.color ?? '#bbb', minWidth: 28, textAlign: 'right', whiteSpace: 'nowrap' }}>{st?.label ?? ''}{hasNum && onTrend && <span onClick={e => { e.preventDefault(); e.stopPropagation(); onTrend({ globalId: r.globalId, name: r.name }) }} title="계측 트렌드" style={{ color: '#2563eb', cursor: 'pointer', marginLeft: 5, verticalAlign: -1, display: 'inline-flex' }}><TrendingUp size={11} /></span>}<span onClick={e => { e.preventDefault(); e.stopPropagation(); location.hash = objLinks(modelId, r.globalId).viewer }} title="3D 위치 — 뷰어에서 구역 강조" style={{ color: '#94a3b8', cursor: 'pointer', marginLeft: 5, verticalAlign: -1, display: 'inline-flex' }}><ExternalLink size={11} /></span></b>
      </span>
      {rs.length > 0 && <span style={{ display: 'block', paddingLeft: 16, marginTop: 1, fontSize: 11 * fs, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {rs.slice(0, 3).map(x => <span key={x.key} style={{ color: LEVEL_COLOR[x.level], fontWeight: x.level === 'ok' ? 400 : 700, marginRight: 8 }}>{x.label} {x.text}</span>)}{rs.length > 3 && <span style={{ color: '#bbb' }}>+{rs.length - 3}</span>}</span>}
    </a>
  )
}
/** 알림음: 외부 파일 없이 WebAudio 로 짧은 비프 2회 */
const beep = () => { try { const c = new AudioContext(); [0, 0.25].forEach(t => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.15, c.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + t + 0.18); o.start(c.currentTime + t); o.stop(c.currentTime + t + 0.2) }) } catch { /* 자동재생 차단 등 — 무시 */ } }
const th = { padding: '6px 10px', fontWeight: 600, whiteSpace: 'nowrap' as const }
const td = { padding: '5px 10px', whiteSpace: 'nowrap' as const, fontVariantNumeric: 'tabular-nums' as const }
/** 복구 시간(분) → 사람 말: 1분 미만 · N분 · N.N시간 · N일 */
const fmtMin = (m: number | null) => m == null ? '—' : m < 1 ? '1분 미만' : m < 60 ? `${m}분` : m < 1440 ? `${(m / 60).toFixed(1)}시간` : `${(m / 1440).toFixed(1)}일`
