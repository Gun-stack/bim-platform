import { describe, expect, it } from 'vitest'
import { keyAction, isTyping, FLY, KEYS } from './keys'

const ev = (code: string, o: Partial<{ key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean; target: EventTarget | null }> = {}) =>
  ({ code, key: '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, target: null, ...o })

describe('keyAction — code 기준 단발 액션', () => {
  it('뷰·표시·도구 키', () => {
    expect(keyAction(ev('Home'))).toBe('home')
    expect(keyAction(ev('KeyF'))).toBe('fit')
    expect(keyAction(ev('Digit1'))).toBe('front'); expect(keyAction(ev('Numpad1'))).toBe('front')
    expect(keyAction(ev('Digit3'))).toBe('side')
    expect(keyAction(ev('Digit7'))).toBe('top')
    expect(keyAction(ev('KeyI'))).toBe('isolate')
    expect(keyAction(ev('KeyC'))).toBe('clip')
    expect(keyAction(ev('KeyM'))).toBe('measure')
    expect(keyAction(ev('KeyN'))).toBe('snap')
    expect(keyAction(ev('KeyG'))).toBe('grid')
    expect(keyAction(ev('KeyP'))).toBe('colors')
    expect(keyAction(ev('KeyL'))).toBe('share')
    expect(keyAction(ev('KeyB'))).toBe('struct')
    expect(keyAction(ev('KeyO'))).toBe('openings')
    expect(keyAction(ev('KeyZ'))).toBe('spaces')
    expect(keyAction(ev('KeyR'))).toBe('merged')
    expect(keyAction(ev('KeyT'))).toBe('status')
    expect(keyAction(ev('KeyK'))).toBe('systems')
    expect(keyAction(ev('BracketLeft'))).toBe('traceUp')
    expect(keyAction(ev('BracketRight'))).toBe('traceDown')
  })
  it('Tab / Shift+Tab 은 다음 / 이전 요소', () => {
    expect(keyAction(ev('Tab'))).toBe('next')
    expect(keyAction(ev('Tab', { shiftKey: true }))).toBe('prev')
    expect(keyAction(ev('Tab', { target: { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget }))).toBeUndefined()   // 입력란에선 브라우저 포커스 이동
  })
  it('H 는 수정자에 따라 숨김 / 선택만 보기 / 모두 표시', () => {
    expect(keyAction(ev('KeyH'))).toBe('hide')
    expect(keyAction(ev('KeyH', { shiftKey: true }))).toBe('solo')
    expect(keyAction(ev('KeyH', { altKey: true }))).toBe('showAll')
    expect(keyAction(ev('KeyI', { altKey: true }))).toBeUndefined()   // Alt 는 H 만
  })
  it('? 는 key 로 판정 (Shift+/ 라 code 가 레이아웃마다 다름)', () => {
    expect(keyAction(ev('Slash', { key: '?', shiftKey: true }))).toBe('help')
  })
  it('Ctrl/Cmd 조합과 입력란 포커스는 무시 — 브라우저 단축키·타이핑 보존', () => {
    expect(keyAction(ev('KeyF', { ctrlKey: true }))).toBeUndefined()
    expect(keyAction(ev('KeyL', { metaKey: true }))).toBeUndefined()
    const input = { tagName: 'INPUT', isContentEditable: false } as unknown as EventTarget
    expect(keyAction(ev('KeyF', { target: input }))).toBeUndefined()
    expect(keyAction(ev('Slash', { key: '?', target: input }))).toBeUndefined()
    expect(isTyping({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isTyping({ tagName: 'DIV', isContentEditable: false } as unknown as EventTarget)).toBe(false)
    expect(isTyping(null)).toBe(false)
  })
  it('연속 키 집합과 안내 표', () => {
    for (const c of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Equal', 'Minus', 'ShiftLeft', 'ShiftRight']) expect(FLY.has(c)).toBe(true)
    expect(keyAction(ev('KeyW'))).toBeUndefined()   // 연속 키는 단발 액션이 아니다
    expect(KEYS.length).toBeGreaterThan(10)
  })
})
