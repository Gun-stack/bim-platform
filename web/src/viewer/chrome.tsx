import { useRef, useState } from 'react'
import type React from 'react'
import { GripVertical, type LucideIcon } from 'lucide-react'
import { T } from '../theme'

/** 캔버스 위에 얹는 순수 표시 부품: 플로팅 패널, 툴바 버튼, 구분선, 범위 슬라이더. 뷰어 상태를 모른다 */

/** 캔버스 위 플로팅 패널: 그립(또는 빈 표면)을 끌어 이동, 위치는 localStorage(viewer.float.{id}) 기억, 그립 더블클릭 → 원위치.
 *  ponytail: 창이 줄어 저장 위치가 화면 밖이면 더블클릭 원위치로 복구 — 렌더 시 재클램프는 생략 */
export function Floating({ id, anchor, children }: { id: string; anchor: React.CSSProperties; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => { try { return JSON.parse(localStorage.getItem('viewer.float.' + id) ?? 'null') } catch { return null } })
  const ref = useRef<HTMLDivElement>(null)
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button, input, a, select, textarea')) return   // 컨트롤 조작은 드래그 아님
    const el = ref.current!, parent = el.offsetParent as HTMLElement | null; if (!parent) return
    const r = el.getBoundingClientRect(), pr = parent.getBoundingClientRect()
    const sx = e.clientX, sy = e.clientY, ox = r.left - pr.left, oy = r.top - pr.top
    let cur: { x: number; y: number } | null = null
    const cl = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))
    const move = (ev: PointerEvent) => {
      let x = cl(ox + ev.clientX - sx, 0, pr.width - r.width), y = cl(oy + ev.clientY - sy, 0, pr.height - r.height)
      // 가장자리 스냅: 16px 이내로 다가가면 여백 8px 에 자석처럼 붙는다
      if (x < 16) x = 8; else if (x > pr.width - r.width - 16) x = pr.width - r.width - 8
      if (y < 16) y = 8; else if (y > pr.height - r.height - 16) y = pr.height - r.height - 8
      cur = { x, y }; setPos(cur)
    }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (cur) { try { localStorage.setItem('viewer.float.' + id, JSON.stringify(cur)) } catch { /* 저장 불가 환경 */ } } }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  const reset = () => { setPos(null); try { localStorage.removeItem('viewer.float.' + id) } catch { /* 저장 불가 환경 */ } }
  return (
    <div ref={ref} onPointerDown={onDown} style={{ position: 'absolute', display: 'flex', alignItems: 'center', gap: 6, background: T.bg.surface, borderRadius: T.radius, boxShadow: T.shadow, ...anchor, ...(pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', transform: 'none' } : {}), touchAction: 'none' }}>
      <span title="드래그로 이동 · 더블클릭 원위치" onDoubleClick={reset} style={{ display: 'grid', cursor: 'grab', color: T.bg.line, flexShrink: 0 }}><GripVertical size={13} /></span>
      {children}
    </div>
  )
}

export function Tool({ icon: Icon, label, hint, onClick, active, disabled }: { icon: LucideIcon; label: string; hint?: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  const [hov, setHov] = useState(false)
  return <span style={{ position: 'relative', display: 'inline-block' }} onPointerEnter={() => setHov(true)} onPointerLeave={() => setHov(false)}>
    <button aria-label={label} onClick={onClick} disabled={disabled}
      style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', border: 0, borderRadius: T.radius, cursor: disabled ? 'default' : 'pointer',
               background: active ? T.accent : hov && !disabled ? T.accentSoft : 'transparent', color: active ? T.bg.surface : disabled ? T.bg.line : T.ink[1], transition: 'background .12s' }}>
      <Icon size={18} strokeWidth={1.8} /></button>
    {hov && <span style={{ position: 'absolute', bottom: 'calc(100% + 8px)', left: '50%', transform: 'translateX(-50%)', background: T.ink[1], color: T.ink[1], padding: '4px 8px', borderRadius: T.radius, fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none', boxShadow: T.shadow }}>
      {label}{disabled && hint && <span style={{ color: T.ink[3] }}> · {hint}</span>}</span>}
  </span>
}

export const Gap = () => <span style={{ width: 1, background: T.bg.line, margin: '6px 4px' }} />

/** 축 하나의 min/max 범위 슬라이더 (native range 두 개 겹침) */
export function Axis({ name, min, max, lo, hi, onChange }: { name: string; min: number; max: number; lo: number; hi: number; onChange: (lo: number, hi: number) => void }) {
  const st = { width: '100%', margin: 0, position: 'absolute' as const, left: 0, top: 0 }
  return <>
    <span style={{ color: { X: T.axis.x, Y: T.axis.y, Z: T.axis.z }[name as 'X'], fontWeight: 600 }}>{name}</span>
    <div style={{ position: 'relative', height: 20 }}>
      <input type="range" className="dual" min={min} max={max} step={0.05} value={lo} onChange={e => onChange(Math.min(+e.target.value, hi - 0.05), hi)} style={st} />
      <input type="range" className="dual hi" min={min} max={max} step={0.05} value={hi} onChange={e => onChange(lo, Math.max(+e.target.value, lo + 0.05))} style={st} />
    </div>
    <span style={{ color: T.ink[2], whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{lo.toFixed(2)} ~ {hi.toFixed(2)} m</span>
  </>
}
