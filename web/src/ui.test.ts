import { describe, expect, it } from 'vitest'
import { day, hm, hms, dateTime, today, inspectionOverdue, woOverdue, pushEscLayer, hasEscLayer, fireEsc } from './ui'

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

describe('Esc 층 쌓기(B301) — 메뉴·안내·측정이 겹쳐도 Esc 한 번은 가장 위 층만', () => {
  it('fireEsc 는 가장 나중에 연 층(스택 맨 위)만 부른다 — 둘 다 동시에 닫히면 재발', () => {
    const calls: string[] = []
    const popA = pushEscLayer(() => calls.push('A'))   // 먼저 연 메뉴
    const popB = pushEscLayer(() => calls.push('B'))   // 나중에 연 단축키 안내
    expect(hasEscLayer()).toBe(true)
    fireEsc()
    expect(calls).toEqual(['B'])   // A 는 아직 안 불림
    popB()   // 실제로는 B 가 닫히며 자기 층을 effect cleanup 으로 뺀다
    expect(hasEscLayer()).toBe(true)   // A 는 아직 열려 있다
    fireEsc()
    expect(calls).toEqual(['B', 'A'])
    popA()
    expect(hasEscLayer()).toBe(false)
  })
  it('층이 없으면 fireEsc 가 아무것도 하지 않는다 — scene.ts 의 선택 해제가 이때만 동작', () => {
    expect(hasEscLayer()).toBe(false)
    expect(() => fireEsc()).not.toThrow()
  })
})
