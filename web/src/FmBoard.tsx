import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Calendar, ChevronLeft, ChevronRight, ChevronsUp, ExternalLink, Plus, Search, User, X } from 'lucide-react'
import { post, type Asset, type Priority, type WorkOrder } from './api'
import { StatusBadge, day } from './viewer/FmPanel'
import { TEAMS, teamOfSystems } from './teams'
import { ifcKo } from './ifcNames'

const teamOf = (w: WorkOrder) => teamOfSystems(w.systems)
const PRIO: Record<Priority, { label: string; color: string; icon?: typeof ArrowUp }> = {
  URGENT: { label: '긴급', color: '#b91c1c', icon: ChevronsUp }, HIGH: { label: '높음', color: '#ea580c', icon: ArrowUp }, NORMAL: { label: '보통', color: '#2563eb' }, LOW: { label: '낮음', color: '#6b7280', icon: ArrowDown } }
const COLS: WorkOrder['status'][] = ['OPEN', 'IN_PROGRESS', 'DONE']
const COL_NAME = { OPEN: '대기', IN_PROGRESS: '진행', DONE: '완료' } as const
/** 카드 버튼용 다음 단계 (드래그 못 하는 키보드·터치 경로) */
const NEXT: Record<WorkOrder['status'], { s: WorkOrder['status']; label: string }> = { OPEN: { s: 'IN_PROGRESS', label: '시작' }, IN_PROGRESS: { s: 'DONE', label: '완료' }, DONE: { s: 'OPEN', label: '다시 열기' } }
const useEsc = (fn: () => void) => useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && fn(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) }, [fn])
const overdue = (w: WorkOrder) => !!w.dueOn && w.status !== 'DONE' && new Date(w.dueOn) < new Date(new Date().toDateString())

export default function FmBoard({ modelId, wos: server, assets, reload }: { modelId: string; wos: WorkOrder[]; assets: Asset[]; reload: () => Promise<unknown> }) {
  const [q, setQ] = useState(''); const [team, setTeam] = useState<string>(); const [assignee, setAssignee] = useState<string>(); const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [open, setOpen] = useState<WorkOrder>(); const [creating, setCreating] = useState(false); const [dragOver, setDragOver] = useState<string>(); const [dragging, setDragging] = useState<string>()
  const [pending, setPending] = useState<Record<string, WorkOrder['status']>>({})   // 낙관적 상태: 서버 응답 전 카드를 먼저 옮김
  const [toast, setToast] = useState<{ msg: string; undo?: () => void; error?: boolean }>()
  const [folded, setFolded] = useState<Set<WorkOrder['status']>>(() => { try { return new Set(JSON.parse(localStorage.getItem('fm.foldedCols') ?? '["DONE"]')) } catch { return new Set<WorkOrder['status']>(['DONE']) } })   // 접힌 열 — 완료는 쌓이기만 하니 기본 접힘
  const fold = (s: WorkOrder['status']) => setFolded(f => { const n = new Set(f); if (n.has(s)) n.delete(s); else n.add(s); try { localStorage.setItem('fm.foldedCols', JSON.stringify([...n])) } catch { /* 저장 불가 환경 */ } return n })
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(undefined), toast.error ? 6000 : 4000); return () => clearTimeout(t) }, [toast])
  const wos = useMemo(() => server.map(w => pending[w.id] ? { ...w, status: pending[w.id] } : w), [server, pending])
  const assignees = useMemo(() => [...new Set(wos.map(w => w.assignee).filter(Boolean) as string[])].sort(), [wos])
  const visible = wos.filter(w => (!team || teamOf(w)?.key === team) && (!assignee || w.assignee === assignee) && (!onlyOverdue || overdue(w))
    && (!q || [w.title, w.assetTag, w.elementName, w.assignee, w.description].some(x => x?.toLowerCase().includes(q.toLowerCase()))))
  const move = (w: WorkOrder, s: WorkOrder['status'], undo = true): Promise<unknown> => {
    if (w.status === s) return Promise.resolve()
    const from = w.status; setPending(p => ({ ...p, [w.id]: s }))
    return post(`/work-orders/${w.id}`, { status: s }, 'PATCH').then(reload)
      .then(() => undo && setToast({ msg: `"${w.title}" → ${COL_NAME[s]}`, undo: () => move({ ...w, status: s }, from, false) }))
      .catch(e => setToast({ msg: `이동 실패: ${e.message}`, error: true }))
      .finally(() => setPending(p => { const { [w.id]: _, ...rest } = p; return rest }))
  }
  const viewerUrl = (w: WorkOrder) => { const p = new URLSearchParams({ wo: w.id }); if (w.viewpoint?.v) p.set('v', w.viewpoint.v.join(',')); const sel = w.viewpoint?.sel ?? (w.globalId ? [w.globalId] : undefined); if (sel) p.set('sel', sel.join(',')); if (w.viewpoint?.clip) p.set('clip', w.viewpoint.clip.join(',')); if (!w.viewpoint?.v) p.set('focus', '1'); return `#/models/${modelId}?${p}` }

  return (
    <div>
      {/* 필터 바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative' }}><Search size={13} style={{ position: 'absolute', left: 8, top: 8, color: '#999' }} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="제목 · 자산 · 담당" style={{ ...inp, paddingLeft: 26, width: 220 }} /></div>
        <div style={{ display: 'flex', gap: 4 }}>{TEAMS.map(t => <button key={t.key} onClick={() => setTeam(team === t.key ? undefined : t.key)} style={{ ...chip, borderColor: team === t.key ? t.color : '#ddd', background: team === t.key ? t.color : '#fff', color: team === t.key ? '#fff' : '#444' }}>{t.short}</button>)}</div>
        <select value={assignee ?? ''} onChange={e => setAssignee(e.target.value || undefined)} style={inp}><option value="">담당자 전체</option>{assignees.map(a => <option key={a}>{a}</option>)}</select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#b91c1c' }}><input type="checkbox" checked={onlyOverdue} onChange={e => setOnlyOverdue(e.target.checked)} /> 기한 초과만</label>
        <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>{visible.length} / {wos.length}</span>
        <button onClick={() => setCreating(true)} style={{ ...btn, background: '#2563eb', color: '#fff', border: 0 }}><Plus size={13} /> 새 작업지시</button>
      </div>

      {/* 칸반 */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS.map(s => folded.has(s) ? '44px' : 'minmax(0, 1fr)').join(' '), gap: 12 }}>
        {COLS.map(s => { const items = visible.filter(w => w.status === s); if (folded.has(s)) return (
          <div key={s} onClick={() => fold(s)} onDragOver={e => { e.preventDefault(); setDragOver(s) }} onDragLeave={() => setDragOver(undefined)}
               onDrop={e => { e.preventDefault(); setDragOver(undefined); setDragging(undefined); const w = wos.find(x => x.id === e.dataTransfer.getData('text/wo')); if (w) move(w, s) }}
               title={`${COL_NAME[s]} ${items.length}건 — 클릭해서 펼치기 (끌어다 놓기도 됨)`}
               style={{ background: dragOver === s ? '#eef2ff' : '#f3f4f6', borderRadius: 10, minHeight: 320, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '10px 0', outline: dragOver === s ? '2px dashed #2563eb' : 'none' }}>
            <ChevronRight size={14} style={{ color: '#999' }} /><StatusBadge s={s} /><b style={{ color: '#666', fontSize: 12 }}>{items.length}</b>
            <span style={{ writingMode: 'vertical-rl', color: '#999', fontSize: 11, letterSpacing: 2 }}>{COL_NAME[s]} 열 접힘</span></div>); return (
          <div key={s} onDragOver={e => { e.preventDefault(); setDragOver(s) }} onDragLeave={() => setDragOver(undefined)}
               onDrop={e => { e.preventDefault(); setDragOver(undefined); setDragging(undefined); const w = wos.find(x => x.id === e.dataTransfer.getData('text/wo')); if (w) move(w, s) }}
               style={{ background: dragOver === s ? '#eef2ff' : '#f3f4f6', borderRadius: 10, padding: 10, minHeight: 320, outline: dragOver === s ? '2px dashed #2563eb' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, minHeight: 20 }}><StatusBadge s={s} /><span style={{ color: '#888' }}>{items.length}</span>
              {dragOver === s ? <span style={{ color: '#2563eb', fontSize: 11, marginLeft: 'auto', fontWeight: 600 }}>→ {COL_NAME[s]}(으)로 이동</span>
                : s !== 'DONE' && items.some(overdue) && <span style={{ color: '#b91c1c', fontSize: 11, marginLeft: 'auto' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> 초과 {items.filter(overdue).length}</span>}
              <span onClick={() => fold(s)} title="열 접기" style={{ marginLeft: dragOver === s || (s !== 'DONE' && items.some(overdue)) ? 6 : 'auto', cursor: 'pointer', color: '#aaa', display: 'inline-flex' }}><ChevronLeft size={14} /></span></div>
            {items.map(w => <Card key={w.id} w={w} dragging={dragging === w.id} busy={w.id in pending} onOpen={() => setOpen(w)} viewerUrl={viewerUrl(w)}
                                  onDragStart={() => setDragging(w.id)} onDragEnd={() => { setDragging(undefined); setDragOver(undefined) }} onNext={() => move(w, NEXT[w.status].s)} />)}
            {!items.length && <div style={{ color: '#bbb', textAlign: 'center', padding: 24, fontSize: 12 }}>카드를 여기로 끌어다 놓으세요</div>}
          </div>) })}
      </div>

      {toast && <div role="status" style={{ position: 'fixed', left: '50%', bottom: 24, transform: 'translateX(-50%)', background: toast.error ? '#b91c1c' : '#1f2937', color: '#fff', padding: '8px 14px', borderRadius: 8, fontSize: 12, display: 'flex', gap: 12, alignItems: 'center', boxShadow: '0 6px 20px #0004', zIndex: 50 }}>
        <span>{toast.msg}</span>{toast.undo && <button onClick={() => { toast.undo!(); setToast(undefined) }} style={{ ...btn, background: 'transparent', color: '#93c5fd', border: '1px solid #93c5fd', padding: '2px 8px' }}>되돌리기</button>}</div>}
      {open && <Drawer w={wos.find(x => x.id === open.id) ?? open} modelId={modelId} viewerUrl={viewerUrl(open)} onClose={() => setOpen(undefined)} reload={reload} move={move} />}
      {creating && <CreateModal assets={assets} onClose={() => setCreating(false)} reload={reload} />}
    </div>
  )
}

function Card({ w, dragging, busy, onOpen, viewerUrl, onDragStart, onDragEnd, onNext }: { w: WorkOrder; dragging: boolean; busy: boolean; onOpen: () => void; viewerUrl: string; onDragStart: () => void; onDragEnd: () => void; onNext: () => void }) {
  const t = teamOf(w), pr = PRIO[w.priority ?? 'NORMAL'], Pi = pr.icon, od = overdue(w), nx = NEXT[w.status]
  return (
    <div draggable={!busy} onDragStart={e => { e.dataTransfer.setData('text/wo', w.id); e.dataTransfer.effectAllowed = 'move'; onDragStart() }} onDragEnd={onDragEnd} onClick={onOpen}
         style={{ background: '#fff', borderRadius: 8, padding: '8px 10px', marginBottom: 8, boxShadow: '0 1px 2px #0001', borderLeft: '4px solid ' + (t?.color ?? '#ddd'), cursor: busy ? 'progress' : 'grab',
                  opacity: dragging ? 0.35 : busy ? 0.6 : w.status === 'DONE' ? 0.75 : 1, outline: dragging ? '2px dashed #2563eb' : 'none', transition: 'opacity .15s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {Pi && <Pi size={13} style={{ color: pr.color, flexShrink: 0 }} aria-label={pr.label} />}
        <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
        {t && <span style={{ fontSize: 10, color: t.color, border: '1px solid ' + t.color, borderRadius: 4, padding: '0 4px' }}>{t.short}</span>}
      </div>
      <div style={{ color: '#666', fontSize: 12, margin: '3px 0 5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.assetTag} · {w.storey}{w.zone ? ` ${w.zone.split('-').pop()}` : ''} · {w.elementName?.split(':')[0]}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#888' }}>
        <span><User size={11} style={{ verticalAlign: -2 }} /> {w.assignee ?? '미배정'}</span>
        {w.dueOn && <span style={{ color: od ? '#b91c1c' : '#888', fontWeight: od ? 700 : 400 }}><Calendar size={11} style={{ verticalAlign: -2 }} /> {day(w.dueOn)}{od ? ' 초과' : ''}</span>}
        <span style={{ flex: 1 }} />
        <a href={viewerUrl} onClick={e => e.stopPropagation()} title="3D 위치" style={{ color: '#2563eb', display: 'inline-flex' }}><ExternalLink size={12} /></a>
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#0003', zIndex: 40 }}>
      <div onClick={e => e.stopPropagation()} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 440, background: '#fff', boxShadow: '-4px 0 20px #0002', padding: 18, overflow: 'auto', fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}><StatusBadge s={w.status} />{t && <span style={{ fontSize: 11, color: t.color, border: '1px solid ' + t.color, borderRadius: 4, padding: '0 5px' }}>{t.short}</span>}
          <span style={{ color: '#999', fontSize: 11 }}>{w.id.slice(0, 8)}</span><X size={16} style={{ marginLeft: 'auto', cursor: 'pointer', color: '#666' }} onClick={onClose} /></div>
        <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={{ ...inp, width: '100%', fontSize: 15, fontWeight: 600, marginBottom: 10 }} />
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', rowGap: 8, columnGap: 8, alignItems: 'center' }}>
          <span style={lbl}>상태</span><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>{COLS.map(s => <button key={s} onClick={() => move(w, s)} style={{ ...chip, fontWeight: w.status === s ? 700 : 400, borderColor: w.status === s ? '#2563eb' : '#ddd', background: w.status === s ? '#eff6ff' : '#fff' }}>{COL_NAME[s]}</button>)}<span style={{ fontSize: 10, color: '#999' }}>즉시 저장</span></div>
          <span style={lbl}>우선순위</span><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as Priority })} style={inp}>{(Object.keys(PRIO) as Priority[]).map(p => <option key={p} value={p}>{PRIO[p].label}</option>)}</select>
          <span style={lbl}>담당자</span><input value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })} placeholder="미배정" style={inp} />
          <span style={lbl}>기한</span><input type="date" value={f.dueOn} onChange={e => setF({ ...f, dueOn: e.target.value })} style={inp} />
          <span style={lbl}>자산</span><span><b>{w.assetTag}</b> <span style={{ color: '#666' }}>{w.assetCategory}</span></span>
          <span style={lbl}>위치</span><span>{w.storey}{w.zone ? ` · ${w.zone}` : ''} · {w.elementName} <a href={viewerUrl} style={{ color: '#2563eb', marginLeft: 6 }}><ExternalLink size={12} style={{ verticalAlign: -2 }} /> 3D</a></span>
          {w.inspectionNote && <><span style={lbl}>점검 메모</span><span style={{ color: '#b91c1c' }}>{w.inspectionNote}</span></>}
          <span style={lbl}>생성 / 변경</span><span style={{ color: '#666', fontSize: 12 }}>{new Date(w.createdAt).toLocaleString()} / {w.updatedAt ? new Date(w.updatedAt).toLocaleString() : '—'}</span>
        </div>
        <div style={{ marginTop: 12 }}><div style={lbl}>설명</div>
          <textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={5} placeholder="작업 내용과 조치 사항" style={{ ...inp, width: '100%', resize: 'vertical', fontFamily: 'inherit' }} /></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button disabled={saving} onClick={save} style={{ ...btn, background: '#2563eb', color: '#fff', border: 0 }}>저장</button>
          <a href={`#/models/${modelId}?sel=${encodeURIComponent(w.globalId ?? '')}&fm=1`} style={btn}>뷰어에서 자산·점검 보기</a>
        </div>
      </div>
    </div>
  )
}

function CreateModal({ assets, onClose, reload }: { assets: Asset[]; onClose: () => void; reload: () => Promise<unknown> }) {
  const [f, setF] = useState({ assetId: assets[0]?.id ?? '', title: '', assignee: '', dueOn: '', priority: 'NORMAL' as Priority, description: '' }); const [q, setQ] = useState(''); const [err, setErr] = useState<string>()
  useEsc(onClose)
  const list = assets.filter(a => { const t = q.toLowerCase(); return !t || [a.tag, a.elementName, a.storey, a.zone, a.category, ifcKo(a.ifcClass)].some(x => x?.toLowerCase().includes(t)) }).slice(0, 300)
  const submit = () => { setErr(undefined); post(`/assets/${f.assetId}/work-orders`, { title: f.title, assignee: f.assignee || null, dueOn: f.dueOn || null, priority: f.priority, description: f.description || null }).then(() => { onClose(); reload() }).catch(e => setErr(e.message)) }
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#0004', zIndex: 40, display: 'grid', placeItems: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 480, background: '#fff', borderRadius: 12, padding: 18, fontSize: 13, boxShadow: '0 10px 40px #0003' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}><b style={{ fontSize: 15 }}>새 작업지시</b><X size={16} style={{ marginLeft: 'auto', cursor: 'pointer', color: '#666' }} onClick={onClose} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', rowGap: 8, columnGap: 8, alignItems: 'center' }}>
          <span style={lbl}>자산</span><div><input value={q} onChange={e => setQ(e.target.value)} placeholder="태그 · 이름 · 층 · 구역 · 분류 검색" autoFocus style={{ ...inp, width: '100%', marginBottom: 4 }} />
            <select value={f.assetId} onChange={e => setF({ ...f, assetId: e.target.value })} size={8} style={{ ...inp, width: '100%', fontFamily: 'inherit' }}>{list.map(a => <option key={a.id} value={a.id}>{a.storey ? `[${a.storey}${a.zone ? ' ' + a.zone.split('-').pop() : ''}] ` : ''}{a.tag} · {a.elementName ?? '(모델에 없음)'}</option>)}</select>
            <div style={{ color: '#888', fontSize: 11, marginTop: 2 }}>{list.length}{list.length === 300 ? '+' : ''} / {assets.length} · 뷰어에서 요소를 고른 뒤 "자산·점검" 탭에서 만드는 편이 빠릅니다</div></div>
          <span style={lbl}>제목 *</span><input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} style={inp} />
          <span style={lbl}>우선순위</span><select value={f.priority} onChange={e => setF({ ...f, priority: e.target.value as Priority })} style={inp}>{(Object.keys(PRIO) as Priority[]).map(p => <option key={p} value={p}>{PRIO[p].label}</option>)}</select>
          <span style={lbl}>담당자</span><input value={f.assignee} onChange={e => setF({ ...f, assignee: e.target.value })} style={inp} />
          <span style={lbl}>기한</span><input type="date" value={f.dueOn} onChange={e => setF({ ...f, dueOn: e.target.value })} style={inp} />
          <span style={lbl}>설명</span><textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
        </div>
        {err && <div style={{ color: '#b91c1c', marginTop: 8 }}>{err}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}><button onClick={onClose} style={btn}>취소</button><button disabled={!f.title || !f.assetId} onClick={submit} style={{ ...btn, background: '#2563eb', color: '#fff', border: 0 }}>생성</button></div>
      </div>
    </div>
  )
}

const inp = { padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#222', textDecoration: 'none' }
const chip = { ...btn, padding: '3px 8px', borderRadius: 999 }
const lbl = { fontSize: 11, color: '#666' }
