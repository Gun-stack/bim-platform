import { describe, expect, it } from 'vitest'
import { day, hm, hms, dateTime, today, inspectionOverdue, woOverdue } from './ui'

describe('날짜·시간 규칙', () => {
  it('today 는 로컬 자정 기준 YYYY-MM-DD (UTC 가 아니라)', () => {
    const d = new Date()
    expect(today()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  })
  it('hm/hms 는 24시 고정', () => {
    const t = new Date(2026, 0, 1, 15, 4, 9)
    expect(hm(t)).toBe('15:04')
    expect(hms(t)).toBe('15:04:09')
    expect(dateTime(t)).toContain('15:04')
    expect(dateTime(t)).not.toContain('오후')
  })
  it('점검 지연은 ACTIVE 만, 작업지시 기한 초과는 DONE 제외 — 같은 문자열 비교 규칙', () => {
    expect(inspectionOverdue('2000-01-01', 'ACTIVE')).toBe(true)
    expect(inspectionOverdue('2000-01-01', 'RETIRED')).toBe(false)
    expect(inspectionOverdue('2999-01-01', 'ACTIVE')).toBe(false)
    expect(woOverdue('2000-01-01', 'OPEN')).toBe(true)
    expect(woOverdue('2000-01-01', 'DONE')).toBe(false)
    expect(woOverdue(day('2999-01-01T00:00:00Z'), 'OPEN')).toBe(false)
    expect(woOverdue(today(), 'OPEN')).toBe(false)   // 오늘 기한은 아직 초과 아님
  })
})
