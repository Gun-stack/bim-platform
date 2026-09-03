import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import TrendModal from '../TrendModal'
import type { ElementDetail } from '../api'
import { patchStatus, statusPatchFor } from '../statusApi'
import { isQuiet, statusHex, statusLabel } from '../status'
import { READINGS, readings, LEVEL_COLOR } from '../readings'
import { badge, btn } from '../ui'
import { T } from '../theme'

/** 속성 패널 상단 "운영 상태": Status 버튼 + Pset_BimStatus 나머지 필드 인라인 편집(PATCH 는 jsonb 병합이라 키 하나씩 보내도 된다).
 *  Pset_BimStatus 가 없는 요소(배관·트레이 등)는 안 보인다 — 상태는 장비의 것. */
export default function StatusEditor({ modelId, e, reload }: { modelId: string; e: ElementDetail; reload: () => Promise<unknown> }) {
  const st = e.properties.Pset_BimStatus as Record<string, unknown> | undefined
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string>()   // 요소가 바뀌면 부모가 key 로 리마운트
  const [trend, setTrend] = useState(false)
  if (!st) return null
  const cur = String(st.Status ?? '')
  const send = (patch: Record<string, unknown>) => { setBusy(true); setMsg(undefined); patchStatus(modelId, e.globalId, patch).then(m => { if (m) setMsg(m) }).then(reload).catch(x => setMsg(x.message)).finally(() => setBusy(false)) }
  const normal = ['ONLINE', 'RUNNING', 'STANDBY'].includes(cur) ? cur : 'NORMAL'   // 복구 시 그 장비의 "정상" 표현으로
  const fields = Object.entries(st).filter(([k]) => !['Status', 'UpdatedAt', 'AlarmAt'].includes(k))
  return (
    <div style={{ margin: '0 0 10px', padding: 8, background: T.bg.raised, border: `1px solid ${T.bg.line}`, borderRadius: T.radius, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <b>운영 상태</b>
        {isQuiet(cur) ? <span style={{ color: T.ink[2] }}>{statusLabel(cur)}</span> : <span style={badge(statusHex(cur))}>{statusLabel(cur)}</span>}
        {Object.entries(st).some(([k, v]) => typeof v === 'number' && k !== 'UpdatedAt') && <button onClick={() => setTrend(true)} title="계측 트렌드 — 값이 언제부터 이랬는지" style={{ border: 0, background: 'none', cursor: 'pointer', color: T.accent, padding: 2, display: 'inline-flex' }}><TrendingUp size={13} /></button>}
        {typeof st.UpdatedAt === 'string' && <span style={{ color: T.ink[2], fontSize: 11, marginLeft: 'auto' }}>{new Date(st.UpdatedAt).toLocaleString()}</span>}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {e.ifcClass === 'IfcSensor' && <button disabled={busy || cur === 'ALARM'} onClick={() => send(statusPatchFor('ALARM'))} style={{ ...btn, color: T.crit }}>경보</button>}
        <button disabled={busy || cur === 'FAULT'} onClick={() => send(statusPatchFor('FAULT'))} style={{ ...btn, color: T.warn }}>장애</button>
        <button disabled={busy || cur === 'OFFLINE'} onClick={() => send(statusPatchFor('OFFLINE'))} style={{ ...btn, color: T.ink[3] }}>오프라인</button>
        <button disabled={busy || cur === normal} onClick={() => send(statusPatchFor(normal))} style={{ ...btn, color: T.ok }}>{statusLabel(normal)} 복구</button>
      </div>
      {fields.length > 0 && <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}><tbody>
        {fields.map(([k, v]) => <tr key={k} style={{ borderTop: `1px solid ${T.bg.line}` }}>
          <td style={{ color: T.ink[2], padding: '3px 4px', whiteSpace: 'nowrap', width: '45%' }} title={k}>{READINGS[k]?.label ?? k}{READINGS[k]?.unit ? <span style={{ color: T.ink[3] }}> ({READINGS[k].unit})</span> : ''}{(() => { const lv = readings({ [k]: v }, e.name)[0]?.level; return lv && lv !== 'ok' ? <b style={{ color: LEVEL_COLOR[lv], marginLeft: 4 }}>{lv === 'crit' ? '위험' : '주의'}</b> : null })()}</td>
          <td style={{ padding: '2px 4px' }}><Field key={`${k}:${String(v)}`} k={k} v={v} busy={busy} onSave={val => send({ [k]: val })} /></td></tr>)}
      </tbody></table>}
      {msg && <div style={{ color: T.accent, marginTop: 6 }}>{msg}</div>}
      {trend && <TrendModal modelId={modelId} globalId={e.globalId} name={e.name ?? e.globalId} onClose={() => setTrend(false)} />}
    </div>
  )
}

/** 타입별 편집: boolean → 체크박스(즉시), number → 숫자(Enter/blur), 그 외 문자열(Enter/blur). 값이 같으면 안 보냄 */
function Field({ k, v, busy, onSave }: { k: string; v: unknown; busy: boolean; onSave: (val: unknown) => void }) {
  const [text, setText] = useState(String(v ?? ''))   // 값이 바뀌면 부모가 key 로 리마운트
  if (typeof v === 'boolean') return <input type="checkbox" checked={v} disabled={busy} onChange={ev => onSave(ev.target.checked)} aria-label={k} />
  const commit = () => { const val = typeof v === 'number' ? Number(text) : text; if (val === v || (typeof v === 'number' && Number.isNaN(val))) { setText(String(v)); return } onSave(val) }
  return <input value={text} type={typeof v === 'number' ? 'number' : 'text'} step="any" disabled={busy} onChange={ev => setText(ev.target.value)} onBlur={commit} onKeyDown={ev => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); if (ev.key === 'Escape') setText(String(v ?? '')) }}
    style={{ width: '100%', boxSizing: 'border-box', padding: '2px 6px', border: `1px solid ${T.bg.line}`, borderRadius: T.radius, fontSize: 12, background: T.bg.surface }} aria-label={k} />
}
