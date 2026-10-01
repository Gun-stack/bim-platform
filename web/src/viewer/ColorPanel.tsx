/* oxlint-disable react/set-state-in-effect */
import { useEffect, useMemo, useState } from 'react'
import { Focus, X } from 'lucide-react'
import { api, type ElementRow, type SpatialNode, type System } from '../api'
import { STATUS, hex } from '../status'
import { groupByTeam, systemColor } from './SystemPanel'
import { T } from '../theme'

/** 카테고리 팔레트 (Tableau 10 + 2). 값이 더 많으면 순환 */
const PALETTE = [0x4e79a7, 0xf28e2b, 0xe15759, 0x76b7b2, 0x59a14f, 0xedc948, 0xb07aa1, 0xff9da7, 0x9c755f, 0xbab0ac, 0x1b9e77, 0x7570b3]
const BUILTIN = ['ifcClass', 'storey']
/** 상태 색 범례 — StatusEditor·STATUS 의 의미색과 동일. 상태는 모델 전체에 걸쳐 고정된 4갈래라 소로(이 값만 보기)는 두지 않는다(기존과 동일) */
const STATUS_LEGEND: [string, string][] = [[T.ok, '정상'], [T.crit, '경보'], [T.warn, '장애'], [T.ink[3], '점유·소등']]

export type ColorView = 'none' | 'status' | 'systems' | 'property'
export type Legend = { value: string; color: number; gids: string[] }[]

/** 색 범례 — 툴바 "색" 메뉴가 고른 모드 하나를 한 자리에서 보여준다(U309). 속성 모드는 분류 기준 선택도 함께 */
export default function ColorPanel({ modelId, mode, elements, spatial, systemsMeta, onChange, onSolo, onClose }: {
  modelId: string; mode: Exclude<ColorView, 'none'>
  elements: ElementRow[]; spatial: SpatialNode[]
  systemsMeta?: System[]   // undefined = /systems 응답 전(불러오는 중), 빈 배열 = 이 모델에 계통 없음
  onChange: (map?: Map<string, number>) => void
  onSolo: (label: string, gids: string[], key: string) => void
  onClose: () => void
}) {
  const [keys, setKeys] = useState<{ key: string; n: number }[]>([])
  const [key, setKey] = useState('ifcClass')
  const [values, setValues] = useState<{ globalId: string; value: string }[]>()
  useEffect(() => { if (mode === 'property') api<{ key: string; n: number }[]>(`/models/${modelId}/property-keys`).then(setKeys) }, [modelId, mode])

  // 값 수집: 내장(클래스·층)은 로컬, 나머지는 API — 속성 모드일 때만
  useEffect(() => {
    if (mode !== 'property') return
    if (key === 'ifcClass') return setValues(elements.map(e => ({ globalId: e.globalId, value: e.ifcClass })))
    if (key === 'storey') {
      const parent = new Map(spatial.map(s => [s.id, s])), name = (id: number | null): string => {
        let n = id == null ? undefined : parent.get(id); while (n && n.ifcClass !== 'IfcBuildingStorey') n = n.parentId == null ? undefined : parent.get(n.parentId); return n?.name ?? '(층 없음)' }
      return setValues(elements.map(e => ({ globalId: e.globalId, value: name(e.spatialNodeId) })))
    }
    setValues(undefined)
    api<{ globalId: string; value: string }[]>(`/models/${modelId}/property-values?key=${encodeURIComponent(key)}`).then(setValues)
  }, [key, elements, spatial, modelId, mode])

  const legend: Legend = useMemo(() => {
    if (!values) return []
    const groups = new Map<string, string[]>()
    for (const v of values) (groups.get(v.value) ?? groups.set(v.value, []).get(v.value)!).push(v.globalId)
    return [...groups].sort((a, b) => b[1].length - a[1].length).map(([value, gids], i) => ({ value, gids, color: STATUS[value.toUpperCase()]?.color ?? PALETTE[i % PALETTE.length] }))   // 상태값은 의미색 고정 (팔레트 순번이 아니라)
  }, [values])
  useEffect(() => {
    if (mode !== 'property') return
    const m = new Map<string, number>(); for (const l of legend) for (const g of l.gids) m.set(g, l.color)
    onChange(m)
    return () => onChange(undefined)
  }, [legend, onChange, mode])

  // 키 목록: 내장 → 표준 Pset_* → 나머지
  const sorted = useMemo(() => [...keys].sort((a, b) => +b.key.startsWith('Pset_') - +a.key.startsWith('Pset_') || b.n - a.n), [keys])
  const uncolored = elements.length - legend.reduce((n, l) => n + l.gids.length, 0)

  return (
    <div style={{ position: 'absolute', top: 8, left: 8, width: 260, background: T.bg.surface, borderRadius: T.radius, boxShadow: T.shadow, fontSize: 12, maxHeight: 'calc(100% - 70px)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: `1px solid ${T.bg.line}` }}>
        <b style={{ flex: 1 }}>{mode === 'status' ? '상태' : mode === 'systems' ? '계통' : '속성'}</b>
        <X size={14} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={onClose} />
      </div>

      {mode === 'property' && <>
        <div style={{ padding: '8px 10px' }}>
          <select value={key} onChange={e => setKey(e.target.value)} style={{ width: '100%', fontSize: 12 }}>
            <optgroup label="기본">
              {BUILTIN.map(k => <option key={k} value={k}>{k === 'ifcClass' ? '종류' : '층'}</option>)}
            </optgroup>
            <optgroup label="속성 그룹">
              {sorted.map(k => <option key={k.key} value={k.key}>{k.key} ({k.n})</option>)}
            </optgroup>
          </select>
        </div>
        <div style={{ overflow: 'auto', padding: '0 6px 8px' }}>
          {!values && <div style={{ color: T.ink[2], padding: 6 }}>불러오는 중…</div>}
          {legend.map(l => <LegendRow key={l.value} {...l} onSolo={() => onSolo(`${key} = ${l.value}`, l.gids, 'v:' + `${key} = ${l.value}`)} />)}
          {values && uncolored > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', color: T.ink[2] }}>
            <span style={{ width: 12, height: 12, borderRadius: T.radius, background: T.bg.line }} /> <span style={{ flex: 1 }}>값 없음</span> {uncolored}</div>}
        </div>
      </>}

      {mode === 'status' && <div style={{ padding: '2px 10px 8px' }}>
        {STATUS_LEGEND.map(([color, label]) => <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 4px' }}>
          <span style={{ width: 12, height: 12, borderRadius: T.radius, background: color, flexShrink: 0 }} /><span>{label}</span></div>)}
      </div>}

      {mode === 'systems' && <div style={{ overflow: 'auto', padding: '2px 6px 8px' }}>
        {systemsMeta === undefined && <div style={{ color: T.ink[2], padding: 6 }}>불러오는 중…</div>}
        {systemsMeta?.length === 0 && <div style={{ color: T.ink[2], padding: 6 }}>이 모델에는 계통 정보가 없습니다.</div>}
        {!!systemsMeta?.length && groupByTeam(systemsMeta).map(([team, ss]) => <div key={team?.key ?? 'etc'}>
          <div style={{ padding: '6px 4px 2px', fontSize: 11, fontWeight: 600, color: team?.color ?? T.ink[2] }}>{team?.name ?? '기타'}</div>
          {ss.map(s => <LegendRow key={s.id} value={s.name} color={systemColor(s)} gids={s.members}
            onSolo={() => onSolo(`계통 ${s.name}`, s.members, 'sys:' + s.id)} />)}
        </div>)}
      </div>}
    </div>
  )
}

function LegendRow({ value, color, gids, onSolo }: { value: string; color: number; gids: string[]; onSolo: () => void }) {
  const [hov, setHov] = useState(false)
  return <div onPointerEnter={() => setHov(true)} onPointerLeave={() => setHov(false)} onClick={onSolo} title="클릭: 이 값만 보기"
    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 4px', borderRadius: T.radius, background: hov ? T.accentSoft : 'transparent', cursor: 'pointer' }}>
    <span style={{ width: 12, height: 12, borderRadius: T.radius, background: hex(color), flexShrink: 0 }} />
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
    <span style={{ color: T.ink[2] }}>{gids.length}</span>
    <Focus size={12} style={{ color: hov ? T.accent : 'transparent' }} />
  </div>
}
