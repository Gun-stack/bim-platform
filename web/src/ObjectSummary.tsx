import type { Asset, ElementDetail, WorkOrder } from './api'
import { ifcKo } from './ifcNames'
import { TEAMS } from './teams'
import { isQuiet, statusHex, statusLabel } from './status'
import { badge, day } from './ui'
import { objLinks } from './context'
import { T } from './theme'

/** 객체 요약 카드: 무엇·어디·어느 팀·자산·작업지시 — 뷰어 우측 패널과 모니터링/시설관리의 객체 패널이 같은 카드를 쓴다.
 *  openWos 가 없으면(객체 패널) asset.openWorkOrders 건수만 보여주고 카드 목록(fm?sel=)으로 보낸다 */
export default function ObjectSummary({ modelId, detail, asset, openWos, onFm }: { modelId: string; detail: ElementDetail; asset?: Asset; openWos?: WorkOrder[]; onFm?: () => void }) {
  const st = (detail.properties.Pset_BimStatus as Record<string, unknown> | undefined)?.Status as string | undefined
  const links = objLinks(modelId, detail.globalId), open = openWos ?? []
  const teamsOf = (detail.systems ?? []).map(name => ({ name, team: TEAMS.find(t => t.systems.includes(name)) }))
  return (
    <div style={{ marginBottom: 10, padding: '8px 10px', borderRadius: T.radius, background: st === 'ALARM' ? T.critSoft : st === 'FAULT' ? T.warnSoft : T.bg.raised, border: '1px solid ' + (st === 'ALARM' ? T.crit : st === 'FAULT' ? T.warn : T.bg.line) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><b style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={detail.name ?? ''}>{detail.name}</b>
        {st && (isQuiet(st) ? <span style={{ color: T.ink[2], fontSize: T.fs.xs }}>{statusLabel(st)}</span> : <span style={badge(statusHex(st))}>{statusLabel(st)}</span>)}</div>
      <div style={{ color: T.ink[2], fontSize: 12, marginTop: 2 }}>{ifcKo(detail.ifcClass)} · {detail.spatialName ?? '위치 없음'}{teamsOf.length > 0 && <span style={{ marginLeft: 6, display: 'inline-flex', gap: 4 }}>{teamsOf.map(({ name, team }) => <span key={name} style={{ fontSize: T.fs.xs, color: team?.color ?? T.ink[2] }}>{name}</span>)}</span>}</div>
      {/* 좁은 패널(기본 340px)에서 단어 중간이 꺾이지 않게: 항목별 nowrap + 컨테이너 wrap */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 10px', fontSize: 12, marginTop: 4 }}>
        {asset ? <span style={{ whiteSpace: 'nowrap' }}>자산 <b>{asset.tag}</b></span> : <span style={{ color: T.ink[3], whiteSpace: 'nowrap' }}>자산 미등록</span>}
        {asset && (openWos
          ? (open.length ? <a href={`#/models/${modelId}/fm?wo=${open[0].id}`} title="칸반 보드에서 이 카드 열기" style={{ color: T.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>작업지시 {open.length} · {open[0].assignee ?? <span style={{ color: T.warn }}>미배정</span>}{open[0].dueOn ? ` ~${day(open[0].dueOn)}` : ''}</a> : <span style={{ color: T.ink[3], whiteSpace: 'nowrap' }}>열린 작업지시 없음</span>)
          : (asset.openWorkOrders ? <a href={links.fm} title="칸반 보드에서 이 자산의 카드" style={{ color: T.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>작업지시 {asset.openWorkOrders}</a> : <span style={{ color: T.ink[3], whiteSpace: 'nowrap' }}>열린 작업지시 없음</span>))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, whiteSpace: 'nowrap' }}>{/* 링크 묶음 — 좁으면 같이 다음 줄 오른쪽으로 */}
          <a href={links.monitor} title="모니터링에서 이 장비" style={{ color: T.accent, fontSize: 11, textDecoration: 'none' }}>모니터링 →</a>
          {onFm && <a onClick={onFm} style={{ color: T.accent, cursor: 'pointer', fontSize: 11 }}>자산·점검 →</a>}</span></div>
    </div>)
}
