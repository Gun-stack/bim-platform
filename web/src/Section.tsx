import type React from 'react'
import { ChevronDown, ChevronUp, type LucideIcon } from 'lucide-react'
import { T } from './theme'

/** 섹션 — 헤더(아이콘·제목·건수). `collapsible`(기본 true)이면 클릭으로 펼침/접힘, 아니면 항상 펼침 + 화살표 없음. 시설관리·모니터링이 공유 */
export function Section({ title, icon: Icon, count, open, onToggle, collapsible = true, color, right, children, pad = 14 }: { title: string; icon?: LucideIcon; count?: React.ReactNode; open: boolean; onToggle?: () => void; collapsible?: boolean; color?: string; right?: React.ReactNode; children: React.ReactNode; pad?: number }) {
  return (
    <section style={{ border: `1px solid ${T.bg.line}`, borderRadius: T.radius, marginBottom: 12, background: T.bg.surface }}>
      <div onClick={collapsible ? onToggle : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', cursor: collapsible ? 'pointer' : 'default', userSelect: 'none', borderBottom: open ? `1px solid ${T.bg.line}` : 'none' }}>
        {Icon && <Icon size={15} style={{ color: color ?? T.accent }} />}<b style={{ fontSize: T.fs.lg, color: color }}>{title}</b>{count != null && <span style={{ color: T.ink[2], fontSize: T.fs.sm }}>{count}</span>}
        {right && <span onClick={e => e.stopPropagation()} style={{ marginLeft: 'auto' }}>{right}</span>}
        {collapsible && <span style={{ marginLeft: right ? 8 : 'auto', color: T.ink[2], display: 'inline-flex' }}>{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>}</div>
      {open && <div style={{ padding: pad }}>{children}</div>}
    </section>)
}
