import { useCallback, useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { T } from '../theme'
import { useEscLayer } from '../ui'

export type MenuItem = { icon?: LucideIcon; label: string; hint?: string; disabled?: boolean; onClick?: () => void } | 'sep'

/** 우클릭 메뉴. 화면 밖으로 나가지 않게 위치 보정, 바깥 클릭·Esc·스크롤로 닫힘.
 *  Esc 는 useEscLayer(B301) — 열린 층이 여럿이면 가장 위(이 메뉴)만 닫고, 씬의 선택 해제는 건드리지 않는다 */
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // onClose 를 안정 참조로 — Viewer 재렌더마다 새 함수를 받아도 아래 effect 가 매번 다시 구독하지 않는다
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })
  const close = useCallback(() => onCloseRef.current(), [])
  useEscLayer(true, close)
  useEffect(() => {
    // capture 단계라 메뉴 안 pointerdown 도 여기로 먼저 온다 → 안쪽이면 무시 (안 그러면 click 전에 닫혀 항목이 안 눌림)
    const outside = (e: Event) => { if (!ref.current?.contains(e.target as Node)) close() }
    addEventListener('pointerdown', outside, true); addEventListener('wheel', outside, true)
    return () => { removeEventListener('pointerdown', outside, true); removeEventListener('wheel', outside, true) }
  }, [close])
  const w = 230, h = items.length * 30 + 12
  const left = Math.min(x, innerWidth - w - 8), top = Math.min(y, innerHeight - h - 8)
  return (
    <div ref={ref} onContextMenu={e => e.preventDefault()}
         style={{ position: 'fixed', left, top, width: w, zIndex: 50, background: T.bg.surface, borderRadius: T.radius, padding: 6, boxShadow: T.shadow, fontSize: 13 }}>
      {items.map((it, i) => it === 'sep'
        ? <div key={i} style={{ height: 1, background: T.bg.line, margin: '5px 4px' }} />
        : <Item key={i} {...it} onClose={onClose} />)}
    </div>
  )
}

function Item({ icon: Icon, label, hint, disabled, onClick, onClose }: Exclude<MenuItem, 'sep'> & { onClose: () => void }) {
  return (
    <div onClick={() => { if (disabled) return; onClick?.(); onClose() }}
         style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px', borderRadius: T.radius, cursor: disabled ? 'default' : 'pointer', color: disabled ? T.ink[3] : T.ink[1] }}
         onPointerEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = T.accentSoft }} onPointerLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      <span style={{ width: 16, display: 'grid', placeItems: 'center' }}>{Icon && <Icon size={15} />}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ color: T.ink[2], fontSize: 11 }}>{hint}</span>}
    </div>
  )
}
