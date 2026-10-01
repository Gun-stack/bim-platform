/* oxlint-disable react/only-export-components -- isEquipment(U336): 서버 FmService.bulk 와 같은 제외 규칙, 순수 함수 */
import { useEffect, useState } from 'react'
import { api, post, type Asset, type AssetDetail, type ElementDetail, type ElementRow, type Viewpoint } from '../api'
import { WO_STATUS, type WoStatus } from '../status'
import { btn, btnPrimary, day, inp as inpBase } from '../ui'
import { tier } from './xray'
import { T } from '../theme'

/** U336: 자산 일괄 등록(FmService.bulk)과 같은 제외 규칙 — 구조체(STRUCT)·배관(API Sql.SEGMENT_CLASSES, "선"과 그 이음)은
 *  장비가 아니다. 공간(IfcSpace)은 여기까지 오기 전에 이미 걸러진다(selection 이 byGid=/elements 에 있어야 FmPanel 이 뜬다) */
const SEGMENT_CLASSES = ['IfcPipeSegment', 'IfcCableCarrierSegment', 'IfcCableSegment', 'IfcDuctSegment', 'IfcFlowSegment', 'IfcPipeFitting', 'IfcDuctFitting', 'IfcCableCarrierFitting', 'IfcCableFitting', 'IfcFlowFitting']
const SEGMENTS = new Set<string>(SEGMENT_CLASSES)
/** 건축 요소(X-ray 의 수평·수직 층위 — 벽·슬래브·계단·경사로·난간·창·문·기둥·보…)와 배관 선·이음은 장비가 아니다 */
export const isEquipment = (ifcClass: string) => tier(ifcClass) === 'equipment' && !SEGMENTS.has(ifcClass)

/** 우측 "자산" 탭. 선택 요소 ↔ asset 연결, 점검·작업지시. 자산 목록은 모델 단위로 한 번 받아 globalId 로 찾는다.
 *  assetDetail(점검·작업지시 목록)은 Viewer 가 한 곳에서 받아 내려준다 — 전엔 Viewer(요약 카드용)와 여기(AssetCard) 둘 다 GET /assets/{id} 를 불렀다 */
export default function FmPanel({ modelId, selection, byGid, detail, assets, assetDetail, reload, viewpoint }: {
  modelId: string; selection: string[]; byGid: Map<string, ElementRow>; detail?: ElementDetail
  assets: Asset[]; assetDetail?: AssetDetail; reload: () => void; viewpoint: () => Promise<Viewpoint>
}) {
  const [err, setErr] = useState<string>()
  const run = (p: Promise<unknown>) => { setErr(undefined); return p.then(reload).catch(e => setErr(e.message)) }
  const byElement = new Map(assets.filter(a => a.globalId).map(a => [a.globalId!, a]))

  if (selection.length > 1) return <Bulk selection={selection} byGid={byGid} byElement={byElement} modelId={modelId} run={run} err={err} />
  const gid = selection[0]
  if (!gid || !byGid.has(gid)) return <p style={{ color: T.ink[2] }}>요소를 선택하면 자산 등록·점검·작업지시를 기록할 수 있습니다.</p>
  const asset = byElement.get(gid)
  return asset
    ? <AssetCard modelId={modelId} asset={asset} d={asset.id === assetDetail?.id ? assetDetail : undefined} run={run} err={err} viewpoint={viewpoint} />
    : <Register gid={gid} el={byGid.get(gid)!} detail={detail} modelId={modelId} run={run} err={err} />
}

/** Pset 에서 자산 속성으로 가져갈 만한 값: 표준 Pset_*Common 의 스칼라 전부 + 층 */
function snapshot(detail?: ElementDetail) {
  const out: Record<string, unknown> = {}
  if (!detail) return out
  for (const [ps, props] of Object.entries(detail.properties)) if (/^Pset_\w+Common$/.test(ps)) for (const [k, v] of Object.entries(props)) if (v != null && typeof v !== 'object') out[k] = v
  if (detail.spatialName) out.storey = detail.spatialName
  return out
}
const suggestTag = (el: ElementRow, n: number) => `${el.ifcClass.replace('Ifc', '').replace(/StandardCase|Element/, '').toUpperCase().slice(0, 6)}-${String(n).padStart(3, '0')}`

function Register({ gid, el, detail, modelId, run, err }: { gid: string; el: ElementRow; detail?: ElementDetail; modelId: string; run: (p: Promise<unknown>) => Promise<void>; err?: string }) {
  const [tag, setTag] = useState(''); const [category, setCategory] = useState(el.ifcClass.replace('Ifc', ''))
  useEffect(() => { api<Asset[]>(`/models/${modelId}/assets`).then(as => setTag(suggestTag(el, as.length + 1))) }, [gid, modelId, el])
  if (!isEquipment(el.ifcClass)) return <p style={{ color: T.ink[2] }}>장비가 아닌 요소입니다.</p>   // U336: 벽·슬래브·배관엔 자산 등록 폼을 주 동작으로 내밀지 않는다
  const attrs = snapshot(detail)
  return (
    <form onSubmit={e => { e.preventDefault(); run(post(`/models/${modelId}/assets`, { globalId: gid, tag, category, attributes: attrs })) }}>
      <div style={{ color: T.ink[2], marginBottom: 8 }}>아직 자산으로 등록되지 않은 요소입니다.</div>
      <Field label="자산 태그"><input value={tag} onChange={e => setTag(e.target.value)} required style={inp} /></Field>
      <Field label="분류"><input value={category} onChange={e => setCategory(e.target.value)} style={inp} /></Field>
      {Object.keys(attrs).length > 0 && <Field label="IFC 속성 가져오기">
        <div style={{ fontSize: 12, color: T.ink[2] }}>{Object.entries(attrs).map(([k, v]) => <div key={k}>{k}: <b>{String(v)}</b></div>)}</div></Field>}
      <Err e={err} />
      <button type="submit" style={btnPrimary}>자산으로 등록</button>
    </form>
  )
}

function Bulk({ selection, byGid, byElement, modelId, run, err }: { selection: string[]; byGid: Map<string, ElementRow>; byElement: Map<string, Asset>; modelId: string; run: (p: Promise<unknown>) => Promise<void>; err?: string }) {
  const todo = selection.filter(g => byGid.has(g) && !byElement.has(g)), done = selection.length - todo.length
  const [prefix, setPrefix] = useState('AST'); const [category, setCategory] = useState('')
  const register = async () => {
    const start = (await api<Asset[]>(`/models/${modelId}/assets`)).length + 1
    for (const [i, g] of todo.entries()) await post(`/models/${modelId}/assets`, { globalId: g, tag: `${prefix}-${String(start + i).padStart(3, '0')}`, category: category || byGid.get(g)!.ifcClass.replace('Ifc', ''), attributes: {} })
  }
  return (
    <div>
      <div style={{ color: T.ink[2], marginBottom: 8 }}>{selection.length}개 선택 · 이미 자산 {done} · 미등록 {todo.length}</div>
      <Field label="태그 접두사"><input value={prefix} onChange={e => setPrefix(e.target.value)} style={inp} /></Field>
      <Field label="분류 (비우면 종류명)"><input value={category} onChange={e => setCategory(e.target.value)} style={inp} /></Field>
      <Err e={err} />
      <button disabled={!todo.length} onClick={() => run(register())} style={btnPrimary}>{todo.length}개 일괄 등록</button>
    </div>
  )
}

function AssetCard({ modelId, asset, d, run, err, viewpoint }: { modelId: string; asset: Asset; d?: AssetDetail; run: (p: Promise<unknown>) => Promise<void>; err?: string; viewpoint: () => Promise<Viewpoint> }) {
  const [note, setNote] = useState(''); const [wo, setWo] = useState({ title: '', assignee: '', dueOn: '' }); const [showWo, setShowWo] = useState(false)
  const inspect = (result: 'OK' | 'DEFECT') => run(post(`/assets/${asset.id}/inspections`, { result, note: note || null })).then(() => setNote(''))
  const createWo = () => viewpoint().then(vp => run(post(`/assets/${asset.id}/work-orders`, { ...wo, dueOn: wo.dueOn || null, assignee: wo.assignee || null,
    inspectionId: d?.inspections.find(i => i.result === 'DEFECT')?.id ?? null, viewpoint: vp })).then(() => { setWo({ title: '', assignee: '', dueOn: '' }); setShowWo(false) }))
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 15 }}>{asset.tag}</b><span style={{ color: T.ink[2] }}>{asset.category}</span>
        <select value={asset.status} onChange={e => run(post(`/assets/${asset.id}`, { status: e.target.value }, 'PATCH'))} style={{ marginLeft: 'auto', fontSize: 12 }}>
          <option value="ACTIVE">사용 중</option><option value="OUT_OF_SERVICE">사용 중지</option><option value="RETIRED">폐기</option></select>
      </div>
      {Object.keys(asset.attributes).length > 0 && <div style={{ fontSize: 12, color: T.ink[2], margin: '6px 0' }}>{Object.entries(asset.attributes).map(([k, v]) => <span key={k} style={{ marginRight: 8 }}>{k} <b>{String(v)}</b></span>)}</div>}
      <Err e={err} />

      <h4 style={h4}>점검 {d && <span style={{ color: T.ink[2], fontWeight: 400 }}>{d.inspections.length}</span>}</h4>
      <div style={{ display: 'flex', gap: 4 }}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="메모 (선택)" style={{ ...inp, flex: 1 }} />
        <button onClick={() => inspect('OK')} style={{ ...btn, color: T.ok }} title="이상 없음">정상</button>
        <button onClick={() => inspect('DEFECT')} style={{ ...btn, color: T.crit }} title="결함">결함</button>
      </div>
      {d?.inspections.slice(0, 5).map(i => <div key={i.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderTop: `1px solid ${T.bg.line}` }}>
        <span style={{ color: T.ink[2], width: 76 }}>{day(i.inspectedOn)}</span><b style={{ color: i.result === 'OK' ? T.ok : T.crit, width: 48 }}>{i.result === 'OK' ? '정상' : '결함'}</b><span style={{ color: T.ink[2] }}>{i.note}</span></div>)}

      <h4 style={h4}>작업지시 {d && <span style={{ color: T.ink[2], fontWeight: 400 }}>{d.workOrders.length}</span>}
        <button onClick={() => setShowWo(!showWo)} style={{ ...btn, marginLeft: 'auto' }}>새 작업지시</button></h4>
      {showWo && <div style={{ background: T.bg.raised, padding: 8, borderRadius: 6, marginBottom: 6 }}>
        <input value={wo.title} onChange={e => setWo({ ...wo, title: e.target.value })} placeholder="제목 *" style={{ ...inp, marginBottom: 4 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <input value={wo.assignee} onChange={e => setWo({ ...wo, assignee: e.target.value })} placeholder="담당자" style={{ ...inp, flex: 1 }} />
          <input type="date" value={wo.dueOn} onChange={e => setWo({ ...wo, dueOn: e.target.value })} style={inp} />
        </div>
        <div style={{ color: T.ink[2], fontSize: 11, margin: '4px 0' }}>요소에 맞춘 카메라·선택·단면이 뷰포인트로 저장됩니다{d?.inspections[0]?.result === 'DEFECT' && ' · 최근 결함 점검에 연결'}</div>
        <button disabled={!wo.title} onClick={createWo} style={btnPrimary}>생성</button>
      </div>}
      {d?.workOrders.map(w => <div key={w.id} style={{ fontSize: 12, padding: '5px 0', borderTop: `1px solid ${T.bg.line}` }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><StatusBadge s={w.status} />
          <a href={`#/models/${modelId}/fm?wo=${w.id}`} title="작업지시 보드에서 이 카드 열기" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.ink[1], textDecoration: 'none' }}>{w.title}</a></div>
        <div style={{ color: T.ink[2], fontSize: 11, marginTop: 2, paddingLeft: 2 }}>{w.assignee ? `담당 ${w.assignee}` : <span style={{ color: T.warn }}>미배정</span>}{w.dueOn ? ` · 기한 ${day(w.dueOn)}` : ''}{w.priority && w.priority !== 'NORMAL' ? ` · ${({ URGENT: '긴급', HIGH: '높음', LOW: '낮음' } as Record<string, string>)[w.priority] ?? w.priority}` : ''}</div></div>)}
    </div>
  )
}

export function StatusBadge({ s }: { s: WoStatus }) {
  // 대기(OPEN)는 중립 — 빨강은 경보·기한 초과의 몫 (급함은 우선순위 아이콘이 말한다)
  const c = { OPEN: [T.ink[1], T.bg.line], IN_PROGRESS: [T.accent, T.accentSoft], DONE: [T.ok, T.okSoft] }[s]
  return <span style={{ padding: '1px 7px', borderRadius: 999, background: c[1], color: c[0], fontSize: 11, whiteSpace: 'nowrap' }}>{WO_STATUS[s]}</span>
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label style={{ display: 'block', marginBottom: 8 }}><div style={{ fontSize: 11, color: T.ink[2], marginBottom: 2 }}>{label}</div>{children}</label>
const Err = ({ e }: { e?: string }) => e ? <p style={{ color: T.crit, fontSize: 12 }}>{e}</p> : null
const inp = { ...inpBase, width: '100%', boxSizing: 'border-box' as const }
const h4 = { display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 6px', fontSize: 13 }
