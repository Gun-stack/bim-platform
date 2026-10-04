import { useEffect, useRef } from 'react'
import { T } from './theme'

/** 화면 공용 잔재주: 날짜, 점검 지연 규칙, Esc 훅, 버튼·입력 기본 스타일 */

/** API 의 date 는 ISO 타임스탬프 문자열로 온다 → YYYY-MM-DD */
export const day = (s?: string | null) => s ? s.slice(0, 10) : ''
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** 로컬 자정 기준 오늘 — toISOString(UTC)이면 KST 00~09시에 어제가 되어 지연 판정이 하루 어긋난다 */
export const today = () => ymd(new Date())
export const plusDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
/** 시각 표기는 이 두 개만 — 화면마다 toLocale*() 직접 호출 금지 (로케일·12시제가 브라우저마다 갈린다) */
export const hm = (s: string | number | Date) => new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
export const hms = (s: string | number | Date) => new Date(s).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
export const dateTime = (s: string | number | Date) => new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short', hour12: false })
/** '마지막 이벤트' 표기 — 오늘이면 HH:MM:SS, 아니면 오래된 걸 방금처럼 보이지 않게 M/D HH:MM */
export const hmsOrDate = (s: string | number | Date) => { const d = new Date(s), n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate() ? hms(d) : `${d.getMonth() + 1}/${d.getDate()} ${hm(d)}` }
/** 점검 주기를 넘긴 자산 — ACTIVE 만 (폐기·사용 중지 자산은 지연으로 안 센다). 모니터링·자산 대장이 같은 규칙 */
export const inspectionOverdue = (nextDueOn?: string | null, assetStatus?: string | null) => !!nextDueOn && nextDueOn < today() && assetStatus === 'ACTIVE'
/** 기한을 넘긴 열린 작업지시 — 점검 지연과 같은 날짜 문자열 비교 규칙. 용어: 점검=지연, 작업지시=기한 초과 */
export const woOverdue = (dueOn?: string | null, status?: string) => !!dueOn && status !== 'DONE' && day(dueOn) < today()

/** Esc 로 닫기 (모달·Drawer·측정 모드) */
export const useEsc = (fn: () => void) => useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') fn() }; addEventListener('keydown', h); return () => removeEventListener('keydown', h) }, [fn])

/** Esc 층 쌓기(B301) — 뷰어 위에 뜨는 층(우클릭 메뉴·색 메뉴·단축키 안내·측정 패널·둘러보기 카드)이 겹치면
 *  Esc 한 번은 가장 위(가장 최근에 연) 층만 닫는다. 층이 하나도 없을 때만 그 아래(씬의 선택 해제 등)가 자기 Esc 를 쓴다.
 *  층마다 따로 keydown 을 달면 한 번의 Esc 에 여럿이 반응한다 — 전역 리스너 하나(아래)가 스택 top 만 부른다 */
let escLayers: (() => void)[] = []
/** 층을 하나 연다 — 반환한 함수를 닫힐 때(effect cleanup) 불러 스택에서 뺀다. 테스트용 순수 함수 */
export const pushEscLayer = (close: () => void) => { escLayers = [...escLayers, close]; return () => { escLayers = escLayers.filter(f => f !== close) } }
/** 지금 열린 층이 있는가 — scene.ts 의 Escape(선택 해제)가 "층이 없을 때만" 동작하도록 쓴다 */
export const hasEscLayer = () => escLayers.length > 0
/** 가장 위 층만 닫는다. 테스트용 순수 함수 — 실제 입력은 아래 전역 keydown 하나뿐 */
export const fireEsc = () => escLayers[escLayers.length - 1]?.()
if (typeof window !== 'undefined') addEventListener('keydown', e => { if (e.key === 'Escape' && escLayers.length) { e.stopPropagation(); fireEsc() } }, true)   // capture: scene.ts·Tour 등 bubble 리스너보다 먼저 가로챈다

/** 캔버스 위 층 하나 — active 인 동안 스택에 쌓인다. close 는 매 렌더 새 함수라도 괜찮다(ref 로 최신 것만 쓴다 — ContextMenu 재구독 버그 재발 방지) */
export const useEscLayer = (active: boolean, close: () => void) => {
  const ref = useRef(close)
  useEffect(() => { ref.current = close })   // 렌더 중이 아니라 effect 안에서 — 매 렌더 새 close 라도 아래 구독 effect 는 active 가 바뀔 때만 다시 돈다
  useEffect(() => { if (!active) return; return pushEscLayer(() => ref.current()) }, [active])
}

export const btn = { display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', border: `1px solid ${T.bg.line}`, borderRadius: T.radius, background: T.bg.raised, cursor: 'pointer', fontSize: T.fs.sm, color: T.ink[1], textDecoration: 'none' } as const
/** 주 동작 하나(등록·생성·저장). 채움 위 글자는 어두운 bg.base — 규칙 */
export const btnPrimary = { ...btn, background: T.accent, color: T.bg.base, border: 0, fontWeight: T.fw.bold } as const
/** 상태·구분 배지: 같은 색 글자 + 16% 배경. 정상은 배지 대신 텍스트(status.isQuiet) */
export const badge = (color: string) => ({ padding: '0 7px', borderRadius: T.pill, fontSize: T.fs.xs, fontWeight: T.fw.bold, color, background: color + '29', whiteSpace: 'nowrap' as const, lineHeight: '18px' })
export const inp = { padding: '5px 8px', border: `1px solid ${T.bg.line}`, borderRadius: T.radius, fontSize: T.fs.md, background: T.bg.base, color: T.ink[1], boxSizing: 'border-box' } as const
