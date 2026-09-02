import { useEffect } from 'react'

/** 화면 공용 잔재주: 날짜, 점검 지연 규칙, Esc 훅, 버튼·입력 기본 스타일 */

/** API 의 date 는 ISO 타임스탬프 문자열로 온다 → YYYY-MM-DD */
export const day = (s?: string | null) => s ? s.slice(0, 10) : ''
export const today = () => new Date().toISOString().slice(0, 10)
/** 점검 주기를 넘긴 자산 — ACTIVE 만 (폐기·중지 자산은 지연으로 안 센다). 모니터링·자산 대장이 같은 규칙 */
export const inspectionOverdue = (nextDueOn?: string | null, assetStatus?: string | null) => !!nextDueOn && nextDueOn < today() && assetStatus === 'ACTIVE'

/** Esc 로 닫기 (모달·Drawer·측정 모드) */
export const useEsc = (fn: () => void) => useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fn() }; addEventListener('keydown', h); return () => removeEventListener('keydown', h) }, [fn])

export const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 12, color: '#222', textDecoration: 'none' } as const
export const inp = { padding: '5px 8px', border: '1px solid #ddd', borderRadius: 6, fontSize: 13 } as const
