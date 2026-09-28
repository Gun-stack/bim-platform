import { describe, expect, it } from 'vitest'
import { EDGE, tier, xrayMat } from './xray'

describe('tier — IFC 클래스 → X-ray 층위', () => {
  it('수평: 슬래브·지붕·마감 (StandardCase 등 하위형 포함)', () => {
    for (const c of ['IfcSlab', 'IfcSlabStandardCase', 'IfcRoof', 'IfcCovering']) expect(tier(c)).toBe('horizontal')
  })
  it('수직: 벽·커튼월·창·문·기둥·보·계단·램프·난간·판·부재', () => {
    for (const c of ['IfcWall', 'IfcWallStandardCase', 'IfcCurtainWall', 'IfcWindow', 'IfcDoor', 'IfcColumn', 'IfcBeam', 'IfcStair', 'IfcStairFlight', 'IfcRamp', 'IfcRampFlight', 'IfcRailing', 'IfcPlate', 'IfcMember'])
      expect(tier(c)).toBe('vertical')
  })
  it('설비·미상은 equipment — 원본 재질 유지', () => {
    for (const c of ['IfcPump', 'IfcFlowSegment', 'IfcDistributionControlElement', 'IfcBuildingElementProxy', 'IfcFurnishingElement', 'IfcTransportElement', '', undefined]) expect(tier(c)).toBe('equipment')
  })
})

describe('xrayMat — 층위별 재질', () => {
  it('수평은 반불투명 + AO 참여, 수직은 거의 투명, 설비는 없음', () => {
    const h = xrayMat('horizontal')!, v = xrayMat('vertical')!
    expect(h.transparent && v.transparent).toBe(true)
    expect(h.opacity).toBeGreaterThan(0.3); expect(h.userData.ao).toBe(true)
    expect(v.opacity).toBeLessThan(0.2); expect(v.userData.ao).toBeUndefined()
    expect(h.depthWrite || v.depthWrite).toBe(false)
    expect(xrayMat('equipment')).toBeUndefined()
    expect(EDGE.transparent).toBe(true)
  })
})
