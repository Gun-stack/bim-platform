import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from './api'
import { READINGS } from './readings'
import { useEsc } from './ui'
import { T } from './theme'

type Pt = { at: string; data: Record<string, unknown> }
type S = { at: number; v: number }[]

/** 요소 계측 트렌드 — op_event.data 시계열을 계측 키별 미니 라인차트로. Esc/바깥 클릭 닫기 */
export default function TrendModal({ modelId, globalId, name, onClose }: { modelId: string; globalId: string; name: string; onClose: () => void }) {
  const [pts, setPts] = useState<Pt[] | null>(null)
  useEffect(() => { api<Pt[]>(`/models/${modelId}/elements/${encodeURIComponent(globalId)}/readings`).then(setPts).catch(() => setPts([])) }, [modelId, globalId])
  useEsc(onClose)
  const series = useMemo(() => {
    const keys = new Map<string, S>()
    for (const p of pts ?? []) for (const [k, v] of Object.entries(p.data ?? {}))
      if (typeof v === 'number' && k !== 'UpdatedAt') (keys.get(k) ?? keys.set(k, []).get(k)!).push({ at: +new Date(p.at), v })
    return [...keys.entries()].filter(([, s]) => s.length >= 2).sort((a, b) => (READINGS[a[0]]?.order ?? 5) - (READINGS[b[0]]?.order ?? 5))
  }, [pts])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.bg.surface, borderRadius: T.radius, padding: '14px 16px', width: 'min(500px, 92vw)', maxHeight: '86vh', overflow: 'auto', boxShadow: T.shadow }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <b style={{ fontSize: 14 }}>{name}</b><span style={{ color: T.ink[2], fontSize: 12 }}>계측 트렌드</span>
          <button onClick={onClose} aria-label="닫기" style={{ marginLeft: 'auto', border: 0, background: 'none', cursor: 'pointer', color: T.ink[2], padding: 4 }}><X size={16} /></button>
        </div>
        {pts === null ? <div style={{ color: T.ink[2], padding: 20, fontSize: 13 }}>불러오는 중…</div>
          : !series.length ? <div style={{ color: T.ink[2], padding: 20, fontSize: 13 }}>계측 이력이 아직 없습니다.<br />상태 API(PATCH)로 값이 들어올 때마다 여기 쌓입니다.</div>
          : series.map(([k, s]) => <Chart key={k} k={k} s={s} />)}
      </div>
    </div>)
}

/** 단일 시리즈 라인(파랑 2px) + hover 크로스헤어. 값·시각은 헤더 텍스트로(잉크색, warn/crit 만 경고색) */
function Chart({ k, s }: { k: string; s: S }) {
  const r = READINGS[k], W = 440, H = 68, PX = 3, PY = 7
  const [hover, setHover] = useState<number | null>(null)
  const min = Math.min(...s.map(p => p.v)), max = Math.max(...s.map(p => p.v))
  const t0 = s[0].at, t1 = s[s.length - 1].at
  const x = (t: number) => PX + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - PX * 2)
  const y = (v: number) => max === min ? H / 2 : PY + (1 - (v - min) / (max - min)) * (H - PY * 2)
  const d = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
  const hi = hover === null ? null : s[hover], cur = hi ?? s[s.length - 1]
  const lvl = (v: number) => r?.crit?.(v) ? T.crit : r?.warn?.(v) ? T.warn : T.ink[1]
  const fmt = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${r?.unit ?? ''}`
  const hhmm = (t: number) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 12 }}>
        <b style={{ color: T.ink[1] }}>{r?.label ?? k}</b>
        <b style={{ color: lvl(cur.v), fontSize: 13 }}>{fmt(cur.v)}</b>
        <span style={{ color: T.ink[2] }}>{hi ? hhmm(hi.at) : '현재'}</span>
        <span style={{ marginLeft: 'auto', color: T.ink[2] }}>{fmt(min)}~{fmt(max)} · {s.length}건 · {hhmm(t0)}–{hhmm(t1)}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${r?.label ?? k} 트렌드`} style={{ display: 'block', background: T.bg.base, borderRadius: 6, marginTop: 3, cursor: 'crosshair' }}
           onMouseMove={e => { const b = e.currentTarget.getBoundingClientRect(); const t = t0 + Math.max(0, Math.min(1, (e.clientX - b.left) / b.width)) * (t1 - t0)
             let best = 0; for (let i = 1; i < s.length; i++) if (Math.abs(s[i].at - t) < Math.abs(s[best].at - t)) best = i; setHover(best) }}
           onMouseLeave={() => setHover(null)}>
        <line x1={PX} y1={H - PY} x2={W - PX} y2={H - PY} stroke={T.bg.line} />
        <path d={d} fill="none" stroke={T.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hi && <>
          <line x1={x(hi.at)} y1={0} x2={x(hi.at)} y2={H} stroke={T.ink[3]} strokeDasharray="3 3" />
          <circle cx={x(hi.at)} cy={y(hi.v)} r={4} fill={T.accent} stroke={T.bg.raised} strokeWidth={2} />
        </>}
      </svg>
    </div>)
}
