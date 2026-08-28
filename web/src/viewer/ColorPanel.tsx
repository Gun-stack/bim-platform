/* oxlint-disable react/only-export-components, react/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { Focus, X } from 'lucide-react'
import { api, type ElementRow, type SpatialNode } from '../api'

/** 카테고리 팔레트 (Tableau 10 + 2). 값이 더 많으면 순환 */
export const PALETTE = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948, 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac, 0x1b9e77, 0x7570b3]
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const BUILTIN = ['ifcClass', 'storey']
/** 상태값은 의미색 고정 (팔레트 순번이 아니라) */
const STATUS_COLOR: Record<string, number> = { NORMAL: 0x16a34a, OK: 0x16a34a, ONLINE: 0x16a34a, RUNNING: 0x16a34a, STANDBY: 0x6b7280, ALARM: 0xdc2626, FAULT: 0xf59e0b, TROUBLE: 0xf59e0b, OFFLINE: 0xf59e0b, OFF: 0x9ca3af, UTILITY: 0x2563eb, GENERATOR: 0xea580c }

export type Legend = { value: string; color: number; gids: string[] }[]

export default function ColorPanel({ modelId, elements, spatial, onChange, onSolo, onClose }: {
  modelId: string; elements: ElementRow[]; spatial: SpatialNode[]
  onChange: (map?: Map<string, number>) => void; onSolo: (label: string, gids: string[]) => void; onClose: () => void
}) {
  const [keys, setKeys] = useState<{ key: string; n: number }[]>([])
  const [key, setKey] = useState('ifcClass')
  const [values, setValues] = useState<{ globalId: string; value: string }[]>()
  useEffect(() => { api(`/models/${modelId}/property-keys`).then(setKeys) }, [modelId])

  // 값 수집: 내장(클래스·층)은 로컬, 나머지는 API
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (key === 'ifcClass') return setValues(elements.map(e => ({ globalId: e.globalId, value: e.ifcClass })))
    if (key === 'storey') {
      const parent = new Map(spatial.map(s => [s.id, s])), name = (id: number | null): string => {
        let n = id == null ? undefined : parent.get(id); while (n && n.ifcClass !== 'IfcBuildingStorey') n = n.parentId == null ? undefined : parent.get(n.parentId); return n?.name ?? '(층 없음)' }
      return setValues(elements.map(e => ({ globalId: e.globalId, value: name(e.spatialNodeId) })))
    }
    setValues(undefined)
    api(`/models/${modelId}/property-values?key=${encodeURIComponent(key)}`).then(setValues)
  }, [key, elements, spatial, modelId])

  const legend: Legend = useMemo(() => {
    if (!values) return []
    const groups = new Map<string, string[]>()
    for (const v of values) (groups.get(v.value) ?? groups.set(v.value, []).get(v.value)!).push(v.globalId)
    return [...groups].sort((a, b) => b[1].length - a[1].length).map(([value, gids], i) => ({ value, gids, color: STATUS_COLOR[value.toUpperCase()] ?? PALETTE[i % PALETTE.length] }))
  }, [values])
  useEffect(() => {
    const m = new Map<string, number>(); for (const l of legend) for (const g of l.gids) m.set(g, l.color)
    onChange(m)
    return () => onChange(undefined)
  }, [legend, onChange])

  // 키 목록: 내장 → 표준 Pset_* → 나머지
  const sorted = useMemo(() => [...keys].sort((a, b) => +b.key.startsWith('Pset_') - +a.key.startsWith('Pset_') || b.n - a.n), [keys])
  const uncolored = elements.length - legend.reduce((n, l) => n + l.gids.length, 0)

  return (
    <div style={{ position: 'absolute', top: 8, left: 8, width: 260, background: '#fff', borderRadius: 8, boxShadow: '0 2px 10px #0002, 0 0 0 1px #0000000d', fontSize: 12, maxHeight: 'calc(100% - 70px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid #eee' }}>
        <b style={{ flex: 1 }}>속성별 색상</b>
        <X size={14} style={{ cursor: 'pointer', color: '#666' }} onClick={onClose} />
      </div>
      <div style={{ padding: '8px 10px' }}>
        <select value={key} onChange={e => setKey(e.target.value)} style={{ width: '100%', fontSize: 12 }}>
          <optgroup label="기본">
            {BUILTIN.map(k => <option key={k} value={k}>{k === 'ifcClass' ? '클래스' : '층'}</option>)}
          </optgroup>
          <optgroup label="Pset / 수량">
            {sorted.map(k => <option key={k.key} value={k.key}>{k.key} ({k.n})</option>)}
          </optgroup>
        </select>
      </div>
      <div style={{ overflow: 'auto', padding: '0 6px 8px' }}>
        {!values && <div style={{ color: '#999', padding: 6 }}>불러오는 중…</div>}
        {legend.map(l => <LegendRow key={l.value} {...l} onSolo={() => onSolo(`${key} = ${l.value}`, l.gids)} />)}
        {values && uncolored > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', color: '#888' }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: '#d8d8d8' }} /> <span style={{ flex: 1 }}>값 없음</span> {uncolored}</div>}
      </div>
    </div>
  )
}

function LegendRow({ value, color, gids, onSolo }: { value: string; color: number; gids: string[]; onSolo: () => void }) {
  const [hov, setHov] = useState(false)
  return <div onPointerEnter={() => setHov(true)} onPointerLeave={() => setHov(false)} onClick={onSolo} title="클릭: 이 값만 보기"
    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: 4, background: hov ? '#eef2ff' : 'transparent', cursor: 'pointer' }}>
    <span style={{ width: 12, height: 12, borderRadius: 3, background: hex(color), flexShrink: 0 }} />
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    <span style={{ color: '#888' }}>{gids.length}</span>
    <Focus size={12} style={{ color: hov ? '#2563eb' : 'transparent' }} />
  </div>
}
