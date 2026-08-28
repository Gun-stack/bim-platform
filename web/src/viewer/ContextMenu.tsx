import { useEffect } from 'react'
import type { LucideIcon } from 'lucide-react'

export type MenuItem = { icon?: LucideIcon; label: string; hint?: string; disabled?: boolean; danger?: boolean; onClick?: () => void } | 'sep'

/** 우클릭 메뉴. 화면 밖으로 나가지 않게 위치 보정, 바깥 클릭·Esc·스크롤로 닫힘 */
export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose(), key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('pointerdown', close, true); addEventListener('keydown', key); addEventListener('wheel', close, true)
    return () => { removeEventListener('pointerdown', close, true); removeEventListener('keydown', key); removeEventListener('wheel', close, true) }
  }, [onClose])
  const w = 230, h = items.length * 30 + 12
  const left = Math.min(x, innerWidth - w - 8), top = Math.min(y, innerHeight - h - 8)
  return (
    <div onPointerDown={e => e.stopPropagation()} onContextMenu={e => e.preventDefault()}
         style={{ position: 'fixed', left, top, width: w, zIndex: 50, background: '#fff', borderRadius: 8, padding: 6, boxShadow: '0 4px 16px #0003, 0 0 0 1px #0000001a', fontSize: 13 }}>
      {items.map((it, i) => it === 'sep'
        ? <div key={i} style={{ height: 1, background: '#eee', margin: '5px 4px' }} />
        : <Item key={i} {...it} onClose={onClose} />)}
    </div>
  )
}

function Item({ icon: Icon, label, hint, disabled, danger, onClick, onClose }: Exclude<MenuItem, 'sep'> & { onClose: () => void }) {
  return (
    <div onClick={() => { if (disabled) return; onClick?.(); onClose() }}
         style={{ display: 'flex', alignItems: 'center', gap: 8, height: 28, padding: '0 8px', borderRadius: 5, cursor: disabled ? 'default' : 'pointer', color: disabled ? '#bbb' : danger ? '#b91c1c' : '#222' }}
         onPointerEnter={e => { if (!disabled) (e.currentTarget as HTMLElement).style.background = '#eef2ff' }} onPointerLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      <span style={{ width: 16, display: 'grid', placeItems: 'center' }}>{Icon && <Icon size={15} />}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hint && <span style={{ color: '#999', fontSize: 11 }}>{hint}</span>}
    </div>
  )
}
