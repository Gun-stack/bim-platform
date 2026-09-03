import type React from 'react'
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'
import { T } from './theme'

/** 접이식 섹션 — 헤더(아이콘·제목·건수) 클릭으로 펼침/접힘. 시설관리·모니터링이 공유 */
export function Section({ title, icon: Icon, count, open, onToggle, color, right, children, pad = 14 }: { title: string; icon?: LucideIcon; count?: React.ReactNode; open: boolean; onToggle: () => void; color?: string; right?: React.ReactNode; children: React.ReactNode; pad?: number }) {
  return (
    <section style={{ border: `1px solid ${T.bg.line}`, borderRadius: T.radius, marginBottom: 12, background: T.bg.surface }}>
      <div onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: 'pointer', userSelect: 'none', borderBottom: open ? `1px solid ${T.bg.line}` : 'none' }}>
        {Icon && <Icon size={15} style={{ color: color ?? T.accent }} />}<b style={{ fontSize: 14, color: color }}>{title}</b>{count != null && <span style={{ color: T.ink[2], fontSize: 12 }}>{count}</span>}
        {right && <span onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto' }}>{right}</span>}
        <span style={{ marginLeft: right ? 8 : 'auto', color: T.ink[2], display: 'inline-flex' }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span></div>
      {open && <div style={{ padding: pad }}>{children}</div>}
    </section>)
}
