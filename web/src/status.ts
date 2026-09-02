/** 운영 상태(Pset_BimStatus.Status) → 라벨·의미색. 모니터링·상태판·뷰어 색상 모드·속성 패널·이벤트 목록·경보 토스트가 전부 이 표 하나를 쓴다.
 *  (전에는 다섯 벌이 따로 있어 키 집합과 색이 서로 달랐다) */
export const STATUS: Record<string, { label: string; color: number }> = {
  NORMAL: { label: '정상', color: 0x16a34a }, OK: { label: '정상', color: 0x16a34a }, ONLINE: { label: '온라인', color: 0x16a34a }, RUNNING: { label: '운전', color: 0x16a34a },
  STANDBY: { label: '대기', color: 0x6b7280 }, TRANSFERRED: { label: '절체', color: 0xea580c },
  ALARM: { label: '경보', color: 0xdc2626 }, FAULT: { label: '장애', color: 0xf59e0b }, TROUBLE: { label: '장애', color: 0xf59e0b }, OFFLINE: { label: '오프라인', color: 0xf59e0b },
  OFF: { label: '꺼짐', color: 0x9ca3af }, UTILITY: { label: '한전', color: 0x2563eb }, GENERATOR: { label: '발전기', color: 0xea580c },
}
export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
export const statusLabel = (s?: string | null) => STATUS[s ?? '']?.label ?? s ?? ''
export const statusHex = (s?: string | null, fallback = '#9ca3af') => { const x = STATUS[s ?? '']; return x ? hex(x.color) : fallback }
/** 라벨 + CSS 색 묶음 (없는 상태면 undefined — 호출부가 '—' 등으로 대체) */
export const statusUi = (s?: string | null) => { const x = STATUS[s ?? '']; return x ? { label: x.label, color: hex(x.color) } : undefined }
/** 작업지시가 생기는 이상 상태 */
export const isAbnormal = (s?: string | null) => s === 'ALARM' || s === 'FAULT'

/** 작업지시 상태 → 한글 (칸반 열 이름·뱃지·이벤트 목록) */
export const WO_STATUS = { OPEN: '대기', IN_PROGRESS: '진행', DONE: '완료' } as const
export type WoStatus = keyof typeof WO_STATUS
