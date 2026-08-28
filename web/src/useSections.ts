import { useState } from 'react'

/** 섹션 펼침 상태를 localStorage 에 기억 */
export function useSections<K extends string>(key: string, defaults: Record<K, boolean>) {
  const [open, setOpen] = useState<Record<K, boolean>>(() => { try { return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') } } catch { return defaults } })
  const toggle = (k: K) => setOpen(o => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem(key, JSON.stringify(n)) } catch { /* 저장 불가 환경 */ } return n })
  return [open, toggle] as const
}
