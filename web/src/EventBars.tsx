import { T } from './theme'

export type Hour = { at: string; alarms: number; faults: number }

/** 24시간 발생 막대 — 시간당 정상→이상 전이(경보 아래·장애 위 누적). 계열 식별은 옆 글자(경보 N · 장애 N), 막대마다 title */
export default function EventBars({ data, fs = 1 }: { data: Hour[]; fs?: number }) {
  const W = 5, GAP = 2, H = Math.round(26 * fs), max = Math.max(1, ...data.map(d => d.alarms + d.faults))
  const a = data.reduce((n, d) => n + d.alarms, 0), f = data.reduce((n, d) => n + d.faults, 0)
  const y = (n: number) => Math.max(n ? 2 : 0, Math.round(n / max * (H - 2)))   // 1건도 보이게 최소 2px
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
      <svg width={data.length * (W + GAP)} height={H} role="img" aria-label={`24시간 경보 ${a}건 · 장애 ${f}건`} style={{ display: 'block' }}>
        {data.map((d, i) => { const x = i * (W + GAP), ha = y(d.alarms), hf = y(d.faults), h = new Date(d.at).getHours(); return (
          <g key={d.at}>
            <title>{`${h}시 — 경보 ${d.alarms} · 장애 ${d.faults}`}</title>
            <rect x={x - 1} y={0} width={W + GAP} height={H} fill="transparent" />{/* 막대보다 넓은 hover 영역 */}
            {ha > 0 && <rect x={x} y={H - 1 - ha} width={W} height={ha} rx={1.5} fill={T.crit} />}
            {hf > 0 && <rect x={x} y={H - 1 - ha - (ha ? 2 : 0) - hf} width={W} height={hf} rx={1.5} fill={T.warn} />}{/* 경보와 2px 표면 간격 */}
          </g>) })}
        <line x1={0} x2={data.length * (W + GAP)} y1={H - 0.5} y2={H - 0.5} stroke={T.bg.line} />
      </svg>
      <span style={{ color: T.ink[2], fontSize: T.fs.sm * fs }}>{a + f ? <>24시간 경보 <b style={{ color: T.ink[1] }}>{a}</b> · 장애 <b style={{ color: T.ink[1] }}>{f}</b></> : '24시간 발생 없음'}</span>
    </span>
  )
}
