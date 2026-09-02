import { Tag, Wrench } from 'lucide-react'
import type { Asset, ElementDetail, WorkOrder } from './api'
import { ifcKo } from './ifcNames'
import { TEAMS } from './teams'
import { statusHex, statusLabel } from './status'
import { day } from './ui'
import { objLinks } from './context'

/** 객체 요약 카드: 무엇·어디·어느 팀·자산·작업지시 — 뷰어 우측 패널과 모니터링/시설관리의 객체 패널이 같은 카드를 쓴다.
 *  openWos 가 없으면(객체 패널) asset.openWorkOrders 건수만 보여주고 카드 목록(fm?sel=)으로 보낸다 */
export default function ObjectSummary({ modelId, detail, asset, openWos, onFm }: { modelId: string; detail: ElementDetail; asset?: Asset; openWos?: WorkOrder[]; onFm?: () => void }) {
  const st = (detail.properties.Pset_BimStatus as Record<string, unknown> | undefined)?.Status as string | undefined
  const links = objLinks(modelId, detail.globalId), open = openWos ?? []
  const teamsOf = (detail.systems ?? []).map(name => ({ name, team: TEAMS.find(t => t.systems.includes(name)) }))
  return (
    <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: 8, background: st === 'ALARM' ? '#fef2f2' : st === 'FAULT' ? '#fffbeb' : '#f8fafc', border: '1px solid ' + (st === 'ALARM' ? '#fecaca' : st === 'FAULT' ? '#fde68a' : '#e5e7eb') }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detail.name ?? ''}>{detail.name}</b>
        {st && <span style={{ padding: '1px 8px', borderRadius: 999, color: '#fff', fontSize: 11, fontWeight: 600, background: statusHex(st, '#6b7280') }}>{statusLabel(st)}</span>}</div>
      <div style={{ color: '#666', fontSize: 12, marginTop: 2 }}>{ifcKo(detail.ifcClass)} · {detail.spatialName ?? '위치 없음'}{teamsOf.length > 0 && <span style={{ marginLeft: 6, display: 'inline-flex', gap: 4 }}>{teamsOf.map(({ name, team }) => <span key={name} style={{ fontSize: 10, border: '1px solid ' + (team?.color ?? '#999'), color: team?.color ?? '#666', borderRadius: 4, padding: '0 4px' }}>{name}</span>)}</span>}</div>
      {/* 좁은 패널(기본 340px)에서 단어 중간이 꺾이지 않게: 항목별 nowrap + 컨테이너 wrap */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, marginTop: 4 }}>
        {asset ? <span style={{ whiteSpace: 'nowrap' }}><Tag size={11} style={{ verticalAlign: -1, color: '#2563eb' }} /> {asset.tag}</span> : <span style={{ color: '#999', whiteSpace: 'nowrap' }}><Tag size={11} style={{ verticalAlign: -1 }} /> 자산 미등록</span>}
        {asset && (openWos
          ? (open.length ? <a href={`#/models/${modelId}/fm?wo=${open[0].id}`} title="칸반 보드에서 이 카드 열기" style={{ color: '#1d4ed8', textDecoration: 'none', whiteSpace: 'nowrap' }}><Wrench size={11} style={{ verticalAlign: -1 }} /> 작업지시 {open.length} · {open[0].assignee ?? <span style={{ color: '#b45309' }}>미배정</span>}{open[0].dueOn ? ` ~${day(open[0].dueOn)}` : ''}</a> : <span style={{ color: '#999', whiteSpace: 'nowrap' }}><Wrench size={11} style={{ verticalAlign: -1 }} /> 열린 작업지시 없음</span>)
          : (asset.openWorkOrders ? <a href={links.fm} title="칸반 보드에서 이 자산의 카드" style={{ color: '#1d4ed8', textDecoration: 'none', whiteSpace: 'nowrap' }}><Wrench size={11} style={{ verticalAlign: -1 }} /> 작업지시 {asset.openWorkOrders}</a> : <span style={{ color: '#999', whiteSpace: 'nowrap' }}><Wrench size={11} style={{ verticalAlign: -1 }} /> 열린 작업지시 없음</span>))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>{/* 링크 묶음 — 좁으면 같이 다음 줄 오른쪽으로 */}
          <a href={links.monitor} title="모니터링에서 이 장비" style={{ color: '#2563eb', fontSize: 11, textDecoration: 'none' }}>모니터링 →</a>
          {onFm && <a onClick={onFm} style={{ color: '#2563eb', cursor: 'pointer', fontSize: 11 }}>자산·점검 →</a>}</span></div>
    </div>)
}
