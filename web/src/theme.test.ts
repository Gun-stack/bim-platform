/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { T } from './theme'

/** index.css 의 :root 변수는 theme.ts 의 사본 — 어긋나면 첫 페인트·지도 팝업 색이 화면과 달라진다 */
describe('theme — CSS 변수 사본 일치', () => {
  it('index.css :root 값이 T 와 같다', () => {
    const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')
    const vars = Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]))
    expect(vars).toEqual({ 'bg-base': T.bg.base, 'bg-surface': T.bg.surface, 'bg-raised': T.bg.raised, 'bg-line': T.bg.line, 'ink-1': T.ink[1], 'ink-2': T.ink[2], 'ink-3': T.ink[3], accent: T.accent, crit: T.crit })
  })
  it('대비: 본문·보조 글자와 상태색이 surface 위에서 AA(4.5), 채움 위 글자는 bg.base', () => {
    const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    for (const c of [T.ink[1], T.ink[2], T.accent, T.ok, T.warn, T.crit, ...Object.values(T.team)]) expect(ratio(c, T.bg.surface)).toBeGreaterThanOrEqual(4.5)
    for (const fill of [T.accent, T.ok, T.warn, T.crit]) expect(ratio(T.bg.base, fill)).toBeGreaterThanOrEqual(4.5)
  })
})
