import { useEffect, useRef } from 'react'
import type { LucideIcon } from 'lucide-react'
import { T } from '../theme'

export type MenuItem = { icon?: LucideIcon; label: string; hint?: string; disabled?: boolean; onClick?: () => void } | 'sep'

/** 우클릭 메뉴. 화면 밖으로 나가지 않게 위치 보정, 바깥 클릭·Esc·스크롤로 닫힘 */
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // capture 단계라 메뉴 안 pointerdown 도 여기로 먼저 온다 → 안쪽이면 무시 (안 그러면 click 전에 닫혀 항목이 안 눌림)
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose() }, key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('pointerdown', close, true); addEventListener('keydown', key); addEventListener('wheel', close, true)
    return () => { removeEventListener('pointerdown', close, true); removeEventListener('keydown', key); removeEventListener('wheel', close, true) }
  }, [onClose])
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
