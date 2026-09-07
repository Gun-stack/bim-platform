import { describe, expect, it } from 'vitest'
import { isAbn, overdue, rank, storeyClipZ, teamStats, type Row, type StatRow, type Storey } from './monitor'

const row = (p: Partial<Row>): Row => ({ globalId: 'g', ifcClass: 'IfcPump', name: 'WP-1', storey: 'B1', zone: null, elevation: 0, building: null, systems: [], status: null, assetId: null, assetTag: null, assetStatus: 'ACTIVE', lastResult: null, openWorkOrders: 0, ...p })

describe('rank — "조치 필요" 순서', () => {
  it('경보 0 < 장애 1 < 계측 위험·무전원 2 < 주의·작업지시 3 < 결함 4 < 점검 지연 5 < 정상 9', () => {
    expect(rank(row({ status: { Status: 'ALARM' } }))).toBe(0)
    expect(rank(row({ status: { Status: 'FAULT' } }))).toBe(1)
    expect(rank(row({ status: { Status: 'NORMAL', LoadPercent: 97 } }))).toBe(2)
    expect(rank(row({}), true)).toBe(2)
    expect(rank(row({ status: { Status: 'NORMAL', LoadPercent: 85 } }))).toBe(3)
    expect(rank(row({ openWorkOrders: 1 }))).toBe(3)
    expect(rank(row({ lastResult: 'DEFECT' }))).toBe(4)
    expect(rank(row({ nextDueOn: '2000-01-01' }))).toBe(5)
    expect(rank(row({ status: { Status: 'NORMAL', LoadPercent: 10 } }))).toBe(9)
  })
  it('상태값이 있으면 계측·작업지시보다 우선한다', () => {
    expect(rank(row({ status: { Status: 'ALARM', LoadPercent: 10 }, openWorkOrders: 3 }))).toBe(0)
  })
})

describe('overdue — 점검 지연', () => {
  it('ACTIVE 자산만, 오늘 이전 날짜만', () => {
    expect(overdue(row({ nextDueOn: '2000-01-01' }))).toBe(true)
    expect(overdue(row({ nextDueOn: '2000-01-01', assetStatus: 'RETIRED' }))).toBe(false)
    expect(overdue(row({ nextDueOn: '2999-01-01' }))).toBe(false)
    expect(overdue(row({ nextDueOn: null }))).toBe(false)
  })
})

describe('teamStats — 팀별 경보 통계', () => {
  const st = (p: Partial<StatRow>): StatRow => ({ globalId: 'g', name: null, ifcClass: null, systems: ['소방'], alarms: 0, faults: 0, recovered: 0, open: 0, mttrMin: null, lastAt: null, ...p })
  it('복구 시간은 에피소드 수 가중 평균, 재발은 2회 이상 장비 수', () => {
    const fire = teamStats([st({ alarms: 2, recovered: 2, mttrMin: 10 }), st({ globalId: 'h', faults: 1, recovered: 1, mttrMin: 40, open: 1 })]).find(s => s.team.key === 'fire')!
    expect(fire).toMatchObject({ alarms: 2, faults: 1, open: 1, mttrMin: 20, recurring: 1 })   // (10·2 + 40·1) / 3
  })
  it('복구된 에피소드가 없으면 평균은 null, 팀 매핑은 teams.ts 규칙(조명제어반→전기)', () => {
    const s = teamStats([st({ name: '조명제어반 1', systems: ['통신'], alarms: 1, open: 1 })])
    expect(s.find(x => x.team.key === 'elec')).toMatchObject({ alarms: 1, mttrMin: null })
    expect(s.find(x => x.team.key === 'comm')).toMatchObject({ alarms: 0 })
  })
})

describe('isAbn', () => {
  it('ALARM/FAULT 만 이상', () => {
    expect(isAbn(row({ status: { Status: 'FAULT' } }))).toBe(true)
    expect(isAbn(row({ status: { Status: 'OFFLINE' } }))).toBe(false)
    expect(isAbn(row({ status: null }))).toBe(false)
  })
})

describe('storeyClipZ — 층 단면 상한은 같은 동의 다음 층', () => {
  const list: Storey[] = [{ name: '2F', z: 5, building: '업무동' }, { name: 'P3F', z: 6, building: '주차타워' }, { name: 'P2F', z: 3, building: '주차타워' }, { name: '1F', z: 0, building: '업무동' }, { name: 'P1F', z: 0, building: '주차타워' }]
  it('본동 1F: 사이에 낀 P2F(3m) 를 무시하고 2F(5m) 까지', () => expect(storeyClipZ(list, '1F')).toEqual([0, 5]))
  it('P1F: 표고가 같은 본동 1F 가 아니라 P2F 까지', () => expect(storeyClipZ(list, 'P1F')).toEqual([0, 3]))
  it('같은 동 최상층은 +3.5', () => expect(storeyClipZ(list, 'P3F')).toEqual([6, 9.5]))
  it('동 정보가 없는 모델(실무 IFC)은 전체를 한 동으로', () => expect(storeyClipZ([{ name: 'L1', z: 0, building: null }, { name: 'L2', z: 4, building: null }], 'L1')).toEqual([0, 4]))
})
