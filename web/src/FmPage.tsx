import { useCallback, useEffect, useRef, useState } from 'react'
import { Section } from './Section'
import { useSections } from './useSections'
import { api, post, type Asset, type WorkOrder } from './api'
import { btn, btnPrimary, day, inp, inspectionOverdue, plusDays } from './ui'
import { ifcKo } from './ifcNames'
import FmBoard from './FmBoard'
import { setHashParam, useHashQuery } from './useHashQuery'
import { AlertToast, useAlerts } from './useAlerts'
import ObjectDrawer from './ObjectDrawer'
import { useStream } from './stream'
import { T } from './theme'
import NavLinks from './NavLinks'

/** #/models/{id}/fm — 자산 대장 + 작업지시 보드. 작업지시 → 뷰어 뷰포인트로 이동 */
export default function FmPage({ modelId }: { modelId: string }) {
  const hq = useHashQuery()
  const [assets, setAssets] = useState<Asset[]>([])
  const [wos, setWos] = useState<WorkOrder[]>([])
  const [noAsset, setNoAsset] = useState(0)   // 계통 멤버 중 자산이 없는 요소 수 — bulk 가 등록할 대상과 같은 집계(MonitorController.monitor)
  const [open, toggle] = useSections('fm.sections', { board: true, assets: false })
  const [add, setAdd] = useState<{ tag: string; category: string } | null>(null)   // 모델에 없는 자산 추가 폼
  const [err, setErr] = useState<string>()
  const [editInt, setEditInt] = useState<string | null>(null)   // 주기 편집 중인 자산 id — 한 번에 한 행
  const cancelInt = useRef(false)   // Esc 로 닫을 때 뒤이은 blur 가 저장하지 않도록
  const [aq, setAq] = useState(''); const [acat, setAcat] = useState(''); const [ast, setAst] = useState('')   // 자산 대장 필터
  const [aod, setAodS] = useState(() => hq.has('due'))   // 점검 지연만 보기 — 모니터링 총계 '점검 지연' 딥링크(?due=1)로도 켜진다
  const setAod = (v: boolean) => { setAodS(v); setHashParam('due', v ? '1' : undefined) }
  const [aup, setAup] = useState(false)   // 점검 예정(30일)만 보기 — 예방정비 계획용
  const assetsRef = useRef<HTMLDivElement>(null)
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- 진입 시 1회: 지연 딥링크면 자산 대장으로 스크롤
  useEffect(() => { if (hq.has('due')) requestAnimationFrame(() => assetsRef.current?.scrollIntoView({ block: 'start' })) }, [])
  const reload = useCallback(() => Promise.all([api<Asset[]>(`/models/${modelId}/assets`), api<WorkOrder[]>(`/models/${modelId}/work-orders`)])
    .then(([a, w]) => { setAssets(a); setWos(w) }), [modelId])
  // 미등록 수(일괄 등록 버튼용)는 /monitor 를 따로, 모델 바뀔 때·일괄 등록 성공 뒤에만 — reload 는 작업지시 이벤트마다도 돌아 매번 받으면 무거운 모델에서 낭비(605KB~3.6MB)
  const reloadNoAsset = useCallback(() => api<{ rows: { assetId: string | null }[] }>(`/models/${modelId}/monitor`).then(m => setNoAsset(m.rows.filter(r => !r.assetId).length)).catch(() => setNoAsset(0)), [modelId])
  useEffect(() => { reloadNoAsset() }, [reloadNoAsset])
  useStream(modelId, ['work_order'], reload)   // 경보가 만든 작업지시가 칸반에 바로 뜬다
  const { fresh, dismiss } = useAlerts(modelId)   // 상태 구독(서버 푸시) — 전역 경보 토스트
  useEffect(() => { reload() }, [modelId, reload])

  // 딥링크: ?wo={id} → 보드 펼침 + 카드 하이라이트/Drawer, ?sel={gid} → 객체 패널(작업지시 목록 포함) + 자산 대장 필터
  const selGid = hq.get('sel')
  const woId = hq.get('wo') ?? undefined
  const selAsset = !woId && selGid ? assets.find(a => a.globalId === selGid) : undefined
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selAsset) setAq(selAsset.tag) }, [selAsset?.id])
  const isOverdue = (a: Asset) => inspectionOverdue(a.nextDueOn, a.status)
  const overdue = assets.filter(isOverdue).length
  const isSoon = (a: Asset) => a.status === 'ACTIVE' && !!a.nextDueOn && day(a.nextDueOn) <= plusDays(30)   // 지연 포함 — "이번 달 점검할 것"
  const soon = assets.filter(isSoon).length
  const filtered = assets.filter(a => (!acat || a.category === acat) && (!ast || a.storey === ast) && (!aod || isOverdue(a)) && (!aup || isSoon(a)) && (!aq || [a.tag, a.elementName].some(x => x?.toLowerCase().includes(aq.toLowerCase()))))
  const [limit, setLimit] = useState(PAGE)   // 자산 대장은 100행씩 — 1천 행 넘는 모델도 첫 렌더가 가볍게
  useEffect(() => setLimit(PAGE), [aq, acat, ast, aod, aup])   // 필터가 바뀌면 처음 100행부터
  const filteredAssets = aup ? [...filtered].sort((a, b) => day(a.nextDueOn!).localeCompare(day(b.nextDueOn!))) : filtered   // 예정 보기는 날짜순


  return (
    // U320: 기존엔 paddingRight 만 늘려 박스가 뷰포트보다 넓어지면 margin:auto 가 0 으로 무너져 좌측으로 붙었다.
    // 왼쪽 여백(LEFT_X)은 뷰포트 기준 고정값(선택 유무와 무관) — 폭만 패널 자리만큼 줄여 가운데 정렬 기준을 지킨다
    <main style={{ fontFamily: 'system-ui', fontSize: 13, boxSizing: 'border-box', marginLeft: LEFT_X, width: `min(${OUTER_W}px, calc(100vw - ${LEFT_X} - ${selGid ? PANEL_W : 0}px))`, padding: '24px 20px' }}>   {/* 객체 패널(440px) 자리 */}
      <Section title="작업지시 보드" count={`열림 ${wos.filter(w => w.status !== 'DONE').length} · 완료 ${wos.filter(w => w.status === 'DONE').length}`} open={open.board || !!woId} onToggle={() => toggle('board')}
               right={wos.length > 0 && <a href={`/api/models/${modelId}/export/bcf`} title="작업지시를 BCF 2.1 topic·viewpoint 로 — Navisworks·BIMcollab 등에서 열람" style={btn}>BCF 내보내기</a>}>
      <FmBoard modelId={modelId} wos={wos} assets={assets} reload={reload} openWoId={woId} />
      </Section>

      <div ref={assetsRef} />
      <Section title="자산 대장" count={`${assets.length}개 · 결함 ${assets.filter(a => a.lastResult === 'DEFECT').length} · 미점검 ${assets.filter(a => !a.lastInspectedOn).length} · 지연 ${overdue}`} open={open.assets || !!selAsset || aod} onToggle={() => toggle('assets')}
               right={<span style={{ display: 'inline-flex', gap: 8 }}>
                 {noAsset > 0 && <button onClick={() => post(`/models/${modelId}/assets/bulk`, {}).then(() => Promise.all([reload(), reloadNoAsset()]))} style={btn} title="배관·트레이·덕트를 뺀 장비 전부를 자산으로 등록">자산 일괄 등록 (미등록 {noAsset})</button>}
                 <a href={`/api/models/${modelId}/export/cobie`} title="COBie 시트(Facility·Floor·Space·Type·Component·Job) CSV zip" style={btn}>COBie 내보내기</a>
               </span>}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: T.ink[2], fontSize: 12 }}>3D 요소는 뷰어에서 자산으로 등록하고, 모델에 없는 장비(추가 설치분)는 여기서 태그만으로 추가합니다.</span>
          <button onClick={() => setAdd(add ? null : { tag: '', category: '' })} style={{ ...btn, marginLeft: 'auto' }}>자산 추가</button>
        </div>
        {add && <form onSubmit={e => { e.preventDefault(); setErr(undefined); post(`/models/${modelId}/assets`, add).then(() => { setAdd(null); reload() }).catch(e => setErr(e.message)) }}
                      style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 10, background: T.bg.raised, borderRadius: T.radius, marginBottom: 8 }}>
          <input value={add.tag} onChange={e => setAdd({ ...add, tag: e.target.value })} placeholder="태그 * (예: CCTV-01)" required style={inp} />
          <input value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })} placeholder="분류" style={inp} />
          <button type="submit" style={btnPrimary}>등록</button>
        </form>}
        {err && <div role="alert" style={{ color: T.crit, fontSize: 12, marginBottom: 8 }}>{err}</div>}   {/* 자산 추가·주기 편집 공용 — 폼이 닫혀 있어도 보이게 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <input value={aq} onChange={e => setAq(e.target.value)} placeholder="태그 · 이름 검색" style={{ ...inp, width: 200 }} />
          <select value={acat} onChange={e => setAcat(e.target.value)} style={inp}><option value="">분류 전체</option>{[...new Set(assets.map(a => a.category).filter(Boolean) as string[])].sort((x, y) => ifcKo(x).localeCompare(ifcKo(y))).map(c => <option key={c} value={c}>{ifcKo(c)}</option>)}</select>
          <select value={ast} onChange={e => setAst(e.target.value)} style={inp}><option value="">층 전체</option>{[...new Set(assets.map(a => a.storey).filter(Boolean) as string[])].map(s => <option key={s}>{s}</option>)}</select>
          <button onClick={() => setAod(!aod)} title="점검 주기를 넘긴 자산만" style={{ ...btn, ...(aod ? { background: T.crit, color: T.bg.base, border: `1px solid ${T.crit}` } : { color: overdue ? T.crit : T.ink[2] }) }}>지연 {overdue}</button>
          <button onClick={() => setAup(!aup)} title="다음 점검이 30일 안인 자산만 (지연 포함) — 날짜순 정렬" style={{ ...btn, ...(aup ? { background: T.accent, color: T.bg.base, border: `1px solid ${T.accent}` } : { color: T.ink[2] }) }}>예정 30일 {soon}</button>
          <span style={{ color: T.ink[2], fontSize: 12 }}>{filteredAssets.length} / {assets.length}</span>
        </div>
        <div style={{ border: `1px solid ${T.bg.line}`, borderRadius: T.radius, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 130px 70px 1fr 80px 110px 120px 80px 130px', gap: 8, padding: '8px 14px', background: T.bg.raised, color: T.ink[2], fontSize: 12 }}>
          <span>태그</span><span>분류</span><span>층</span><span>연결 요소</span><span>상태</span><span>최근 점검</span><span>다음 점검</span><span>작업지시</span><span /></div>
        {filteredAssets.slice(0, limit).map(a => <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '120px 130px 70px 1fr 80px 110px 120px 80px 130px', gap: 8, alignItems: 'center', padding: '8px 14px', borderTop: `1px solid ${T.bg.line}` }}>
          <b>{a.tag}</b><span title={a.category ?? ''}>{ifcKo(a.category)}</span><span style={{ color: T.ink[2] }}>{a.storey ?? '—'}{a.zone ? <span style={{ color: T.ink[3] }}> {a.zone.split('-').pop()}</span> : ''}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: a.globalId ? T.ink[1] : T.ink[2] }} title={a.elementName ?? ''}>{a.globalId ? a.elementName : '(모델에 없음)'}</span>
          <span style={{ fontSize: 12, color: a.status === 'ACTIVE' ? T.ink[2] : T.crit }}>{{ ACTIVE: '사용 중', OUT_OF_SERVICE: '사용 중지', RETIRED: '폐기' }[a.status]}</span>
          <span style={{ fontSize: 12, color: a.lastResult === 'DEFECT' ? T.crit : T.ink[2] }}>{a.lastInspectedOn ? `${day(a.lastInspectedOn)} ${a.lastResult === 'DEFECT' ? '결함' : '정상'}` : '—'}</span>
          <span style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            {editInt === a.id
              ? <input type="number" min={0} max={600} autoFocus defaultValue={(a.attributes?.intervalMonths as number | undefined) ?? ''} placeholder="주기" title="점검 주기(개월) — 비우거나 0이면 해제, 최대 600"
                       onBlur={e => { setEditInt(null); if (cancelInt.current) { cancelInt.current = false; return }
                         const v = e.target.value === '' ? 0 : +e.target.value
                         if (v !== ((a.attributes?.intervalMonths as number | undefined) ?? 0)) { setErr(undefined); post(`/assets/${a.id}`, { intervalMonths: v }, 'PATCH').then(reload).catch(x => setErr(x.message)) } }}
                       onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { cancelInt.current = true; e.currentTarget.blur() } }}
                       style={{ ...inp, width: 42, padding: '2px 4px', fontSize: 12 }} />
              : <button type="button" onClick={() => setEditInt(a.id)} title="클릭해서 점검 주기 수정" aria-label="점검 주기 편집"
                        style={{ border: 0, background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: a.attributes?.intervalMonths ? T.ink[1] : T.ink[3], textDecoration: 'underline dotted' }}>
                  {a.attributes?.intervalMonths ? `${a.attributes.intervalMonths}개월` : '—'}
                </button>}
            {a.nextDueOn ? <span style={{ color: isOverdue(a) ? T.crit : T.ink[2], fontWeight: isOverdue(a) ? 600 : 400 }}>{day(a.nextDueOn)}{isOverdue(a) ? ' 지연' : ''}</span> : <span style={{ color: T.bg.line }}>—</span>}
          </span>
          <span style={{ fontSize: 12 }}>{a.openWorkOrders ? `열림 ${a.openWorkOrders}`
            : isOverdue(a) ? <button onClick={() => post(`/assets/${a.id}/work-orders`, { title: `정기점검: ${a.elementName ?? a.tag}`, dueOn: plusDays(7), assignee: null }).then(reload)} title="점검이 지연된 자산 — 예방정비 작업지시 생성 (기한 7일)" style={{ ...btn, padding: '1px 7px', fontSize: 11 }}>작업지시</button>
            : '—'}</span>
          <span style={{ display: 'flex', justifyContent: 'flex-end' }}><NavLinks modelId={modelId} gid={a.globalId} style={{ fontSize: 12 }} /></span>
        </div>)}
        {!assets.length && <div style={{ padding: 24, textAlign: 'center', color: T.ink[2] }}>등록된 자산이 없습니다. 뷰어에서 요소를 골라 등록하거나, 위 "자산 일괄 등록"으로 한 번에 등록하세요.</div>}
        {filteredAssets.length > limit && <button onClick={() => setLimit(l => l + PAGE)} style={{ ...btn, display: 'flex', justifyContent: 'center', width: '100%', borderRadius: 0, border: 0, borderTop: `1px solid ${T.bg.line}`, padding: 10, color: T.accent }}>더 보기 (+{Math.min(PAGE, filteredAssets.length - limit)} · 남은 {filteredAssets.length - limit})</button>}
        {assets.length > 0 && !filteredAssets.length && <div style={{ padding: 24, textAlign: 'center', color: T.ink[2] }}>조건에 맞는 자산이 없습니다.</div>}
        </div>
      </Section>
      {selGid && <ObjectDrawer modelId={modelId} gid={selGid} reload={reload} onClose={() => { location.hash = `#/models/${modelId}/fm` }} />}
      <AlertToast modelId={modelId} fresh={fresh} dismiss={dismiss} />
    </main>
  )
}

const PAGE = 100
const CONTENT_W = 1100   // 기존 maxWidth
const PAD_X = 20   // 기존 좌우 padding
const OUTER_W = CONTENT_W + PAD_X * 2   // 1140 — border-box 렌더 폭
const PANEL_W = 440   // 객체 패널 폭(ObjectDrawer.tsx 와 동일)
/** margin:0 auto 와 같은 왼쪽 여백이지만 뷰포트(vw) 기준 — 패널 유무로 폭이 바뀌어도 값이 그대로라 좌측으로 튀지 않는다(U320) */
const LEFT_X = `max(0px, calc(50vw - ${OUTER_W / 2}px))`
