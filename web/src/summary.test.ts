import { describe, expect, it } from 'vitest'
import { summary } from './summary'
import type { Model } from './api'

const m = (o: Partial<Model>): Model => ({ id: 'x', name: 'x', status: 'READY', progress: 100, ...o })

describe('summary — 홈 합계', () => {
  it('경보·장애·열린 작업지시를 더한다', () => {
    const s = summary([m({ alarms: 2, faults: 1, openWorkOrders: 3 }), m({ alarms: 0, faults: 2 }), m({ status: 'PROCESSING' })])
    expect(s).toEqual({ alarms: 2, faults: 3, openWorkOrders: 3 })
  })
  it('빈 목록은 전부 0', () => {
    expect(summary([])).toEqual({ alarms: 0, faults: 0, openWorkOrders: 0 })
  })
})
