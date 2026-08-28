import { useEffect, useState } from 'react'
import { ArrowLeft, Box, ClipboardList, ExternalLink, Plus, Tag, Wrench } from 'lucide-react'
import { api, post, type Asset, type Model, type WorkOrder } from './api'
import { day } from './viewer/FmPanel'
import FmBoard from './FmBoard'

/** #/models/{id}/fm — 자산 대장 + 작업지시 보드. 작업지시 → 뷰어 뷰포인트로 이동 */
export default function FmPage({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<Model>()
  const [assets, setAssets] = useState<Asset[]>([])
  const [wos, setWos] = useState<WorkOrder[]>([])
  const [tab, setTab] = useState<'board' | 'assets'>('board')
  const [add, setAdd] = useState<{ tag: string; category: string } | null>(null)   // 모델에 없는 자산 추가 폼
  const [err, setErr] = useState<string>()
  const reload = () => Promise.all([api(`/models/${modelId}/assets`), api(`/models/${modelId}/work-orders`)]).then(([a, w]) => { setAssets(a); setWos(w) })
  useEffect(() => { api(`/models/${modelId}`).then(setModel); reload() }, [modelId])


  return (
    <main style={{ fontFamily: 'system-ui', fontSize: 13, maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <a href="#/" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> 모델 목록</a>
        <h1 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}><Box size={18} /> {model?.name ?? '…'} <span style={{ color: '#888', fontWeight: 400 }}>시설관리</span></h1>
        <a href={`#/models/${modelId}/monitor`} style={{ marginLeft: 'auto', ...btn }}>모니터링</a><a href={`#/models/${modelId}`} style={btn}><ExternalLink size={13} /> 3D 뷰어</a>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <Stat icon={Tag} label="자산" value={assets.length} sub={`결함 ${assets.filter(a => a.lastResult === 'DEFECT').length}`} />
        <Stat icon={ClipboardList} label="점검됨" value={assets.filter(a => a.lastInspectedOn).length} sub={`미점검 ${assets.filter(a => !a.lastInspectedOn).length}`} />
        <Stat icon={Wrench} label="열린 작업지시" value={wos.filter(w => w.status !== 'DONE').length} sub={`완료 ${wos.filter(w => w.status === 'DONE').length}`} />
      </div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e5e5', marginBottom: 14 }}>
        {(['board', 'assets'] as const).map(t => <button key={t} onClick={() => setTab(t)}
          style={{ padding: '6px 14px', border: 0, background: 'transparent', cursor: 'pointer', fontSize: 13, color: tab === t ? '#2563eb' : '#666', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}>
          {t === 'board' ? '작업지시 보드' : '자산 대장'}</button>)}
      </div>

      {tab === 'board' && <FmBoard modelId={modelId} wos={wos} assets={assets} reload={reload} />}

      {tab === 'assets' && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#888', fontSize: 12 }}>모델 요소는 뷰어에서 등록. 준공 후 설치한 장비(CCTV·소화기 등)는 여기서 요소 없이 추가.</span>
          <button onClick={() => setAdd(add ? null : { tag: '', category: '' })} style={{ ...btn, marginLeft: 'auto' }}><Plus size={12} /> 자산 추가</button>
        </div>
        {add && <form onSubmit={e => { e.preventDefault(); setErr(undefined); post(`/models/${modelId}/assets`, add).then(() => { setAdd(null); reload() }).catch(e => setErr(e.message)) }}
                      style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 10, background: '#f5f5f5', borderRadius: 8, marginBottom: 8 }}>
          <input value={add.tag} onChange={e => setAdd({ ...add, tag: e.target.value })} placeholder="태그 * (예: CCTV-01)" required style={inp} />
          <input value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })} placeholder="분류" style={inp} />
          <button type="submit" style={{ ...btn, background: '#2563eb', color: '#fff', border: 0 }}>등록</button>
          {err && <span style={{ color: '#b91c1c', fontSize: 12 }}>{err}</span>}
        </form>}
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 110px 1fr 90px 110px 90px 80px', gap: 8, padding: '8px 14px', background: '#f5f5f5', color: '#666', fontSize: 12 }}>
          <span>태그</span><span>분류</span><span>연결 요소</span><span>상태</span><span>최근 점검</span><span>작업지시</span><span /></div>
        {assets.map(a => <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '120px 110px 1fr 90px 110px 90px 80px', gap: 8, alignItems: 'center', padding: '8px 14px', borderTop: '1px solid #eee' }}>
          <b>{a.tag}</b><span>{a.category}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: a.globalId ? '#222' : '#999' }} title={a.elementName ?? ''}>{a.globalId ? `${a.ifcClass?.replace('Ifc', '')} · ${a.elementName}` : '(모델에 없음)'}</span>
          <span style={{ fontSize: 12, color: a.status === 'ACTIVE' ? '#15803d' : '#b91c1c' }}>{{ ACTIVE: '사용 중', OUT_OF_SERVICE: '중지', RETIRED: '폐기' }[a.status]}</span>
          <span style={{ fontSize: 12, color: a.lastResult === 'DEFECT' ? '#b91c1c' : '#666' }}>{a.lastInspectedOn ? `${day(a.lastInspectedOn)} ${a.lastResult}` : '—'}</span>
          <span style={{ fontSize: 12 }}>{a.openWorkOrders ? `열림 ${a.openWorkOrders}` : '—'}</span>
          <span style={{ textAlign: 'right' }}>{a.globalId && <a href={`#/models/${modelId}?sel=${encodeURIComponent(a.globalId)}&fm=1`} style={btn}><ExternalLink size={12} /> 3D</a>}</span>
        </div>)}
        {!assets.length && <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>자산이 없습니다. 뷰어에서 요소를 선택해 "자산 · FM" 탭에서 등록하세요.</div>}
        </div>
      </>}
    </main>
  )
}

const Stat = ({ icon: Icon, label, value, sub }: { icon: typeof Tag; label: string; value: number; sub: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid #e5e5e5', borderRadius: 10, minWidth: 160 }}>
    <Icon size={18} style={{ color: '#2563eb' }} /><div><div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div><div style={{ fontSize: 12, color: '#888' }}>{label} · {sub}</div></div></div>)
const inp = { padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#222', textDecoration: 'none' }
