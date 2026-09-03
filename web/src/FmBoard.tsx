import { useMemo, useRef, useState, useEffect } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUp, X } from 'lucide-react'
import { api, post, type Asset, type Priority, type StatusRow, type WorkOrder } from './api'
import { StatusBadge } from './viewer/FmPanel'
import { patchStatus, statusPatchFor } from './statusApi'
import { btn, btnPrimary, dateTime, day, inp, useEsc, woOverdue } from './ui'
import { setHashParam, useHashQuery } from './useHashQuery'
import { isAbnormal, statusLabel, WO_STATUS } from './status'
import { TEAMS, teamOfSystems } from './teams'
import { ifcKo } from './ifcNames'
import { T } from './theme'
import NavLinks from './NavLinks'

const teamOf = (w: WorkOrder) => teamOfSystems(w.systems, w.elementName)
const PRIO: Record<Priority, { label: string; color: string; icon?: typeof ArrowUp }> = {
  URGENT: { label: '긴급', color: T.crit, icon: ChevronsUp }, HIGH: { label: '높음', color: T.warn, icon: ArrowUp }, NORMAL: { label: '보통', color: T.accent }, LOW: { label: '낮음', color: T.ink[3], icon: ArrowDown } }
const COLS: WorkOrder['status'][] = ['OPEN', 'IN_PROGRESS', 'DONE']
/** 카드 버튼용 다음 단계 (드래그 못 하는 키보드·터치 경로) */
const NEXT: Record<WorkOrder['status'], { s: WorkOrder['status']; label: string }> = { OPEN: { s: 'IN_PROGRESS', label: '시작' }, IN_PROGRESS: { s: 'DONE', label: '완료' }, DONE: { s: 'OPEN', label: '다시 열기' } }
const overdue = (w: WorkOrder) => woOverdue(w.dueOn, w.status)

export default function FmBoard({ modelId, wos: server, assets, reload, openWoId }: { modelId: string; wos: WorkOrder[]; assets: Asset[]; reload: () => Promise<unknown>; openWoId?: string }) {
  // 필터는 해시 쿼리와 동기화 (§7-3) — 초기값만 읽고 변경은 replaceState
  const hq = useHashQuery()
  const [q, setQS] = useState(() => hq.get('q') ?? ''); const [team, setTeamS] = useState<string | undefined>(() => hq.get('team') ?? undefined)
  const [assignee, setAssigneeS] = useState<string | undefined>(() => hq.get('assignee') ?? undefined); const [onlyOverdue, setOnlyOverdueS] = useState(hq.has('overdue'))
  const setQ = (v: string) => { setQS(v); setHashParam('q', v) }
  const setTeam = (v?: string) => { setTeamS(v); setHashParam('team', v) }
  const setAssignee = (v?: string) => { setAssigneeS(v); setHashParam('assignee', v) }
  const setOnlyOverdue = (v: boolean) => { setOnlyOverdueS(v); setHashParam('overdue', v ? '1' : undefined) }
  const [open, setOpen] = useState<WorkOrder>(); const [creating, setCreating] = useState(false); const [dragOver, setDragOver] = useState<string>(); const [dragging, setDragging] = useState<string>()
  const [pending, setPending] = useState<Record<string, WorkOrder['status']>>({})   // 낙관적 상태: 서버 응답 전 카드를 먼저 옮김
  const [toast, setToast] = useState<{ msg: string; undo?: () => void; error?: boolean; act?: { label: string; fn: () => void } }>()
  const [folded, setFolded] = useState<Set<WorkOrder['status']>>(() => { try { return new Set(JSON.parse(localStorage.getItem('fm.foldedCols') ?? '["DONE"]')) } catch { return new Set<WorkOrder['status']>(['DONE']) } })   // 접힌 열 — 완료는 쌓이기만 하니 기본 접힘
  const fold = (s: WorkOrder['status']) => setFolded(f => { const n = new Set(f); if (n.has(s)) n.delete(s); else n.add(s); try { localStorage.setItem('fm.foldedCols', JSON.stringify([...n])) } catch { /* 저장 불가 환경 */ } return n })
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(undefined), toast.act ? 10000 : toast.error ? 6000 : 4000); return () => clearTimeout(t) }, [toast])
  const applied = useRef<string>(undefined)   // 딥링크 1회 적용 — 사용자가 Drawer 를 닫으면 다시 열지 않는다
  useEffect(() => {
    if (!openWoId || applied.current === openWoId) return
    const w = server.find(x => x.id === openWoId); if (!w) return
    // oxlint-disable-next-line react/set-state-in-effect -- URL 딥링크(외부 시스템)와의 동기화
    applied.current = openWoId; setOpen(w)
    setFolded(f => { if (!f.has(w.status)) return f; const n = new Set(f); n.delete(w.status); return n })   // 접힌 열이면 펼침 (localStorage 저장 안 함 — 일시적)
  }, [openWoId, server])
  const wos = useMemo(() => server.map(w => pending[w.id] ? { ...w, status: pending[w.id] } : w), [server, pending])
  const assignees = useMemo(() => [...new Set(wos.map(w => w.assignee).filter(Boolean) as string[])].sort(), [wos])
  const visible = wos.filter(w => (!team || teamOf(w)?.key === team) && (!assignee || w.assignee === assignee) && (!onlyOverdue || overdue(w))
    && (!q || [w.title, w.assetTag, w.elementName, w.assignee, w.description].some(x => x?.toLowerCase().includes(q.toLowerCase()))))
  const move = (w: WorkOrder, s: WorkOrder['status'], undo = true): Promise<unknown> => {
    if (w.status === s) return Promise.resolve()
    const from = w.status; setPending(p => ({ ...p, [w.id]: s }))
    return post(`/work-orders/${w.id}`, { status: s }, 'PATCH').then(reload)
      .then(() => { if (undo) return recoverHint(w, s).then(act => setToast({ msg: `"${w.title}" → ${WO_STATUS[s]}${act ? ` — 장비는 아직 ${act.st}` : ''}`, undo: () => move({ ...w, status: s }, from, false), act: act?.act })) })
      .catch(e => setToast({ msg: `이동 실패: ${e.message}`, error: true }))
      .finally(() => setPending(p => { const { [w.id]: _, ...rest } = p; return rest }))
  }
  /** 완료했는데 장비가 아직 경보·장애면 원클릭 복구 제안 — 자동 복구는 안 한다(실제 해제는 BMS/현장 확인의 몫) */
  const recoverHint = (w: WorkOrder, s: WorkOrder['status']): Promise<{ st: string; act: { label: string; fn: () => void } } | undefined> => {
    if (s !== 'DONE' || !w.globalId) return Promise.resolve(undefined)
    return api<StatusRow[]>(`/models/${modelId}/status`).then(rows => {
      const st = rows.find(r => r.globalId === w.globalId)?.status?.Status
      if (!isAbnormal(st)) return undefined
      return { st: statusLabel(st), act: { label: '정상 복구', fn: () => { patchStatus(modelId, w.globalId!, statusPatchFor('NORMAL')).then(reload).then(() => setToast({ msg: `${w.elementName ?? w.assetTag} 정상 복구됨` })) } } }
    }).catch(() => undefined)
  }
  const viewerUrl = (w: WorkOrder) => { const p = new URLSearchParams({ wo: w.id }); if (w.viewpoint?.v) p.set('v', w.viewpoint.v.join(',')); const sel = w.viewpoint?.sel ?? (w.globalId ? [w.globalId] : undefined); if (sel) p.set('sel', sel.join(',')); if (w.viewpoint?.clip) p.set('clip', w.viewpoint.clip.join(',')); if (!w.viewpoint?.v) p.set('focus', '1'); return `#/models/${modelId}?${p}` }

  return (
    <div>
      {/* 필터 바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}>          <input value={q} onChange={e => setQ(e.target.value)} placeholder="제목 · 자산 · 담당" style={{ ...inp, width: 220 }} /></div>
        <div style={{ display: 'flex', gap: 4 }}>{TEAMS.map(t => <button key={t.key} onClick={() => setTeam(team === t.key ? undefined : t.key)} style={{ ...chip, borderColor: team === t.key ? t.color : T.bg.line, background: team === t.key ? t.color : T.ink[1], color: team === t.key ? T.bg.surface : T.ink[2] }}>{t.short}</button>)}</div>
        <select value={assignee ?? ''} onChange={e => setAssignee(e.target.value || undefined)} style={inp}><option value="">담당자 전체</option>{assignees.map(a => <option key={a}>{a}</option>)}</select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: T.crit }}><input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> 기한 초과만</label>
        <span style={{ marginLeft: 'auto', color: T.ink[2], fontSize: 12 }}>{visible.length} / {wos.length}</span>
        <button onClick={() => setCreating(true)} style={btnPrimary}>새 작업지시</button>
      </div>

      {/* 칸반 */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS.map(s => folded.has(s) ? '44px' : 'minmax(0, 1fr)').join(' '), gap: 12 }}>
        {COLS.map(s => { const items = visible.filter(w => w.status === s); if (folded.has(s)) return (
          <div key={s} onClick={() => fold(s)} onDragOver={e => { e.preventDefault(); setDragOver(s) }} onDragLeave={() => setDragOver(undefined)}
               onDrop={e => { e.preventDefault(); setDragOver(undefined); setDragging(undefined); const w = wos.find(x => x.id === e.dataTransfer.getData('text/wo')); if (w) move(w, s) }}
               title={`${WO_STATUS[s]} ${items.length}건 — 클릭해서 펼치기 (끌어다 놓기도 됨)`}
               style={{ background: dragOver === s ? T.accentSoft : T.bg.raised, borderRadius: T.radius, minHeight: 320, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '10px 0', outline: dragOver === s ? `2px dashed ${T.accent}` : 'none' }}>
            <ChevronRight size={14} style={{ color: T.ink[2] }} /><StatusBadge s={s} /><b style={{ color: T.ink[2], fontSize: 12 }}>{items.length}</b>
            <span style={{ writingMode: 'vertical-rl', color: T.ink[2], fontSize: 11, letterSpacing: 2 }}>{WO_STATUS[s]} 열 접힘</span></div>); return (
          <div key={s} onDragOver={e => { e.preventDefault(); setDragOver(s) }} onDragLeave={() => setDragOver(undefined)}
               onDrop={e => { e.preventDefault(); setDragOver(undefined); setDragging(undefined); const w = wos.find(x => x.id === e.dataTransfer.getData('text/wo')); if (w) move(w, s) }}
               style={{ background: dragOver === s ? T.accentSoft : T.bg.raised, borderRadius: T.radius, padding: 10, minHeight: 320, outline: dragOver === s ? `2px dashed ${T.accent}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, minHeight: 20 }}><StatusBadge s={s} /><span style={{ color: T.ink[2] }}>{items.length}</span>
              {dragOver === s ? <span style={{ color: T.accent, fontSize: 11, marginLeft: 'auto', fontWeight: 600 }}>→ {WO_STATUS[s]}(으)로 이동</span>
                : s !== 'DONE' && items.some(overdue) && <span style={{ color: T.crit, fontSize: 11, marginLeft: 'auto' }}>초과 {items.filter(overdue).length}</span>}
              <span onClick={() => fold(s)} title="열 접기" style={{ marginLeft: dragOver === s || (s !== 'DONE' && items.some(overdue)) ? 6 : 'auto', cursor: 'pointer', color: T.ink[3], display: 'inline-flex' }}><ChevronLeft size={14} /></span></div>
            {items.map(w => <Card key={w.id} w={w} modelId={modelId} dragging={dragging === w.id} busy={w.id in pending} hilite={w.id === openWoId} lifted={open?.id === w.id} onOpen={() => setOpen(w)} viewerUrl={viewerUrl(w)}
                                  onDragStart={() => setDragging(w.id)} onDragEnd={() => { setDragging(undefined); setDragOver(undefined) }} onNext={() => move(w, NEXT[w.status].s)} />)}
            {!items.length && <div style={{ color: T.ink[3], textAlign: 'center', padding: 24, fontSize: 12 }}>카드를 여기로 끌어다 놓으세요</div>}
          </div>) })}
      </div>

      {toast && <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: toast.error ? T.crit : T.ink[1], color: T.bg.base, padding: '8px 14px', borderRadius: T.radius, fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', boxShadow: T.shadow, zIndex: 50 }}>
        <span>{toast.msg}</span>{toast.act && <button onClick={() => { toast.act!.fn(); setToast(undefined) }} style={{ ...btn, background: T.ok, color: T.bg.base, border: 0, padding: '2px 8px', fontWeight: 600 }}>{toast.act.label}</button>}{toast.undo && <button onClick={() => { toast.undo!(); setToast(undefined) }} style={{ ...btn, background: 'transparent', color: T.bg.base, border: '1px solid currentcolor', padding: '2px 8px', fontWeight: 600 }}>되돌리기</button>}</div>}
      {open && <Drawer key={open.id} w={wos.find(x => x.id === open.id) ?? open} modelId={modelId} viewerUrl={viewerUrl(open)} onClose={() => setOpen(undefined)} reload={reload} move={move} />}
      {creating && <CreateModal assets={assets} onClose={() => setCreating(false)} reload={reload} />}
    </div>
  )
}

function Card({ w, modelId, dragging, busy, hilite, lifted, onOpen, viewerUrl, onDragStart, onDragEnd, onNext }: { w: WorkOrder; modelId: string; dragging: boolean; busy: boolean; hilite?: boolean; lifted?: boolean; onOpen: () => void; viewerUrl: string; onDragStart: () => void; onDragEnd: () => void; onNext: () => void }) {
  const t = teamOf(w), pr = PRIO[w.priority ?? 'NORMAL'], Pi = pr.icon, od = overdue(w), nx = NEXT[w.status]
  return (
    <div draggable={!busy} onDragStart={e => { e.dataTransfer.setData('text/wo', w.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }} onDragEnd={onDragEnd} onClick={onOpen}
         style={{ background: T.bg.surface, borderRadius: T.radius, padding: '8px 10px', marginBottom: 8, boxShadow: T.shadow, borderLeft: '4px solid ' + (t?.color ?? T.bg.line), cursor: busy ? 'progress' : 'grab',
                  opacity: dragging ? 0.35 : busy ? 0.6 : w.status === 'DONE' && !lifted ? 0.75 : 1, outline: dragging ? `2px dashed ${T.accent}` : hilite || lifted ? `2px solid ${T.accent}` : 'none', transition: 'opacity .15s',
                  // 드로어가 열린 카드: 어두운 막(zIndex 40) 위로 띄워 "이 카드"가 그대로 보이게
                  ...(lifted ? { position: 'relative' as const, zIndex: 41, boxShadow: `0 0 0 4px ${T.accentSoft}, ${T.shadow}` } : {}) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {Pi && <Pi size={13} style={{ color: pr.color, flexShrink: 0 }} aria-label={pr.label} />}
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
        {t && <span style={{ fontSize: T.fs.xs, color: t.color, border: '1px solid ' + t.color, borderRadius: T.radius, padding: '0 4px' }}>{t.short}</span>}
      </div>
      <div style={{ color: T.ink[2], fontSize: 12, margin: '3px 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.assetTag} · {w.storey}{w.zone ? ` ${w.zone.split('-').pop()}` : ''} · {w.elementName?.split(':')[0]}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: T.ink[2] }}>
        <span>{w.assignee ?? '미배정'}</span>
        {w.dueOn && <span style={{ color: od ? T.crit : T.ink[2], fontWeight: od ? 600 : 400 }}>{day(w.dueOn)}{od ? ' 초과' : ''}</span>}
        <span style={{ flex: 1 }} />
        <NavLinks modelId={modelId} gid={w.globalId} viewer={viewerUrl} style={{ marginLeft: 0 }} />
        <button disabled={busy} onClick={e => { e.stopPropagation(); onNext() }} style={{ ...btn, padding: '1px 7px', fontSize: 11 }}>{nx.label}</button>
      </div>
    </div>
  )
}

function Drawer({ w, modelId, viewerUrl, onClose, reload, move }: { w: WorkOrder; modelId: string; viewerUrl: string; onClose: () => void; reload: () => Promise<unknown>; move: (w: WorkOrder, s: WorkOrder['status']) => Promise<unknown> }) {
  const [f, setF] = useState({ title: w.title, assignee: w.assignee ?? '', dueOn: w.dueOn ? day(w.dueOn) : '', priority: w.priority ?? 'NORMAL', description: w.description ?? '' })
  const [saving, setSaving] = useState(false); useEsc(onClose)
  const save = () => { setSaving(true); post(`/work-orders/${w.id}`, { title: f.title, assignee: f.assignee || null, dueOn: f.dueOn || null, priority: f.priority, description: f.description }, 'PATCH').then(reload).finally(() => setSaving(false)) }
  const t = teamOf(w)
  return (
    <>{/* 막(40) < 열린 카드(41, Card lifted) < 패널(42): 카드는 막 위로 뜨되 패널은 못 덮는다 */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40 }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, background: T.bg.surface, boxShadow: T.shadow, padding: 18, overflow: 'auto', fontSize: 13, zIndex: 42, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><StatusBadge s={w.status} />{t && <span style={{ fontSize: 11, color: t.color, border: '1px solid ' + t.color, borderRadius: T.radius, padding: '0 5px' }}>{t.short}</span>}
          <span style={{ color: T.ink[2], fontSize: 11 }}>{w.id.slice(0, 8)}</span><NavLinks modelId={modelId} gid={w.globalId} viewer={viewerUrl} style={{ fontSize: 12 }} /><X size={16} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={onClose} /></div>
        <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={{ ...inp, width: '100%', fontSize: 15, fontWeight: 600, marginBottom: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 8, columnGap: 8, alignItems: 'center' }}>
          <span style={lbl}>상태</span><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{COLS.map(s => <button key={s} onClick={() => move(w, s)} style={{ ...chip, fontWeight: w.status === s ? 700 : 400, borderColor: w.status === s ? T.accent : T.bg.line, background: w.status === s ? T.accentSoft : T.bg.surface }}>{WO_STATUS[s]}</button>)}<span style={{ fontSize: T.fs.xs, color: T.ink[2] }}>즉시 저장</span></div>
          <span style={lbl}>우선순위</span><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as Priority })} style={inp}>{(Object.keys(PRIO) as Priority[]).map(p => <option key={p} value={p}>{PRIO[p].label}</option>)}</select>
          <span style={lbl}>담당자</span><input value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })} placeholder="미배정" style={inp} />
          <span style={lbl}>기한</span><input type="date" value={f.dueOn} onChange={e => setF({ ...f, dueOn: e.target.value })} style={inp} />
          <span style={lbl}>자산</span><span><b>{w.assetTag}</b> <span style={{ color: T.ink[2] }}>{w.assetCategory}</span></span>
          <span style={lbl}>위치</span><span>{w.storey}{w.zone ? ` · ${w.zone}` : ''} · {w.elementName}</span>
          {w.inspectionNote && <><span style={lbl}>점검 메모</span><span style={{ color: T.crit }}>{w.inspectionNote}</span></>}
          <span style={lbl}>생성 / 변경</span><span style={{ color: T.ink[2], fontSize: 12 }}>{dateTime(w.createdAt)} / {w.updatedAt ? dateTime(w.updatedAt) : '—'}</span>
        </div>
        <div style={{ marginTop: 12 }}><div style={lbl}>설명</div>
          <textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={5} placeholder="작업 내용과 조치 사항" style={{ ...inp, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button disabled={saving} onClick={save} style={btnPrimary}>저장</button>
        </div>
      </div>
    </>
  )
}

function CreateModal({ assets, onClose, reload }: { assets: Asset[]; onClose: () => void; reload: () => Promise<unknown> }) {
  const [f, setF] = useState({ assetId: assets[0]?.id ?? '', title: '', assignee: '', dueOn: '', priority: 'NORMAL' as Priority, description: '' }); const [q, setQ] = useState(''); const [err, setErr] = useState<string>()
  useEsc(onClose)
  const list = assets.filter(a => { const t = q.toLowerCase(); return !t || [a.tag, a.elementName, a.storey, a.zone, a.category, ifcKo(a.ifcClass)].some(x => x?.toLowerCase().includes(t)) }).slice(0, 300)
  const submit = () => { setErr(undefined); post(`/assets/${f.assetId}/work-orders`, { title: f.title, assignee: f.assignee || null, dueOn: f.dueOn || null, priority: f.priority, description: f.description || null }).then(() => { onClose(); reload() }).catch(e => setErr(e.message)) }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 40, display: 'grid', placeItems: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, background: T.bg.surface, borderRadius: T.radius, padding: 18, fontSize: 13, boxShadow: T.shadow }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><b style={{ fontSize: 15 }}>새 작업지시</b><X size={16} style={{ marginLeft: 'auto', cursor: 'pointer', color: T.ink[2] }} onClick={onClose} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', rowGap: 8, columnGap: 8, alignItems: 'center' }}>
          <span style={lbl}>자산</span><div><input value={q} onChange={e => setQ(e.target.value)} placeholder="태그 · 이름 · 층 · 구역 · 분류 검색" autoFocus style={{ ...inp, width: '100%', marginBottom: 4 }} />
            <select value={f.assetId} onChange={e => setF({ ...f, assetId: e.target.value })} size={8} style={{ ...inp, width: '100%', fontFamily: 'inherit' }}>{list.map(a => <option key={a.id} value={a.id}>{a.storey ? `[${a.storey}${a.zone ? ' ' + a.zone.split('-').pop() : ''}] ` : ''}{a.tag} · {a.elementName ?? '(모델에 없음)'}</option>)}</select>
            <div style={{ color: T.ink[2], fontSize: 11, marginTop: 2 }}>{list.length}{list.length === 300 ? '+' : ''} / {assets.length} · 뷰어에서 요소를 고른 뒤 "자산·점검" 탭에서 만드는 편이 빠릅니다</div></div>
          <span style={lbl}>제목 *</span><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={inp} />
          <span style={lbl}>우선순위</span><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as Priority })} style={inp}>{(Object.keys(PRIO) as Priority[]).map(p => <option key={p} value={p}>{PRIO[p].label}</option>)}</select>
          <span style={lbl}>담당자</span><input value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })} style={inp} />
          <span style={lbl}>기한</span><input type="date" value={f.dueOn} onChange={e => setF({ ...f, dueOn: e.target.value })} style={inp} />
          <span style={lbl}>설명</span><textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        {err && <div style={{ color: T.crit, marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button onClick={onClose} style={btn}>취소</button><button disabled={!f.title || !f.assetId} onClick={submit} style={btnPrimary}>생성</button></div>
      </div>
    </div>
  )
}

const chip = { ...btn, padding: '3px 8px', borderRadius: 999 }
const lbl = { fontSize: 11, color: T.ink[2] }
