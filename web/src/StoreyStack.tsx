import { cellLevel, isAbn, type Level, type Row, type Storey } from './monitor'
import { TEAMS } from './teams'
import { T } from './theme'

type Team = typeof TEAMS[number]
const FILL: Record<Level, string> = { crit: T.crit, warn: T.warn, ok: T.bg.line, none: 'transparent' }
const WORD: Record<Level, string> = { crit: '경보', warn: '장애·주의', ok: '정상', none: '요소 없음' }

/** 건물 단면 히트맵 — 동마다 층을 위→아래로 쌓고, 층마다 분야 5칸을 상태 의미색으로. 입면처럼 "어느 동 몇 층 어느 분야"가 한눈에.
 *  색만으로 읽지 않게: 열 머리 분야 글자, 행 끝 이상 건수, 칸 title. 칸 클릭 = 분야+층 필터, 층 클릭 = 층 필터 */
export default function StoreyStack({ rows, storeys, teamOf, dead, team, storey, onPick, fs = 1 }: {
  rows: Row[]; storeys: Storey[]; teamOf: (r: Row) => Team | undefined; dead: (gid: string) => boolean
  team?: string; storey?: string; onPick: (team: string | undefined, storey: string) => void; fs?: number
}) {
  const buildings = [...new Set(storeys.map(s => s.building ?? ''))]
  const cw = Math.round(22 * fs), ch = Math.round(16 * fs)
  return (
    <div>
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>   {/* 아래 정렬 — 층 많은 동이 높게 서는 스카이라인 */}
      {buildings.map(b => { const list = storeys.filter(s => (s.building ?? '') === b); return (
        <div key={b} style={{ display: 'grid', gridTemplateColumns: `minmax(${Math.round(40 * fs)}px, max-content) repeat(${TEAMS.length}, ${cw}px) ${Math.round(22 * fs)}px`, gap: 2, alignItems: 'center', fontSize: T.fs.xs * fs }}>
          <div style={{ gridColumn: `1 / span ${TEAMS.length + 2}`, fontWeight: T.fw.bold, color: T.ink[1], fontSize: T.fs.sm * fs, marginBottom: 2 }}>{b || '건물'}</div>
          <span />{TEAMS.map(t => <span key={t.key} title={t.name} style={{ textAlign: 'center', color: team === t.key ? t.color : T.ink[3] }}>{t.name[0]}</span>)}<span />
          {list.map(s => { const at = rows.filter(r => r.storey === s.name), n = at.filter(isAbn).length, on = storey === s.name; return [
            <button key={s.name} onClick={() => onPick(undefined, s.name)} title={on ? '전체 층 보기' : '이 층만 보기'}
              style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'right', paddingRight: 4, whiteSpace: 'nowrap', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: on ? T.fw.bold : T.fw.normal, color: on ? T.accent : T.ink[2] }}>{s.name}</button>,
            ...TEAMS.map(t => { const rs = at.filter(r => teamOf(r)?.key === t.key), lv = cellLevel(rs, dead), sel = on && team === t.key
              return <button key={s.name + t.key} disabled={lv === 'none'} onClick={() => onPick(t.key, s.name)}
                title={`${s.name} · ${t.name} — ${WORD[lv]}${rs.length ? ` · 경보 ${rs.filter(r => r.status?.Status === 'ALARM').length} · 장애 ${rs.filter(r => r.status?.Status === 'FAULT').length} · 요소 ${rs.length}` : ''}`}
                style={{ width: cw, height: ch, padding: 0, borderRadius: 3, cursor: lv === 'none' ? 'default' : 'pointer', background: FILL[lv], border: 0,
                  outline: sel ? `2px solid ${T.accent}` : lv === 'none' ? `1px solid ${T.bg.raised}` : undefined, outlineOffset: sel ? 1 : -1 }} /> }),
            <b key={s.name + '#'} style={{ color: n ? T.crit : 'transparent', fontSize: T.fs.xs * fs, paddingLeft: 2 }}>{n || 0}</b>,
          ] })}
        </div>) })}
    </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 10, fontSize: T.fs.xs * fs, color: T.ink[2] }}>   {/* 범례 — 색 단독 의존 금지 */}
        {(['crit', 'warn', 'ok'] as const).map(l => <span key={l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 12, height: 10, borderRadius: 2, background: FILL[l] }} />{WORD[l]}</span>)}
        <span style={{ color: T.ink[3] }}>칸 클릭 → 아래 격자</span>
      </div>
    </div>
  )
}
