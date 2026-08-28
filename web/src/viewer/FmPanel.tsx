import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, ClipboardList, Plus, Tag, Wrench } from 'lucide-react'
import { api, post, type Asset, type AssetDetail, type ElementDetail, type ElementRow, type Viewpoint } from '../api'

/** 우측 "자산" 탭. 선택 요소 ↔ asset 연결, 점검·작업지시. 자산 목록은 모델 단위로 한 번 받아 globalId 로 찾는다. */
export default function FmPanel({ modelId, selection, byGid, detail, assets, reload, viewpoint }: {
  modelId: string; selection: string[]; byGid: Map<string, ElementRow>; detail?: ElementDetail
  assets: Asset[]; reload: () => void; viewpoint: () => Viewpoint
}) {
  const [err, setErr] = useState<string>()
  const run = (p: Promise<unknown>) => { setErr(undefined); return p.then(reload).catch(e => setErr(e.message)) }
  const byElement = new Map(assets.filter(a => a.globalId).map(a => [a.globalId!, a]))

  if (selection.length > 1) return <Bulk selection={selection} byGid={byGid} byElement={byElement} modelId={modelId} run={run} err={err} />
  const gid = selection[0]
  if (!gid || !byGid.has(gid)) return <p style={{ color: '#888' }}>요소를 선택하면 자산으로 등록하거나 점검·작업지시를 기록할 수 있습니다.</p>
  const asset = byElement.get(gid)
  return asset
    ? <AssetCard asset={asset} run={run} err={err} viewpoint={viewpoint} />
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
  useEffect(() => { api(`/models/${modelId}/assets`).then((as: Asset[]) => setTag(suggestTag(el, as.length + 1))) }, [gid])
  const attrs = snapshot(detail)
  return (
    <form onSubmit={e => { e.preventDefault(); run(post(`/models/${modelId}/assets`, { globalId: gid, tag, category, attributes: attrs })) }}>
      <div style={{ color: '#666', marginBottom: 8 }}>이 요소는 아직 자산이 아닙니다.</div>
      <Field label="자산 태그"><input value={tag} onChange={e => setTag(e.target.value)} required style={inp} /></Field>
      <Field label="분류"><input value={category} onChange={e => setCategory(e.target.value)} style={inp} /></Field>
      {Object.keys(attrs).length > 0 && <Field label="IFC 에서 가져올 속성">
        <div style={{ fontSize: 12, color: '#555' }}>{Object.entries(attrs).map(([k, v]) => <div key={k}>{k}: <b>{String(v)}</b></div>)}</div></Field>}
      <Err e={err} />
      <button type="submit" style={btnPrimary}><Tag size={13} /> 자산으로 등록</button>
    </form>
  )
}

function Bulk({ selection, byGid, byElement, modelId, run, err }: { selection: string[]; byGid: Map<string, ElementRow>; byElement: Map<string, Asset>; modelId: string; run: (p: Promise<unknown>) => Promise<void>; err?: string }) {
  const todo = selection.filter(g => byGid.has(g) && !byElement.has(g)), done = selection.length - todo.length
  const [prefix, setPrefix] = useState('AST'); const [category, setCategory] = useState('')
  const register = async () => {
    const start = ((await api(`/models/${modelId}/assets`)) as Asset[]).length + 1
    for (const [i, g] of todo.entries()) await post(`/models/${modelId}/assets`, { globalId: g, tag: `${prefix}-${String(start + i).padStart(3, '0')}`, category: category || byGid.get(g)!.ifcClass.replace('Ifc', ''), attributes: {} })
  }
  return (
    <div>
      <div style={{ color: '#666', marginBottom: 8 }}>{selection.length}개 선택 · 이미 자산 {done} · 미등록 {todo.length}</div>
      <Field label="태그 접두사"><input value={prefix} onChange={e => setPrefix(e.target.value)} style={inp} /></Field>
      <Field label="분류 (비우면 클래스명)"><input value={category} onChange={e => setCategory(e.target.value)} style={inp} /></Field>
      <Err e={err} />
      <button disabled={!todo.length} onClick={() => run(register())} style={btnPrimary}><Tag size={13} /> {todo.length}개 일괄 등록</button>
    </div>
  )
}

function AssetCard({ asset, run, err, viewpoint }: { asset: Asset; run: (p: Promise<unknown>) => Promise<void>; err?: string; viewpoint: () => Viewpoint }) {
  const [d, setD] = useState<AssetDetail>()
  const load = () => api(`/assets/${asset.id}`).then(setD)
  useEffect(() => { load() }, [asset.id, asset.lastInspectedOn, asset.openWorkOrders])
  const [note, setNote] = useState(''); const [wo, setWo] = useState({ title: '', assignee: '', dueOn: '' }); const [showWo, setShowWo] = useState(false)
  const inspect = (result: 'OK' | 'DEFECT') => run(post(`/assets/${asset.id}/inspections`, { result, note: note || null })).then(() => setNote(''))
  const createWo = () => run(post(`/assets/${asset.id}/work-orders`, { ...wo, dueOn: wo.dueOn || null, assignee: wo.assignee || null,
    inspectionId: d?.inspections.find(i => i.result === 'DEFECT')?.id ?? null, viewpoint: viewpoint() })).then(() => { setWo({ title: '', assignee: '', dueOn: '' }); setShowWo(false) })
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tag size={16} style={{ color: '#2563eb' }} /><b style={{ fontSize: 15 }}>{asset.tag}</b><span style={{ color: '#666' }}>{asset.category}</span>
        <select value={asset.status} onChange={e => run(post(`/assets/${asset.id}`, { status: e.target.value }, 'PATCH'))} style={{ marginLeft: 'auto', fontSize: 12 }}>
          <option value="ACTIVE">사용 중</option><option value="OUT_OF_SERVICE">고장/중지</option><option value="RETIRED">폐기</option></select>
      </div>
      {Object.keys(asset.attributes).length > 0 && <div style={{ fontSize: 12, color: '#555', margin: '6px 0' }}>{Object.entries(asset.attributes).map(([k, v]) => <span key={k} style={{ marginRight: 8 }}>{k} <b>{String(v)}</b></span>)}</div>}
      <Err e={err} />

      <h4 style={h4}><ClipboardList size={13} /> 점검 {d && <span style={{ color: '#999', fontWeight: 400 }}>{d.inspections.length}</span>}</h4>
      <div style={{ display: 'flex', gap: 4 }}>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="메모 (선택)" style={{ ...inp, flex: 1 }} />
        <button onClick={() => inspect('OK')} style={btn} title="이상 없음"><CheckCircle2 size={13} color="#15803d" /> OK</button>
        <button onClick={() => inspect('DEFECT')} style={btn} title="결함"><AlertCircle size={13} color="#b91c1c" /> 결함</button>
      </div>
      {d?.inspections.slice(0, 5).map(i => <div key={i.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '3px 0', borderTop: '1px solid #eee' }}>
        <span style={{ color: '#888', width: 76 }}>{day(i.inspectedOn)}</span><b style={{ color: i.result === 'OK' ? '#15803d' : '#b91c1c', width: 48 }}>{i.result}</b><span style={{ color: '#555' }}>{i.note}</span></div>)}

      <h4 style={h4}><Wrench size={13} /> 작업지시 {d && <span style={{ color: '#999', fontWeight: 400 }}>{d.workOrders.length}</span>}
        <button onClick={() => setShowWo(!showWo)} style={{ ...btn, marginLeft: 'auto' }}><Plus size={12} /> 새 작업지시</button></h4>
      {showWo && <div style={{ background: '#f7f7f7', padding: 8, borderRadius: 6, marginBottom: 6 }}>
        <input value={wo.title} onChange={e => setWo({ ...wo, title: e.target.value })} placeholder="제목 *" style={{ ...inp, marginBottom: 4 }} />
        <div style={{ display: 'flex', gap: 4 }}>
          <input value={wo.assignee} onChange={e => setWo({ ...wo, assignee: e.target.value })} placeholder="담당" style={{ ...inp, flex: 1 }} />
          <input type="date" value={wo.dueOn} onChange={e => setWo({ ...wo, dueOn: e.target.value })} style={inp} />
        </div>
        <div style={{ color: '#888', fontSize: 11, margin: '4px 0' }}>현재 카메라·선택·단면이 뷰포인트로 저장됩니다{d?.inspections[0]?.result === 'DEFECT' && ' · 최근 결함 점검에 연결'}</div>
        <button disabled={!wo.title} onClick={createWo} style={btnPrimary}>생성</button>
      </div>}
      {d?.workOrders.map(w => <div key={w.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderTop: '1px solid #eee' }}>
        <StatusBadge s={w.status} /><span style={{ flex: 1 }}>{w.title}</span><span style={{ color: '#888' }}>{w.assignee}</span><span style={{ color: '#888' }}>{day(w.dueOn)}</span>
        <select value={w.status} onChange={e => run(post(`/work-orders/${w.id}`, { status: e.target.value }, 'PATCH')).then(load)} style={{ fontSize: 11 }}>
          <option value="OPEN">OPEN</option><option value="IN_PROGRESS">진행</option><option value="DONE">완료</option></select></div>)}
    </div>
  )
}

/** API 의 date 는 ISO 타임스탬프 문자열로 온다 → YYYY-MM-DD */
export const day = (s?: string | null) => s ? s.slice(0, 10) : ''

export function StatusBadge({ s }: { s: 'OPEN' | 'IN_PROGRESS' | 'DONE' }) {
  const c = { OPEN: ['#b91c1c', '#fee2e2'], IN_PROGRESS: ['#1d4ed8', '#dbe4ff'], DONE: ['#15803d', '#dcfce7'] }[s]
  return <span style={{ padding: '1px 7px', borderRadius: 999, background: c[1], color: c[0], fontSize: 11, whiteSpace: 'nowrap' }}>{{ OPEN: '대기', IN_PROGRESS: '진행', DONE: '완료' }[s]}</span>
}
const Field = ({ label, children }: { label: string; children: React.ReactNode }) => <label style={{ display: 'block', marginBottom: 8 }}><div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>{label}</div>{children}</label>
const Err = ({ e }: { e?: string }) => e ? <p style={{ color: '#b91c1c', fontSize: 12 }}>{e}</p> : null
const inp = { width: '100%', boxSizing: 'border-box' as const, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }
const btnPrimary = { ...btn, background: '#2563eb', color: '#fff', border: 0 }
const h4 = { display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 6px', fontSize: 13 }
