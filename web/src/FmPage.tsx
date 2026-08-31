import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Box, ClipboardList, ExternalLink, Plus, Tag, Wrench } from 'lucide-react'
import { Section } from './Section'
import { useSections } from './useSections'
import { api, post, type Asset, type Model, type WorkOrder } from './api'
import { day } from './viewer/FmPanel'
import { ifcKo } from './ifcNames'
import FmBoard from './FmBoard'
import { useHashQuery } from './useHashQuery'
import { AlertToast, useAlerts } from './useAlerts'

/** #/models/{id}/fm — 자산 대장 + 작업지시 보드. 작업지시 → 뷰어 뷰포인트로 이동 */
export default function FmPage({ modelId }: { modelId: string }) {
  const [model, setModel] = useState<Model>()
  const [assets, setAssets] = useState<Asset[]>([])
  const [wos, setWos] = useState<WorkOrder[]>([])
  const [open, toggle] = useSections('fm.sections', { board: true, assets: false })
  const [add, setAdd] = useState<{ tag: string; category: string } | null>(null)   // 모델에 없는 자산 추가 폼
  const [err, setErr] = useState<string>()
  const [syncMsg, setSyncMsg] = useState<string>()
  const [aq, setAq] = useState(''); const [acat, setAcat] = useState(''); const [ast, setAst] = useState('')   // 자산 대장 필터
  const reload = useCallback(() => Promise.all([api(`/models/${modelId}/assets`), api(`/models/${modelId}/work-orders`)]).then(([a, w]) => { setAssets(a); setWos(w) }), [modelId])
  const { abnormal, fresh, dismiss } = useAlerts(modelId)   // 5초 폴링 — 이상 배너 + 전역 경보 토스트
  useEffect(() => { api(`/models/${modelId}`).then(setModel); reload() }, [modelId, reload])

  // 딥링크: ?wo={id} → 보드 펼침 + 카드 하이라이트/Drawer, ?sel={gid} → 열린 WO 있으면 그 카드, 없으면 자산 대장 필터
  const hq = useHashQuery(), selGid = hq.get('sel')
  const woId = hq.get('wo') ?? (selGid ? wos.find(w => w.globalId === selGid && w.status !== 'DONE')?.id : undefined)
  const selAsset = !woId && selGid ? assets.find(a => a.globalId === selGid) : undefined
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selAsset) setAq(selAsset.tag) }, [selAsset?.id])
  const filteredAssets = assets.filter(a => (!acat || a.category === acat) && (!ast || a.storey === ast) && (!aq || [a.tag, a.elementName].some(x => x?.toLowerCase().includes(aq.toLowerCase()))))


  return (
    <main style={{ fontFamily: 'system-ui', fontSize: 13, maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <a href="#/" style={{ color: '#2563eb', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={14} /> 모델 목록</a>
        <h1 style={{ margin: 0, fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}><Box size={18} /> {model?.name ?? '…'} <span style={{ color: '#888', fontWeight: 400 }}>시설관리</span></h1>
        <a href={`#/models/${modelId}/monitor`} style={{ marginLeft: 'auto', ...btn }}>모니터링{abnormal.length > 0 && <b style={{ color: '#dc2626' }}>{abnormal.length}</b>}</a><a href={`#/models/${modelId}`} style={btn}><ExternalLink size={13} /> 3D 뷰어</a>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 14 }}>
        <Stat icon={Tag} label="자산" value={assets.length} sub={`결함 ${assets.filter(a => a.lastResult === 'DEFECT').length}`} />
        <Stat icon={ClipboardList} label="점검 완료" value={assets.filter(a => a.lastInspectedOn).length} sub={`미점검 ${assets.filter(a => !a.lastInspectedOn).length}`} />
        <Stat icon={Wrench} label="열린 작업지시" value={wos.filter(w => w.status !== 'DONE').length} sub={`완료 ${wos.filter(w => w.status === 'DONE').length}`} />
      </div>
      <Section title="작업지시 보드" icon={Wrench} count={`열림 ${wos.filter(w => w.status !== 'DONE').length} · 완료 ${wos.filter(w => w.status === 'DONE').length}`} open={open.board || !!woId} onToggle={() => toggle('board')}>
      {abnormal.length > wos.filter(w => w.status !== 'DONE').length && <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', marginBottom: 10, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8 }}>
        <span style={{ color: '#9a3412' }}>상태판 이상 <b>{abnormal.length}</b>건 ({abnormal.slice(0, 3).map(r => r.name).join(', ')}{abnormal.length > 3 ? ' …' : ''}) — 열린 작업지시 {wos.filter(w => w.status !== 'DONE').length}건</span>
        <button onClick={() => { setSyncMsg(undefined); post(`/models/${modelId}/status/sync`, {}).then(r => { setSyncMsg(`생성 ${r.created} · 상위 억제 ${r.suppressed} · 검사 ${r.checked}`); reload() }).catch(e => setSyncMsg(e.message)) }} style={{ ...btn, marginLeft: 'auto', background: '#ea580c', color: '#fff', border: 0 }}>작업지시 동기화</button>
        {syncMsg && <span style={{ fontSize: 12, color: '#666' }}>{syncMsg}</span>}</div>}
      <FmBoard modelId={modelId} wos={wos} assets={assets} reload={reload} openWoId={woId} />
      </Section>

      <Section title="자산 대장" icon={Tag} count={`${assets.length}개 · 결함 ${assets.filter(a => a.lastResult === 'DEFECT').length} · 미점검 ${assets.filter(a => !a.lastInspectedOn).length}`} open={open.assets || !!selAsset} onToggle={() => toggle('assets')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ color: '#888', fontSize: 12 }}>3D 요소는 뷰어에서 자산으로 등록하고, 모델에 없는 장비(추가 설치분)는 여기서 태그만으로 추가합니다.</span>
          <button onClick={() => setAdd(add ? null : { tag: '', category: '' })} style={{ ...btn, marginLeft: 'auto' }}><Plus size={12} /> 자산 추가</button>
        </div>
        {add && <form onSubmit={e => { e.preventDefault(); setErr(undefined); post(`/models/${modelId}/assets`, add).then(() => { setAdd(null); reload() }).catch(e => setErr(e.message)) }}
                      style={{ display: 'flex', gap: 6, alignItems: 'center', padding: 10, background: '#f5f5f5', borderRadius: 8, marginBottom: 8 }}>
          <input value={add.tag} onChange={e => setAdd({ ...add, tag: e.target.value })} placeholder="태그 * (예: CCTV-01)" required style={inp} />
          <input value={add.category} onChange={e => setAdd({ ...add, category: e.target.value })} placeholder="분류" style={inp} />
          <button type="submit" style={{ ...btn, background: '#2563eb', color: '#fff', border: 0 }}>등록</button>
          {err && <span style={{ color: '#b91c1c', fontSize: 12 }}>{err}</span>}
        </form>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
          <input value={aq} onChange={e => setAq(e.target.value)} placeholder="태그 · 이름 검색" style={{ ...inp, width: 200 }} />
          <select value={acat} onChange={e => setAcat(e.target.value)} style={inp}><option value="">분류 전체</option>{[...new Set(assets.map(a => a.category).filter(Boolean) as string[])].sort((x, y) => ifcKo(x).localeCompare(ifcKo(y))).map(c => <option key={c} value={c}>{ifcKo(c)}</option>)}</select>
          <select value={ast} onChange={e => setAst(e.target.value)} style={inp}><option value="">층 전체</option>{[...new Set(assets.map(a => a.storey).filter(Boolean) as string[])].map(s => <option key={s}>{s}</option>)}</select>
          <span style={{ color: '#888', fontSize: 12 }}>{filteredAssets.length} / {assets.length}</span>
        </div>
        <div style={{ border: '1px solid #e5e5e5', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 130px 70px 1fr 80px 110px 80px 130px', gap: 8, padding: '8px 14px', background: '#f5f5f5', color: '#666', fontSize: 12 }}>
          <span>태그</span><span>분류</span><span>층</span><span>연결 요소</span><span>상태</span><span>최근 점검</span><span>작업지시</span><span /></div>
        {filteredAssets.map(a => <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '120px 130px 70px 1fr 80px 110px 80px 130px', gap: 8, alignItems: 'center', padding: '8px 14px', borderTop: '1px solid #eee' }}>
          <b>{a.tag}</b><span title={a.category ?? ''}>{ifcKo(a.category)}</span><span style={{ color: '#666' }}>{a.storey ?? '—'}{a.zone ? <span style={{ color: '#aaa' }}> {a.zone.split('-').pop()}</span> : ''}</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: a.globalId ? '#222' : '#999' }} title={a.elementName ?? ''}>{a.globalId ? a.elementName : '(모델에 없음)'}</span>
          <span style={{ fontSize: 12, color: a.status === 'ACTIVE' ? '#15803d' : '#b91c1c' }}>{{ ACTIVE: '사용 중', OUT_OF_SERVICE: '중지', RETIRED: '폐기' }[a.status]}</span>
          <span style={{ fontSize: 12, color: a.lastResult === 'DEFECT' ? '#b91c1c' : '#666' }}>{a.lastInspectedOn ? `${day(a.lastInspectedOn)} ${a.lastResult}` : '—'}</span>
          <span style={{ fontSize: 12 }}>{a.openWorkOrders ? `열림 ${a.openWorkOrders}` : '—'}</span>
          <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{a.globalId && <><a href={`#/models/${modelId}/monitor?sel=${encodeURIComponent(a.globalId)}`} title="모니터링에서 현재 계측값" style={btn}>모니터링</a> <a href={`#/models/${modelId}?sel=${encodeURIComponent(a.globalId)}&fm=1`} style={btn}><ExternalLink size={12} /> 3D</a></>}</span>
        </div>)}
        {!assets.length && <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>등록된 자산이 없습니다. 뷰어에서 요소를 골라 등록하거나, 모니터링의 "자산 일괄 등록"으로 한 번에 등록하세요.</div>}
        {assets.length > 0 && !filteredAssets.length && <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>조건에 맞는 자산이 없습니다.</div>}
        </div>
      </Section>
      <AlertToast modelId={modelId} fresh={fresh} dismiss={dismiss} />
    </main>
  )
}

const Stat = ({ icon: Icon, label, value, sub }: { icon: typeof Tag; label: string; value: number; sub: string }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: '1px solid #e5e5e5', borderRadius: 10, minWidth: 160 }}>
    <Icon size={18} style={{ color: '#2563eb' }} /><div><div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div><div style={{ fontSize: 12, color: '#888' }}>{label} · {sub}</div></div></div>)
const inp = { padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 }
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#222', textDecoration: 'none' }
