import { describe, expect, it } from 'vitest'
import { isEquipment } from './FmPanel'

describe('isEquipment — U336: 자산 일괄 등록(서버 FmService.bulk)과 같은 제외 규칙', () => {
  it('구조체(벽·슬래브·지붕·마감·커튼월)는 장비가 아니다', () => {
    expect(isEquipment('IfcWall')).toBe(false)
    expect(isEquipment('IfcWallStandardCase')).toBe(false)
    expect(isEquipment('IfcSlab')).toBe(false)
    expect(isEquipment('IfcCurtainWall')).toBe(false)
  })
  it('배관·덕트·케이블 같은 선과 그 이음은 장비가 아니다(API Sql.SEGMENT_CLASSES 와 같은 목록)', () => {
    expect(isEquipment('IfcPipeSegment')).toBe(false)
    expect(isEquipment('IfcDuctFitting')).toBe(false)
    expect(isEquipment('IfcCableCarrierSegment')).toBe(false)
  })
  it('감지기·펌프 같은 실제 장비는 등록 폼을 그대로 보여준다', () => {
    expect(isEquipment('IfcSensor')).toBe(true)
    expect(isEquipment('IfcPump')).toBe(true)
    expect(isEquipment('IfcLightFixture')).toBe(true)
  })
})
