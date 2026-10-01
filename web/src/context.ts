/** 객체 맥락: 세 화면(뷰어·모니터링·시설관리)이 같은 객체를 끌고 다니기 위한 순수 헬퍼. 상태는 URL `?sel=` 하나뿐 */

export const selQ = (gid?: string | null, extra = '') => gid ? `?sel=${encodeURIComponent(gid)}${extra}` : ''
/** 한 객체를 세 화면에서 여는 링크. 뷰어만 focus=1 (구역 강조 + 비콘) */
export const objLinks = (modelId: string, gid: string) => ({
  viewer: `#/models/${modelId}${selQ(gid, '&focus=1')}`, monitor: `#/models/${modelId}/monitor${selQ(gid)}`, fm: `#/models/${modelId}/fm${selQ(gid)}` })

/** replaceState 는 hashchange 를 안 내므로 상단 바에 따로 알린다(Shell.tsx) */
export const notify = () => dispatchEvent(new Event('objctx'))
