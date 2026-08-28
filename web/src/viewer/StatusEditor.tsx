import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Siren, WifiOff } from 'lucide-react'
import { post, type ElementDetail } from '../api'
import { STATUS_COLOR } from './SystemPanel'

/** 상태 PATCH 공용: 결과의 작업지시 정보를 사람 말로. 상태판(SystemPanel)과 속성 패널이 같이 쓴다 */
export const patchStatus = (modelId: string, gid: string, patch: Record<string, unknown>) =>
  post(`/models/${modelId}/elements/${encodeURIComponent(gid)}/status`, patch, 'PATCH').then(r => {
    const w = r.workOrder; if (!w) return undefined as string | undefined
    return w.suppressedBy ? `상위 장비 이상(${w.suppressedBy.name}) — 작업지시 억제` : w.reopened ? `10분 내 완료된 작업지시 다시 열림 (${w.assetTag})` : w.existing ? `열린 작업지시 있음 — 재사용 (${w.assetTag})` : `작업지시 자동 생성 (${w.assetTag})` })
export const statusPatchFor = (Status: string) => Status === 'ALARM' ? { Status, AlarmAt: new Date().toISOString().slice(0, 16) } : { Status }

const STATUS_LABEL: Record<string, string> = { NORMAL: '정상', ONLINE: '온라인', RUNNING: '운전', STANDBY: '대기', TRANSFERRED: '절체', ALARM: '경보', FAULT: '장애', OFFLINE: '오프라인' }
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12 }

/** 속성 패널 상단 "운영 상태": Status 버튼 + Pset_BimStatus 나머지 필드 인라인 편집(PATCH 는 jsonb 병합이라 키 하나씩 보내도 된다).
 *  Pset_BimStatus 가 없는 요소(배관·트레이 등)는 안 보인다 — 상태는 장비의 것. */
export default function StatusEditor({ modelId, e, reload }: { modelId: string; e: ElementDetail; reload: () => Promise<unknown> }) {
  const st = e.properties.Pset_BimStatus as Record<string, unknown> | undefined
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>()
  useEffect(() => setMsg(undefined), [e.globalId])
  if (!st) return null
  const cur = String(st.Status ?? '')
  const send = (patch: Record<string, unknown>) => { setBusy(true); setMsg(undefined); patchStatus(modelId, e.globalId, patch).then(m => { if (m) setMsg(m) }).then(reload).catch(x => setMsg(x.message)).finally(() => setBusy(false)) }
  const normal = ['ONLINE', 'RUNNING', 'STANDBY'].includes(cur) ? cur : 'NORMAL'   // 복구 시 그 장비의 "정상" 표현으로
  const fields = Object.entries(st).filter(([k]) => !['Status', 'UpdatedAt', 'AlarmAt'].includes(k))
  return (
    <div style={{ margin: '0 0 10px', padding: 8, background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <b>운영 상태</b>
        <span style={{ padding: '1px 8px', borderRadius: 999, color: '#fff', background: hex(STATUS_COLOR[cur] ?? 0x6b7280), fontWeight: 600 }}>{STATUS_LABEL[cur] ?? cur}</span>
        {typeof st.UpdatedAt === 'string' && <span style={{ color: '#999', fontSize: 11, marginLeft: 'auto' }}>{new Date(st.UpdatedAt).toLocaleString()}</span>}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {e.ifcClass === 'IfcSensor' && <button disabled={busy || cur === 'ALARM'} onClick={() => send(statusPatchFor('ALARM'))} style={{ ...btn, color: '#dc2626' }}><Siren size={12} /> 경보</button>}
        <button disabled={busy || cur === 'FAULT'} onClick={() => send(statusPatchFor('FAULT'))} style={{ ...btn, color: '#b45309' }}><AlertTriangle size={12} /> 장애</button>
        <button disabled={busy || cur === 'OFFLINE'} onClick={() => send(statusPatchFor('OFFLINE'))} style={{ ...btn, color: '#6b7280' }}><WifiOff size={12} /> 오프라인</button>
        <button disabled={busy || cur === normal} onClick={() => send(statusPatchFor(normal))} style={{ ...btn, color: '#16a34a' }}><CheckCircle2 size={12} /> {STATUS_LABEL[normal]} 복구</button>
      </div>
      {fields.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}><tbody>
        {fields.map(([k, v]) => <tr key={k} style={{ borderTop: '1px solid #eee' }}>
          <td style={{ color: '#666', padding: '3px 4px', whiteSpace: 'nowrap', width: '45%' }}>{k}</td>
          <td style={{ padding: '2px 4px' }}><Field k={k} v={v} busy={busy} onSave={val => send({ [k]: val })} /></td></tr>)}
      </tbody></table>}
      {msg && <div style={{ color: '#2563eb', marginTop: 6 }}>{msg}</div>}
    </div>
  )
}

/** 타입별 편집: boolean → 체크박스(즉시), number → 숫자(Enter/blur), 그 외 문자열(Enter/blur). 값이 같으면 안 보냄 */
function Field({ k, v, busy, onSave }: { k: string; v: unknown; busy: boolean; onSave: (val: unknown) => void }) {
  const [text, setText] = useState(String(v ?? '')); useEffect(() => setText(String(v ?? '')), [v])
  if (typeof v === 'boolean') return <input type="checkbox" checked={v} disabled={busy} onChange={ev => onSave(ev.target.checked)} aria-label={k} />
  const commit = () => { const val = typeof v === 'number' ? Number(text) : text; if (val === v || (typeof v === 'number' && Number.isNaN(val))) { setText(String(v)); return } onSave(val) }
  return <input value={text} type={typeof v === 'number' ? 'number' : 'text'} step="any" disabled={busy} onChange={ev => setText(ev.target.value)} onBlur={commit} onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setText(String(v ?? '')) }}
    style={{ width: '100%', boxSizing: 'border-box', padding: '2px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 12, background: '#fff' }} aria-label={k} />
}
