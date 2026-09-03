import { useEffect } from 'react'
import { T } from './theme'

/** 화면 공용 잔재주: 날짜, 점검 지연 규칙, Esc 훅, 버튼·입력 기본 스타일 */

/** API 의 date 는 ISO 타임스탬프 문자열로 온다 → YYYY-MM-DD */
export const day = (s?: string | null) => s ? s.slice(0, 10) : ''
/** 로컬 자정 기준 오늘 — toISOString(UTC)이면 KST 00~09시에 어제가 되어 지연 판정이 하루 어긋난다 */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
/** 시각 표기는 이 두 개만 — 화면마다 toLocale*() 직접 호출 금지 (로케일·12시제가 브라우저마다 갈린다) */
export const hm = (s: string | number | Date) => new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
export const hms = (s: string | number | Date) => new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const dateTime = (s: string | number | Date) => new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short', hour12: false })
/** 점검 주기를 넘긴 자산 — ACTIVE 만 (폐기·사용 중지 자산은 지연으로 안 센다). 모니터링·자산 대장이 같은 규칙 */
export const inspectionOverdue = (nextDueOn?: string | null, assetStatus?: string | null) => !!nextDueOn && nextDueOn < today() && assetStatus === 'ACTIVE'
/** 기한을 넘긴 열린 작업지시 — 점검 지연과 같은 날짜 문자열 비교 규칙. 용어: 점검=지연, 작업지시=기한 초과 */
export const woOverdue = (dueOn?: string | null, status?: string) => !!dueOn && status !== 'DONE' && day(dueOn) < today()

/** Esc 로 닫기 (모달·Drawer·측정 모드) */
export const useEsc = (fn: () => void) => useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fn() }; addEventListener('keydown', h); return () => removeEventListener('keydown', h) }, [fn])

export const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: `1px solid ${T.bg.line}`, borderRadius: T.radius, background: T.bg.raised, cursor: 'pointer', fontSize: T.fs.sm, color: T.ink[1], textDecoration: 'none' } as const
/** 주 동작 하나(등록·생성·저장). 채움 위 글자는 어두운 bg.base — 규칙 */
export const btnPrimary = { ...btn, background: T.accent, color: T.bg.base, border: 0, fontWeight: T.fw.bold } as const
/** 상태·구분 배지: 같은 색 글자 + 16% 배경. 정상은 배지 대신 텍스트(status.isQuiet) */
export const badge = (color: string) => ({ padding: '0 7px', borderRadius: T.pill, fontSize: T.fs.xs, fontWeight: T.fw.bold, color, background: color + '29', whiteSpace: 'nowrap' as const, lineHeight: '18px' })
export const inp = { padding: '5px 8px', border: `1px solid ${T.bg.line}`, borderRadius: T.radius, fontSize: T.fs.md, background: T.bg.base, color: T.ink[1] } as const
