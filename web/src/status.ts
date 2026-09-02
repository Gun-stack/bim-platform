import { T, num } from './theme'

/** 운영 상태(Pset_BimStatus.Status) → 라벨·의미색. 모니터링·상태판·뷰어 색상 모드·속성 패널·이벤트 목록·경보 토스트가 전부 이 표 하나를 쓴다.
 *  (전에는 다섯 벌이 따로 있어 키 집합과 색이 서로 달랐다) */
const ok = num(T.ok), warn = num(T.warn), crit = num(T.crit), quiet = num(T.ink[3])
export const STATUS: Record<string, { label: string; color: number }> = {
  NORMAL: { label: '정상', color: ok }, OK: { label: '정상', color: ok }, ONLINE: { label: '온라인', color: ok }, RUNNING: { label: '운전', color: ok },
  STANDBY: { label: '대기', color: quiet }, TRANSFERRED: { label: '절체', color: warn },
  ALARM: { label: '경보', color: crit }, FAULT: { label: '장애', color: warn }, TROUBLE: { label: '장애', color: warn }, OFFLINE: { label: '오프라인', color: warn },
  OFF: { label: '꺼짐', color: quiet }, UTILITY: { label: '한전', color: num(T.accent) }, GENERATOR: { label: '발전기', color: warn },
}
export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
export const statusLabel = (s?: string | null) => STATUS[s ?? '']?.label ?? s ?? ''
export const statusHex = (s?: string | null, fallback: string = T.ink[3]) => { const x = STATUS[s ?? '']; return x ? hex(x.color) : fallback }
/** 정상 계열(무색으로 그린다)인지 — 배지는 이상만 */
export const isQuiet = (s?: string | null) => [ok, quiet].includes(STATUS[s ?? '']?.color ?? -1)
/** 라벨 + CSS 색 묶음 (없는 상태면 undefined — 호출부가 '—' 등으로 대체) */
export const statusUi = (s?: string | null) => { const x = STATUS[s ?? '']; return x ? { label: x.label, color: hex(x.color) } : undefined }
/** 작업지시가 생기는 이상 상태 */
export const isAbnormal = (s?: string | null) => s === 'ALARM' || s === 'FAULT'

/** 작업지시 상태 → 한글 (칸반 열 이름·뱃지·이벤트 목록) */
export const WO_STATUS = { OPEN: '대기', IN_PROGRESS: '진행', DONE: '완료' } as const
export type WoStatus = keyof typeof WO_STATUS
