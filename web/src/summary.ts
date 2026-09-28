import type { Model } from './api'

/** 홈 머리 줄 합계 — 모델 · 요소 · 경보 · 장애 · 열린 작업지시 */
export const summary = (ms: Model[]) => ms.reduce((s, m) => ({
  models: s.models + 1, elements: s.elements + (m.elementCount ?? 0), alarms: s.alarms + (m.alarms ?? 0), faults: s.faults + (m.faults ?? 0), openWorkOrders: s.openWorkOrders + (m.openWorkOrders ?? 0),
}), { models: 0, elements: 0, alarms: 0, faults: 0, openWorkOrders: 0 })
