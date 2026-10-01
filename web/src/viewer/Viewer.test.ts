import { describe, expect, it } from 'vitest'
import { pickColors } from './Viewer'
import type { PowerResult, Route, StatusRow, System } from '../api'

const route: Route = { globalId: 'g0', direction: 'down', systems: [], nodes: [{ globalId: 'g1', ifcClass: 'IfcPipeSegment', name: null, depth: 1, spatialName: null, via: null }] }
const power: PowerResult = { source: 'GENERATOR', powered: ['g1'], unpowered: ['g2'] }
const statusRows: StatusRow[] = [{ globalId: 'g1', ifcClass: 'IfcSensor', name: null, spatialName: null, status: { Status: 'ALARM' } }]
const propertyMap = new Map([['g1', 0x112233]])
const base = { route: undefined, power: undefined, colorView: 'none' as const, statusRows: [] as StatusRow[], systemsMeta: undefined as System[] | undefined, propertyMap: undefined }

describe('pickColors — 색 보기 우선순위(U309): 추적 > 정전 > 상태·계통·속성 > 없음', () => {
  it('추적 중이면 속성 모드를 골라도 추적 색 — 리뷰에서 재현된 경합 버그의 재발 방지', () => {
    const m = pickColors({ ...base, route, colorView: 'property', propertyMap })
    expect(m?.get('g1')).toBeDefined()
    expect(m?.get('g1')).not.toBe(0x112233)   // 속성 색이 아니라 추적 색
  })
  it('정전 중이면 상태 모드를 골라도 정전 색', () => {
    const m = pickColors({ ...base, power, colorView: 'status', statusRows })
    expect(m?.has('g1')).toBe(true); expect(m?.has('g2')).toBe(true)
  })
  it('속성 모드 + 맵 있음 → 속성 맵 그대로', () => {
    expect(pickColors({ ...base, colorView: 'property', propertyMap })).toBe(propertyMap)
  })
  it('없음 → undefined', () => {
    expect(pickColors({ ...base, colorView: 'none' })).toBeUndefined()
  })
  it('속성 모드인데 범례가 아직 맵을 안 올렸으면 undefined — 이전 모드 색이 눌어붙지 않는다', () => {
    expect(pickColors({ ...base, colorView: 'property', propertyMap: undefined })).toBeUndefined()
  })
  it('계통 모드인데 /systems 응답이 아직 안 왔으면(systemsMeta undefined, B300 수정 뒤엔 마운트 직후뿐) undefined — 전부 회색 대신 평소 색 유지', () => {
    expect(pickColors({ ...base, colorView: 'systems', systemsMeta: undefined })).toBeUndefined()
  })
  it('계통 모드 + 응답은 왔지만 이 모델에 계통이 없음(빈 배열) → undefined', () => {
    expect(pickColors({ ...base, colorView: 'systems', systemsMeta: [] })).toBeUndefined()
  })
  it('계통 모드 + /systems 응답에 멤버 포함 → 계통색 즉시 칠함(B300: 탭을 연 적 없어도)', () => {
    const sm: System = { id: 1, globalId: 's1', name: '전기', predefinedType: null, memberCount: 1, connectionCount: 0, members: ['g1'] }
    expect(pickColors({ ...base, colorView: 'systems', systemsMeta: [sm] })?.get('g1')).toBeDefined()
  })
})
