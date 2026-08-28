/** Pset_BimStatus 계측값 사전 — 모니터 행·툴팁·속성 패널이 공유. order 가 작을수록 앞에(대표값). warn/crit 는 (값) => 이상 여부 */
export type Reading = { label: string; unit?: string; order: number; warn?: (v: number) => boolean; crit?: (v: number) => boolean; fmt?: (v: unknown) => string }
export const READINGS: Record<string, Reading> = {
  LoadPercent: { label: '부하', unit: '%', order: 1, warn: v => v >= 80, crit: v => v >= 95 },
  LevelPercent: { label: '수위', unit: '%', order: 1, warn: v => v < 30, crit: v => v < 15 },
  FuelLevel: { label: '연료', unit: '%', order: 1, warn: v => v < 40, crit: v => v < 20 },
  COppm: { label: 'CO', unit: 'ppm', order: 1, warn: v => v >= 25, crit: v => v >= 50 },
  Pressure: { label: '압력', unit: 'MPa', order: 1, warn: v => v < 0.3 },
  PressureMPa: { label: '압력', unit: 'MPa', order: 1, warn: v => v < 3.5 },
  PressureBar: { label: '압력', unit: 'bar', order: 1, warn: v => v < 1.0 || v > 3.5 },
  OutletKPa: { label: '2차압', unit: 'kPa', order: 1, warn: v => v < 2.0 || v > 3.0 },
  OilTemp: { label: '유온', unit: '°C', order: 2, warn: v => v >= 70, crit: v => v >= 85 },
  OutletTemp: { label: '출구', unit: '°C', order: 1 },
  SupplyTemp: { label: '급기', unit: '°C', order: 1 },
  CHWSupplyTemp: { label: '냉수', unit: '°C', order: 1, warn: v => v > 9 },
  RoomTemp: { label: '실온', unit: '°C', order: 1, warn: v => v < 18 || v > 28 },
  SetTemp: { label: '설정', unit: '°C', order: 3 },
  Temp: { label: '온도', unit: '°C', order: 1 },
  DeltaT: { label: 'ΔT', unit: '°C', order: 1, warn: v => v < 3 },
  DiffPressure: { label: '차압', unit: 'bar', order: 1, warn: v => v >= 0.25 },
  SpeedPercent: { label: '회전', unit: '%', order: 2 },
  FanSpeed: { label: '팬', unit: '%', order: 2, fmt: v => typeof v === 'number' ? `${v}%` : String(v) },
  DamperPercent: { label: '댐퍼', unit: '%', order: 2 },
  OpenPercent: { label: '개도', unit: '%', order: 1 },
  ChargePercent: { label: '충전', unit: '%', order: 1, warn: v => v < 50, crit: v => v < 20 },
  BatteryLevel: { label: '배터리', unit: '%', order: 1, warn: v => v < 50, crit: v => v < 20 },
  OutputKW: { label: '출력', unit: 'kW', order: 1 },
  DemandKW: { label: '수요', unit: 'kW', order: 1 },
  kWh: { label: '누적', unit: 'kWh', order: 3, fmt: v => Number(v).toLocaleString() },
  COP: { label: 'COP', order: 2, warn: v => v < 3 },
  EarthOhm: { label: '접지', unit: 'Ω', order: 1, warn: v => v > 10 },
  RunHours: { label: '운전', unit: 'h', order: 3, fmt: v => Number(v).toLocaleString() },
  RunCount: { label: '운행', unit: '회', order: 3, fmt: v => Number(v).toLocaleString() },
  Cycles: { label: '개폐', unit: '회', order: 3, fmt: v => Number(v).toLocaleString() },
  CashLevel: { label: '지폐', unit: '%', order: 1, warn: v => v > 90 },
  Occupied: { label: '점유', order: 1, fmt: v => typeof v === 'boolean' ? (v ? '점유' : '공차') : String(v) },
  Capacity: { label: '면', order: 2 }, TodayIn: { label: '입차', unit: '대', order: 3 }, TodayOut: { label: '출차', unit: '대', order: 3 },
  ActiveAlarms: { label: '경보', order: 1, warn: v => v > 0 }, Faults: { label: '장애', order: 1, warn: v => v > 0 },
  Points: { label: '포인트', order: 3 }, Cameras: { label: '카메라', unit: '대', order: 2 }, Uplink: { label: '업링크', order: 3 },
  Floor: { label: '층', order: 1 }, Direction: { label: '방향', order: 2, fmt: v => ({ UP: '상행', DOWN: '하행', IDLE: '정지' } as Record<string, string>)[String(v)] ?? String(v) },
  Open: { label: '개폐', order: 1, fmt: v => v ? '열림' : '닫힘' }, On: { label: '점등', order: 1, fmt: v => v ? '점등' : '소등' }, Charging: { label: '충전', order: 1, fmt: v => v ? '충전 중' : '대기' }, OnBattery: { label: '배터리 운전', order: 1, fmt: v => v ? '예' : '아니오', warn: v => !!v },
  Breaker: { label: '차단기', order: 1, fmt: v => ({ CLOSED: '투입', OPEN: '트립' } as Record<string, string>)[String(v)] ?? String(v) }, Source: { label: '전원', order: 1, fmt: v => ({ UTILITY: '한전', GENERATOR: '발전기' } as Record<string, string>)[String(v)] ?? String(v) },
  Scene: { label: '씬', order: 3 }, Text: { label: '표시', order: 1 }, LastTest: { label: '점검', order: 4 }, AlarmAt: { label: '발생', order: 4 },
}
const SKIP = new Set(['Status', 'UpdatedAt'])
export type Shown = { key: string; label: string; text: string; level: 'ok' | 'warn' | 'crit'; order: number }
/** 요소의 상태에서 표시할 값들 (order → 키 순). 사전에 없는 키도 이름 그대로 뒤에 */
/** 이름으로 기준이 뒤집히는 것: 집수정·오수·우수 저류조는 수위가 '높을수록' 이상 */
const INVERT_LEVEL = /집수정|오수|우수|저류|배수/
export const readings = (st: Record<string, unknown> | null | undefined, name?: string | null): Shown[] => {
  if (!st) return []
  return Object.entries(st).filter(([k, v]) => !SKIP.has(k) && v != null && v !== '').map(([k, v]) => {
    let r = READINGS[k]; const n = typeof v === 'number' ? v : NaN
    if (k === 'LevelPercent' && name && INVERT_LEVEL.test(name)) r = { ...r, warn: x => x >= 70, crit: x => x >= 90 }
    const level: Shown['level'] = r?.crit && !Number.isNaN(n) && r.crit(n) ? 'crit' : r?.warn && (typeof v === 'boolean' ? r.warn(v ? 1 : 0) : !Number.isNaN(n) && r.warn(n)) ? 'warn' : 'ok'
    const text = r?.fmt ? r.fmt(v) : typeof v === 'number' ? `${Number.isInteger(v) ? v : v.toFixed(1)}${r?.unit ?? ''}` : String(v)
    return { key: k, label: r?.label ?? k, text, level, order: r?.order ?? 5 } })
    .sort((a, b) => a.order - b.order)
}
/** 행 인라인용: 이력성(order ≥ 4: 점검일·발생시각) 제외 */
export const inlineReadings = (st: Record<string, unknown> | null | undefined, name?: string | null) => readings(st, name).filter(x => x.order < 4)
export const LEVEL_COLOR = { ok: '#555', warn: '#b45309', crit: '#b91c1c' } as const
