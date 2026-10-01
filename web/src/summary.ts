import type { Model } from './api'

/** 홈 머리 줄 합계 — 경보 · 장애 · 열린 작업지시 */
export const summary = (ms: Model[]) => ms.reduce((s, m) => ({
  alarms: s.alarms + (m.alarms ?? 0), faults: s.faults + (m.faults ?? 0), openWorkOrders: s.openWorkOrders + (m.openWorkOrders ?? 0),
}), { alarms: 0, faults: 0, openWorkOrders: 0 })
