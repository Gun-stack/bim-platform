/** 객체 맥락: 세 화면(뷰어·모니터링·시설관리)이 같은 객체를 끌고 다니기 위한 순수 헬퍼와 세션 캐시.
 *  상태는 URL `?sel=` 하나뿐이고, 여기 sessionStorage 는 최근 목록과 3D 스냅샷 캐시(탭 단위) */

export type Recent = { gid: string; name: string }
export const RECENT_MAX = 5, SNAP_MAX = 20

/** 앞에 넣고 같은 항목은 제거(= 맨 앞으로 이동), max 를 넘는 꼬리는 evicted 로 돌려준다 */
export const pushCapped = <T,>(list: T[], item: T, max: number, same: (a: T, b: T) => boolean): { list: T[]; evicted: T[] } => {
  const next = [item, ...list.filter(x => !same(x, item))]
  return { list: next.slice(0, max), evicted: next.slice(max) }
}

/** object-fit: cover 와 같은 가운데 크롭 사각형 (원본 sw×sh 에서 w×h 비율로) */
export const coverRect = (sw: number, sh: number, w: number, h: number) => {
  const scale = Math.max(w / sw, h / sh), cw = Math.round(w / scale), ch = Math.round(h / scale)
  return { sx: Math.round((sw - cw) / 2), sy: Math.round((sh - ch) / 2), sw: cw, sh: ch }
}

export const selQ = (gid?: string | null, extra = '') => gid ? `?sel=${encodeURIComponent(gid)}${extra}` : ''
/** 한 객체를 세 화면에서 여는 링크. 뷰어만 focus=1 (구역 강조 + 비콘) */
export const objLinks = (modelId: string, gid: string) => ({
  viewer: `#/models/${modelId}${selQ(gid, '&focus=1')}`, monitor: `#/models/${modelId}/monitor${selQ(gid)}`, fm: `#/models/${modelId}/fm${selQ(gid)}` })

const read = <T,>(key: string, fallback: T): T => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback } }
const write = (key: string, v: unknown) => { try { sessionStorage.setItem(key, JSON.stringify(v)) } catch { /* 저장 불가 환경·용량 초과 — 캐시라 무시 */ } }

export const getRecent = (modelId: string): Recent[] => read(`recent:${modelId}`, [])
export const pushRecent = (modelId: string, r: Recent) => write(`recent:${modelId}`, pushCapped(getRecent(modelId), r, RECENT_MAX, (a, b) => a.gid === b.gid).list)

export const getSnap = (modelId: string, gid: string): string | undefined => { try { return sessionStorage.getItem(`snap:${modelId}:${gid}`) ?? undefined } catch { return undefined } }
/** 스냅샷 저장 + 색인(snaps:{model}) 갱신. 20개를 넘는 오래된 것은 지운다 */
export const saveSnap = (modelId: string, gid: string, dataUrl: string) => {
  const { list, evicted } = pushCapped(read<string[]>(`snaps:${modelId}`, []), gid, SNAP_MAX, (a, b) => a === b)
  try { sessionStorage.setItem(`snap:${modelId}:${gid}`, dataUrl); for (const g of evicted) sessionStorage.removeItem(`snap:${modelId}:${g}`) } catch { /* 무시 */ }
  write(`snaps:${modelId}`, list)
}

/** replaceState 는 hashchange 를 안 내므로 독에게 따로 알린다 */
export const notify = () => dispatchEvent(new Event('objctx'))
