import { describe, expect, it } from 'vitest'
import { hasPowerScenario } from './SystemPanel'

describe('hasPowerScenario — U330: 정전 시나리오는 ATS·발전기(MDB·EG-) 요소가 있어야', () => {
  it('MDB 로 시작하는 요소가 있으면 true', () => {
    expect(hasPowerScenario([{ name: 'MDB-1' }, { name: '조명-1' }])).toBe(true)
  })
  it('EG- 로 시작하는 요소(발전기)가 있으면 true', () => {
    expect(hasPowerScenario([{ name: 'EG-1' }])).toBe(true)
  })
  it('실무 IFC 처럼 둘 다 없으면 false — 정전 버튼을 숨긴다', () => {
    expect(hasPowerScenario([{ name: 'AHU-1' }, { name: null }])).toBe(false)
    expect(hasPowerScenario([])).toBe(false)
  })
})
