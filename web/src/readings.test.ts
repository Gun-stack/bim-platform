import { describe, expect, it } from 'vitest'
import { inlineReadings, readings, recentWindow } from './readings'

describe('readings — 계측값 표시·등급', () => {
  it('crit 이 warn 보다 우선하고, 사전에 없는 키는 이름 그대로 뒤에 선다', () => {
    const r = readings({ LoadPercent: 96, OilTemp: 72, Foo: 'bar', Status: 'ALARM', UpdatedAt: 'x' })
    expect(r.map(x => [x.key, x.level, x.text])).toEqual([['LoadPercent', 'crit', '96%'], ['OilTemp', 'warn', '72°C'], ['Foo', 'ok', 'bar']])   // Status·UpdatedAt 제외
  })
  it('집수정·오수는 수위 기준이 뒤집힌다 (높을수록 이상)', () => {
    expect(readings({ LevelPercent: 20 }, '저수조')[0].level).toBe('warn')
    expect(readings({ LevelPercent: 20 }, '집수정')[0].level).toBe('ok')
    expect(readings({ LevelPercent: 92 }, '오수 저류조')[0].level).toBe('crit')
  })
  it('boolean 은 fmt 로 글자가 되고 warn 은 1/0 으로 판정한다', () => {
    expect(readings({ OnBattery: true })[0]).toMatchObject({ text: '예', level: 'warn' })
    expect(readings({ Open: false })[0]).toMatchObject({ text: '닫힘', level: 'ok' })
  })
  it('소수는 한 자리, 정수는 그대로, 이력성(order ≥ 4)은 inline 에서 빠진다', () => {
    expect(readings({ Pressure: 0.456 })[0].text).toBe('0.5MPa')
    expect(inlineReadings({ LastTest: '2026-01-01', RoomTemp: 22 }).map(x => x.key)).toEqual(['RoomTemp'])
  })
})

describe('recentWindow — 트렌드는 마지막 점 기준 24시간만', () => {
  const h = 3600_000
  it('몇 주 전 점은 버려 시간축에 큰 공백이 생기지 않게', () => {
    const s = [{ at: 0, v: 1 }, { at: 20 * 24 * h, v: 2 }, { at: 20 * 24 * h + h, v: 3 }]
    expect(recentWindow(s).map(p => p.v)).toEqual([2, 3])
  })
  it('24시간 안이면 전부', () => {
    const s = [{ at: 0, v: 1 }, { at: 23 * h, v: 2 }]
    expect(recentWindow(s)).toHaveLength(2)
    expect(recentWindow([])).toEqual([])
  })
})
