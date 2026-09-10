# 3D 뷰어 키보드 단축키 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#/models/:id` 3D 뷰어에서 마우스 없이 카메라 조작(WASD/QE 비행·방향키 회전·± 줌)과 툴바 액션 전부를 일반 3D 툴 관례의 키로 실행.

**Architecture:** 연속 입력은 `Scene3D`(scene.ts) 가 `keys` Set 으로 받아 rAF 루프의 `fly(dt)` 에서 카메라를 움직인다. 단발 액션은 순수 함수 `keyAction(e)`(keys.ts) 가 `KeyboardEvent` → 액션 id 로 바꾸고, `Viewer.tsx` 의 keydown effect 하나가 기존 핸들러를 호출한다. 안내 오버레이 `Shortcuts.tsx` 는 `KEYS` 표를 렌더.

**Tech Stack:** React 19, three.js 0.185 (OrbitControls), TypeScript 6, vitest 4, oxlint. 헤드리스 검증은 puppeteer-core(web/node_modules) + 로컬 Chrome.

## Global Constraints

- 새 의존성 추가 없음
- 키 판정은 `e.code` (`KeyW`, `Digit1`, `ArrowLeft` …). `?` 와 Escape 만 `e.key`
- 무시 조건: 이벤트 target 이 `INPUT`/`TEXTAREA`/`SELECT`/contentEditable, 또는 `Ctrl`/`Cmd` 눌림. `Alt` 는 `Alt+H` 만 허용
- 이동 속도 = 모델 bounds 대각선 × 0.25 m/s, `Shift` 4배. 회전 90°/s. 줌 초당 약 3배(`exp(1.2·s)`)
- 창 `blur` 시 `keys` 초기화
- `Ctrl+A` 전체 선택·키 리바인딩·넘패드 `+`/`-` 는 범위 밖
- 문서(README) 문체: 불릿 리스트 + 명사형 짧은 구, 서술 문단 금지
- 커밋 메시지는 한국어 요약, 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` 과 `Claude-Session: https://claude.ai/code/session_01WcPtW7XJsiLrBsZ9TcLZ15`
- `docs/learning/` 은 커밋 금지 (untracked 로 둔다)

## File Structure

| 파일 | 책임 |
|---|---|
| `web/src/viewer/keys.ts` (신규) | `KEYS` 안내 표, `Action` 타입, `keyAction(e)`, `isTyping(target)`. DOM·React 의존 없음 |
| `web/src/viewer/keys.test.ts` (신규) | `keyAction` 단위 테스트 (vitest, node 환경) |
| `web/src/viewer/Shortcuts.tsx` (신규) | 안내 오버레이 컴포넌트. `KEYS` 만 읽음 |
| `web/src/viewer/scene.ts` | `keys` Set + `fly(dt)` — 연속 카메라 조작 |
| `web/src/viewer/chrome.tsx` | `Tool` 에 `keys` prop, 툴팁 표기 |
| `web/src/viewer/Viewer.tsx` | keydown effect, `showKeys` 상태, `showAll` 추출, 툴바·메뉴에 키 표기 |
| `README.md` | 단축키 표 |

---

### Task 1: keyAction 순수 함수 + 단위 테스트

**Files:**
- Create: `web/src/viewer/keys.ts`
- Test: `web/src/viewer/keys.test.ts`

**Interfaces:**
- Produces:
  - `export type Action = 'home' | 'fit' | 'front' | 'side' | 'top' | 'isolate' | 'hide' | 'solo' | 'showAll' | 'clip' | 'measure' | 'snap' | 'grid' | 'colors' | 'share' | 'help'`
  - `export function keyAction(e: KeyLike): Action | undefined`
  - `export const isTyping: (t: EventTarget | null) => boolean`
  - `export const KEYS: { group: string; keys: string; label: string }[]`
  - `export const FLY: Set<string>` — scene 이 연속 처리하는 code 집합

- [ ] **Step 1: 실패하는 테스트 작성**

`web/src/viewer/keys.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

Run: `cd web && npx vitest run src/viewer/keys.test.ts`
Expected: FAIL — `Failed to resolve import "./keys"`

- [ ] **Step 3: 구현**

`web/src/viewer/keys.ts`:

```ts
/** 뷰어 키보드 단축키 — 단일 출처. 안내 오버레이(KEYS)·단발 액션 분기(keyAction)·연속 키 집합(FLY). DOM·React 의존 없음 */

export type Action = 'home' | 'fit' | 'front' | 'side' | 'top' | 'isolate' | 'hide' | 'solo' | 'showAll' | 'clip' | 'measure' | 'snap' | 'grid' | 'colors' | 'share' | 'help'

/** 안내 표 (그룹 순서대로) */
export const KEYS: { group: string; keys: string; label: string }[] = [
  { group: '이동', keys: 'W S', label: '앞 / 뒤 — 카메라와 타깃이 함께 (비행)' },
  { group: '이동', keys: 'A D', label: '좌 / 우' },
  { group: '이동', keys: 'Q E', label: '아래 / 위' },
  { group: '이동', keys: 'Shift', label: '누른 채 이동 4배속' },
  { group: '회전', keys: '← → ↑ ↓', label: '타깃 중심 궤도 회전' },
  { group: '줌', keys: '+ -', label: '타깃 쪽 접근 / 후퇴' },
  { group: '뷰', keys: 'Home', label: '홈 뷰' },
  { group: '뷰', keys: 'F', label: '선택 요소에 맞춤 (없으면 전체)' },
  { group: '뷰', keys: '1 3 7', label: '정면 / 측면 / 평면' },
  { group: '표시', keys: 'I', label: '격리 — 선택 외 반투명' },
  { group: '표시', keys: 'H', label: '선택 숨김' },
  { group: '표시', keys: 'Shift H', label: '선택만 보기' },
  { group: '표시', keys: 'Alt H', label: '숨긴 것 모두 표시 · 격리·솔로 해제' },
  { group: '도구', keys: 'C', label: '단면' },
  { group: '도구', keys: 'M', label: '측정' },
  { group: '도구', keys: 'N', label: '스냅' },
  { group: '도구', keys: 'G', label: '그리드' },
  { group: '도구', keys: 'P', label: '속성별 색상' },
  { group: '기타', keys: 'L', label: '현재 화면 링크 복사' },
  { group: '기타', keys: '?', label: '이 안내' },
  { group: '기타', keys: 'Esc', label: '선택 해제 · 측정 종료 · 안내 닫기' },
]

/** scene 이 프레임마다 보는 연속 키 (keydown 에 Set 추가, keyup 에 제거) */
export const FLY = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Equal', 'Minus', 'ShiftLeft', 'ShiftRight'])

/** 입력란에 타이핑 중이면 단축키 무시 */
export const isTyping = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || !!el.isContentEditable) }

type KeyLike = Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'target'>

/** keydown → 단발 액션. Ctrl/Cmd 조합·입력란은 무시(브라우저 단축키 보존), Alt 는 Alt+H 만. 연속 키는 undefined */
export function keyAction(e: KeyLike): Action | undefined {
  if (e.ctrlKey || e.metaKey || isTyping(e.target)) return
  if (e.key === '?') return 'help'
  if (e.altKey) return e.code === 'KeyH' ? 'showAll' : undefined
  switch (e.code) {
    case 'Home': return 'home'
    case 'KeyF': return 'fit'
    case 'Digit1': case 'Numpad1': return 'front'
    case 'Digit3': case 'Numpad3': return 'side'
    case 'Digit7': case 'Numpad7': return 'top'
    case 'KeyI': return 'isolate'
    case 'KeyH': return e.shiftKey ? 'solo' : 'hide'
    case 'KeyC': return 'clip'
    case 'KeyM': return 'measure'
    case 'KeyN': return 'snap'
    case 'KeyG': return 'grid'
    case 'KeyP': return 'colors'
    case 'KeyL': return 'share'
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd web && npx vitest run src/viewer/keys.test.ts && npm run lint`
Expected: `5 passed`, lint 경고 0

- [ ] **Step 5: 커밋**

```bash
git add web/src/viewer/keys.ts web/src/viewer/keys.test.ts
git commit -m "web: 뷰어 단축키 키맵·keyAction 순수 함수 + 테스트

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcPtW7XJsiLrBsZ9TcLZ15"
```

---

### Task 2: Scene3D 연속 카메라 조작 (WASD/QE · 방향키 · ±)

**Files:**
- Modify: `web/src/viewer/scene.ts` (import 블록, 필드, 생성자 98·102행, `onKey` 321행, `dispose` 323행)

**Interfaces:**
- Consumes: `FLY`, `isTyping` from `./keys`
- Produces: 공개 API 변화 없음. 동작만 추가

- [ ] **Step 1: import 와 필드 추가**

`scene.ts` 5행 `import { NavCube } from './NavCube'` 아래에:

```ts
import { FLY, isTyping } from './keys'
```

67행 `private marker?: THREE.Group` 아래에:

```ts
  private keys = new Set<string>()   // 눌린 연속 키 (code). fly() 가 프레임마다 읽는다
  private last = performance.now()
```

- [ ] **Step 2: 리스너와 루프 수정**

생성자 98행을 교체:

```ts
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey); addEventListener('blur', this.onBlur)
```

102행 loop 를 교체:

```ts
    const loop = () => { this.raf = requestAnimationFrame(loop); const now = performance.now(); this.fly((now - this.last) / 1000); this.last = now; this.controls.update(); this.renderer.render(this.scene, this.camera); this.navCube.sync(this.camera); this.frames++ }
```

- [ ] **Step 3: onKey·onBlur·fly 구현**

321행 `private onKey = …` 한 줄을 교체:

```ts
  /** 키보드: Escape = 선택 해제. 연속 키(WASD·QE·방향키·±·Shift)는 Set 에 담아 fly() 가 프레임마다 본다. 입력란·Ctrl/Cmd/Alt 조합은 무시. 단발 액션 키는 Viewer 가 처리 */
  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keyup') { this.keys.delete(e.code); return }
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Escape') { this.select([]); return }
    if (FLY.has(e.code)) { this.keys.add(e.code); e.preventDefault() }   // 방향키·Shift 의 기본 스크롤 방지
  }
  private onBlur = () => this.keys.clear()   // 키 누른 채 탭 전환 → keyup 을 못 받아 계속 날아가는 것 방지

  /** 키보드 연속 조작: WASD/QE 비행(카메라·타깃 함께), 방향키 궤도 회전, ± 줌. 속도는 모델 크기 비례, Shift 4배 */
  private fly(dt: number) {
    const k = this.keys; if (!k.size || this.box.isEmpty() || dt > 0.5) return   // 탭 복귀 첫 프레임의 큰 dt 는 버린다
    const ax = (neg: string, pos: string) => +k.has(pos) - +k.has(neg)
    const cam = this.camera, t = this.controls.target
    const v = this.box.getSize(new THREE.Vector3()).length() * 0.25 * dt * (k.has('ShiftLeft') || k.has('ShiftRight') ? 4 : 1)
    const fwd = cam.getWorldDirection(new THREE.Vector3()), right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0)
    const move = fwd.multiplyScalar(ax('KeyS', 'KeyW') * v).addScaledVector(right, ax('KeyA', 'KeyD') * v).addScaledVector(cam.up, ax('KeyQ', 'KeyE') * v)
    cam.position.add(move); t.add(move)
    // 회전·줌: 타깃 기준 구면 좌표. 방향 감각은 OrbitControls 키 회전과 동일(← 는 theta 감소, ↑ 는 phi 감소)
    const rot = Math.PI / 2 * dt, off = cam.position.clone().sub(t), sph = new THREE.Spherical().setFromVector3(off)
    sph.theta += ax('ArrowLeft', 'ArrowRight') * rot
    sph.phi = THREE.MathUtils.clamp(sph.phi + ax('ArrowUp', 'ArrowDown') * rot, 0.01, Math.PI - 0.01)   // 극점에서 lookAt 이 무너지지 않게
    sph.radius *= Math.exp(-ax('Minus', 'Equal') * 1.2 * dt)
    cam.position.copy(t).add(off.setFromSpherical(sph))
  }
```

`dispose()` 를 교체:

```ts
  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey); removeEventListener('blur', this.onBlur); this.navCube.dispose(); this.renderer.dispose(); this.el.removeChild(this.renderer.domElement) }
```

- [ ] **Step 4: 타입·린트 확인**

Run: `cd web && npx tsc -b && npm run lint`
Expected: 출력 없음(에러 0), lint 경고 0

- [ ] **Step 5: 헤드리스 확인 스크립트 작성 (저장소 밖, 스크래치패드)**

`web` 개발 서버를 별도 포트로 띄운다 (5173 은 컨테이너가 점유):

```bash
cd web && npm run dev -- --port 5175 > /tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/32714fa5-c24e-4eb4-96dd-c11299637e4e/scratchpad/vite.log 2>&1 &
```

스크래치패드에 `node_modules` 심링크와 스크립트:

```bash
S=/private/tmp/claude-501/-Users-hubilon-map-orca-projects-bim-platform/32714fa5-c24e-4eb4-96dd-c11299637e4e/scratchpad
ln -sfn /Users/hubilon_map/orca/projects/bim-platform/web/node_modules $S/node_modules
```

`$S/keys-check.mjs`:

```js
import puppeteer from 'puppeteer-core'
const MODEL = '32d1ef4f-d6b0-439d-9649-645e47e196b2', BASE = 'http://localhost:5175'
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-gl=angle', '--use-angle=metal', '--no-sandbox'] })
const p = await b.newPage(); await p.setViewport({ width: 1400, height: 900 })
const els = await (await fetch(`${BASE}/api/models/${MODEL}/elements`)).json(), gid = els.find(e => e.ifcClass === 'IfcWall')?.globalId ?? els[0].globalId
await p.goto(`${BASE}/#/models/${MODEL}?sel=${gid}`)
await p.waitForSelector('button[aria-label^="단면"]:not([disabled])', { timeout: 60000 })   // bounds 준비 = glb 로드 완료
await new Promise(r => setTimeout(r, 800))
const view = async () => { await p.keyboard.press('KeyL'); return new URLSearchParams((await p.evaluate(() => location.hash)).split('?')[1]).get('v').split(',').map(Number) }
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exitCode = 1 } else console.log('ok  ', m) }
const v0 = await view()
await p.keyboard.down('KeyW'); await new Promise(r => setTimeout(r, 500)); await p.keyboard.up('KeyW')
const v1 = await view(); assert(v0.slice(0, 3).some((n, i) => Math.abs(n - v1[i]) > 0.5), `W 비행: 카메라 이동 ${v0.slice(0, 3)} → ${v1.slice(0, 3)}`)
assert(v0.slice(3).some((n, i) => Math.abs(n - v1[3 + i]) > 0.5), 'W 비행: 타깃도 함께 이동')
await p.keyboard.down('ArrowLeft'); await new Promise(r => setTimeout(r, 300)); await p.keyboard.up('ArrowLeft')
const v2 = await view(); assert(v1.slice(3).every((n, i) => Math.abs(n - v2[3 + i]) < 0.01) && Math.abs(v1[0] - v2[0]) > 0.1, '← 회전: 타깃 고정, 카메라 이동')
await p.keyboard.press('Digit7'); await new Promise(r => setTimeout(r, 200))
const v3 = await view(); assert(v3[1] > v3[4] + 5 && Math.abs(v3[0] - v3[3]) < 0.5 && Math.abs(v3[2] - v3[5]) < 0.5, `7 평면: 카메라가 타깃 위 ${v3}`)
await p.keyboard.down('Minus'); await new Promise(r => setTimeout(r, 300)); await p.keyboard.up('Minus')
const v4 = await view(); assert(v4[1] - v4[4] > v3[1] - v3[4], '- 줌아웃: 거리 증가')
await p.keyboard.press('Home'); await new Promise(r => setTimeout(r, 200))
const v5 = await view(); assert(Math.abs(v5[1] - v5[4]) < v5[0] - v5[3] + 1, 'Home: 홈 뷰(사선)')
await p.keyboard.press('KeyH'); await new Promise(r => setTimeout(r, 300))
assert(!(await p.evaluate(() => location.hash)).includes('sel='), 'H: 선택 숨김 → 선택 해제(URL sel 제거)')
await p.keyboard.press('?'); await new Promise(r => setTimeout(r, 200))
assert(await p.$('text/키보드 단축키') !== null, '?: 안내 오버레이')
await p.screenshot({ path: process.argv[2] ?? 'keys-overlay.png' })
await p.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 200))
assert(await p.$('text/키보드 단축키') === null, 'Esc: 안내 닫힘')
await b.close()
```

이 Task 에서는 `Digit7`·`Home`·`H`·`?` 는 아직 동작하지 않으므로 앞 4개(W·←·-)만 통과하면 된다. 나머지는 Task 4 에서 전부 통과.

Run: `cd $S && node keys-check.mjs $S/keys-overlay.png`
Expected: `ok W 비행 …`, `ok W 비행: 타깃도`, `ok ← 회전`, `ok - 줌아웃` (7·Home·H·? 는 FAIL — 아직 미구현)

- [ ] **Step 6: 커밋**

```bash
git add web/src/viewer/scene.ts
git commit -m "web: 뷰어 키보드 비행(WASD/QE)·방향키 궤도 회전·± 줌 — Scene3D 루프에서 연속 처리

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcPtW7XJsiLrBsZ9TcLZ15"
```

---

### Task 3: 안내 오버레이 + Tool 툴팁 키 표기

**Files:**
- Create: `web/src/viewer/Shortcuts.tsx`
- Modify: `web/src/viewer/chrome.tsx:39-49` (`Tool`)

**Interfaces:**
- Consumes: `KEYS` from `./keys`
- Produces:
  - `export default function Shortcuts({ onClose }: { onClose: () => void })`
  - `Tool` 에 `keys?: string` prop 추가 (툴팁 오른쪽에 흐리게 표기)

- [ ] **Step 1: Shortcuts 오버레이**

`web/src/viewer/Shortcuts.tsx`:

```tsx
import { Fragment } from 'react'
import { X } from 'lucide-react'
import { KEYS } from './keys'
import { T } from '../theme'

/** 단축키 안내 — ? 로 토글. 캔버스 위 반투명 가림 + 가운데 카드. 가림 클릭·X·Esc(Viewer 의 useEsc) 로 닫힘 */
export default function Shortcuts({ onClose }: { onClose: () => void }) {
  return <div onClick={onClose} style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: '#0007', zIndex: 5 }}>
    <div onClick={e => e.stopPropagation()} style={{ background: T.bg.surface, borderRadius: T.radius, boxShadow: T.shadow, padding: '12px 16px', fontSize: 12, minWidth: 380, maxHeight: '90%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><b style={{ flex: 1, fontSize: 13 }}>키보드 단축키</b><X size={14} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={onClose} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr', gap: '4px 12px', alignItems: 'center' }}>
        {KEYS.map((k, i) => <Fragment key={i}>
          <span style={{ color: T.ink[3] }}>{k.group !== KEYS[i - 1]?.group ? k.group : ''}</span>
          <kbd style={kbd}>{k.keys}</kbd>
          <span style={{ color: T.ink[2] }}>{k.label}</span>
        </Fragment>)}
      </div>
      <div style={{ marginTop: 10, color: T.ink[3] }}>Cmd/Ctrl+클릭 추가 선택 · Shift+클릭(트리) 범위 · 더블클릭 맞춤 · 입력란에 커서가 있으면 동작하지 않음</div>
    </div>
  </div>
}

const kbd = { fontFamily: 'ui-monospace, Menlo, monospace', background: T.bg.raised, border: `1px solid ${T.bg.line}`, borderRadius: 4, padding: '1px 6px', color: T.ink[1], whiteSpace: 'nowrap' as const, justifySelf: 'start' as const }
```

- [ ] **Step 2: Tool 툴팁에 키 표기**

`chrome.tsx` 39행 시그니처와 47행 툴팁 내용을 교체:

```tsx
export function Tool({ icon: Icon, label, hint, keys, onClick, active, disabled }: { icon: LucideIcon; label: string; hint?: string; keys?: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
```

```tsx
      {label}{keys && <span style={{ opacity: 0.6, marginLeft: 8 }}>{keys}</span>}{disabled && hint && <span style={{ opacity: 0.65 }}> · {hint}</span>}</span>}
```

- [ ] **Step 3: 타입·린트 확인**

Run: `cd web && npx tsc -b && npm run lint`
Expected: 에러 0 (Shortcuts 는 아직 미사용 — `noUnusedLocals` 는 export 된 default 에 적용되지 않음)

- [ ] **Step 4: 커밋**

```bash
git add web/src/viewer/Shortcuts.tsx web/src/viewer/chrome.tsx
git commit -m "web: 단축키 안내 오버레이 컴포넌트 + 툴바 툴팁 키 표기

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcPtW7XJsiLrBsZ9TcLZ15"
```

---

### Task 4: Viewer 단발 액션 배선 + 툴바·메뉴 표기

**Files:**
- Modify: `web/src/viewer/Viewer.tsx` (import 16-20행, 190행 `useEsc`, 195-215행 핸들러·메뉴, 323-339행 툴바, 363행 안내 텍스트, 오버레이 렌더)

**Interfaces:**
- Consumes: `keyAction`, `Action` from `./keys`; `Shortcuts` from `./Shortcuts`; `Tool.keys`
- Produces: 없음 (페이지 내부)

- [ ] **Step 1: import**

20행 `import { Axis, Floating, Gap, Tool } from './chrome'` 아래에:

```tsx
import { keyAction, type Action } from './keys'
import Shortcuts from './Shortcuts'
```

- [ ] **Step 2: showKeys 상태와 Esc**

190행 `useEsc(useCallback(() => setMeasuring(false), []))` 을 교체:

```tsx
  const [showKeys, setShowKeys] = useState(false)
  useEsc(useCallback(() => { setMeasuring(false); setShowKeys(false) }, []))
```

- [ ] **Step 3: showAll 추출 + 액션 디스패치**

201행 `const anyHidden = …` 바로 아래에 추가:

```tsx
  const showAll = () => { setHidden({ nodes: new Set(), classes: new Set(), gids: new Set() }); setFocus('none') }
  // 단축키(단발 액션). 핸들러는 렌더마다 새로 만들어지므로 ref 로 최신 것을 본다 — 리스너는 마운트 때 한 번. 연속 키(WASD 등)는 Scene3D 가 직접 본다
  const act = useRef<(a: Action) => void>(() => {})
  act.current = a => {
    const s = scene.current
    switch (a) {
      case 'home': s?.preset('home'); break
      case 'fit': s?.fit(); break
      case 'front': s?.preset('front'); break
      case 'side': s?.preset('side'); break
      case 'top': s?.preset('top'); break
      case 'isolate': if (selection.length || focus === 'ghost') setFocus(focus === 'ghost' ? 'none' : 'ghost'); break
      case 'hide': if (selection.length) hideSelected(); break
      case 'solo': soloSelected(); break
      case 'showAll': showAll(); break
      case 'clip': if (bounds) setClip(clip ? null : bounds.min.flatMap((m, i) => [m, bounds.max[i]])); break
      case 'measure': setMeasuring(m => !m); break
      case 'snap': setSnap(v => !v); break
      case 'grid': { const n = { ...opts, grid: !opts.grid }; try { localStorage.setItem('viewer.opts', JSON.stringify(n)) } catch { /* 저장 불가 환경 */ } setOpts(n); break }   // LeftPanel flipOpt 와 같은 저장 규칙
      case 'colors': setColorMode(v => !v); break
      case 'share': share(); break
      case 'help': setShowKeys(v => !v); break
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const a = keyAction(e); if (a) { e.preventDefault(); act.current(a) } }
    addEventListener('keydown', h); return () => removeEventListener('keydown', h)
  }, [])
```

`share` 는 226행에서 `const` 로 뒤에 선언되지만 `act.current` 는 렌더 중 대입되고 호출은 이벤트 시점이라 TDZ 문제 없음. 단, 위 블록은 `share` 선언(226-233행) **아래** 로 옮겨 넣어 lint(`no-use-before-define`) 를 피한다 — 즉 `share` 정의 직후, `const storeys = …`(235행) 앞에 둔다. `showAll` 만 `anyHidden` 아래에 둔다.

- [ ] **Step 4: 메뉴 힌트**

`menuItems()` 안의 항목 힌트를 바꾼다:

```tsx
      { icon: Maximize, label: none ? '전체 보기' : `맞춤: ${label}`, hint: 'F · dbl', onClick: () => scene.current?.fit() },
      'sep',
      { icon: Focus, label: focus === 'ghost' ? '격리 해제' : '격리 (나머지 반투명)', hint: 'I', disabled: none && focus !== 'ghost', onClick: () => setFocus(focus === 'ghost' ? 'none' : 'ghost') },
      { icon: EyeOff, label: hidden.solo?.key === 'sel' ? '선택만 보기 해제' : '선택만 보기', hint: '⇧H', disabled: none && hidden.solo?.key !== 'sel', onClick: soloSelected },
      { icon: EyeOff, label: '숨김', hint: 'H', disabled: none, onClick: hideSelected },
      { icon: Eye, label: '숨긴 것 모두 표시', hint: '⌥H', disabled: !anyHidden, onClick: showAll },
```

- [ ] **Step 5: 툴바 키 표기**

323-339행 `<Tool …>` 들에 `keys` 를 추가:

```tsx
            <Tool icon={Home} label="홈" keys="Home" onClick={() => scene.current?.preset('home')} />
            <Tool icon={Maximize} label="선택 요소에 맞춤 (더블클릭)" keys="F" onClick={() => scene.current?.fit()} />
            <Tool icon={Grid2x2} label="평면" keys="7" onClick={() => scene.current?.preset('top')} />
            <Tool icon={RectangleHorizontal} label="정면" keys="1" onClick={() => scene.current?.preset('front')} />
            <Gap />
            <Tool icon={Focus} label="격리 — 선택 외 반투명" keys="I" hint="요소를 먼저 선택" active={focus === 'ghost'} disabled={!selection.length} onClick={() => setFocus(focus === 'ghost' ? 'none' : 'ghost')} />
            <Tool icon={EyeOff} label="선택만 보기 (나머지 숨김)" keys="⇧H" hint="요소를 먼저 선택" active={hidden.solo?.key === 'sel'} disabled={!selection.length} onClick={soloSelected} />
            <Tool icon={RotateCcw} label="격리·솔로 해제" keys="⌥H" hint="적용된 격리·솔로 없음" disabled={focus === 'none' && !hidden.solo} onClick={() => { setFocus('none'); if (hidden.solo) setHidden({ ...hidden, solo: undefined }) }} />
            <Gap />
            <Tool icon={Scissors} label="단면 — X/Y/Z 범위, 층별 자르기" keys="C" active={!!clip} disabled={!bounds} onClick={() => setClip(clip ? null : bounds!.min.flatMap((m, i) => [m, bounds!.max[i]]))} />
            <Tool icon={Ruler} label="측정 — 면 위 두 점 거리" keys="M" active={measuring} onClick={() => setMeasuring(!measuring)} />
            <Tool icon={Magnet} label="스냅 — 빈 곳 클릭 시 가까운 요소, 측정 시 꼭짓점·모서리" keys="N" active={snap} onClick={() => setSnap(!snap)} />
            <Tool icon={Palette} label="속성별 색상 — 종류·층·속성값으로 칠하기" keys="P" active={colorMode} onClick={() => setColorMode(!colorMode)} />
            <Gap />
            <Tool icon={copied ? Check : Link} label="현재 화면을 링크로 복사 (뷰·선택·단면 포함)" keys="L" onClick={share} />
            <Tool icon={Keyboard} label="키보드 단축키" keys="?" active={showKeys} onClick={() => setShowKeys(v => !v)} />
```

4행 lucide import 에 `Keyboard` 를 추가한다.

- [ ] **Step 6: 오버레이 렌더 + 속성 탭 안내 텍스트**

291행 `{menu && <ContextMenu …/>}` 바로 아래에:

```tsx
          {showKeys && <Shortcuts onClose={() => setShowKeys(false)} />}
```

363행을 교체:

```tsx
          {!selection.length && <p style={{ color: T.ink[2] }}>요소를 클릭하면 속성이 표시됩니다. <span onClick={() => setShowKeys(true)} style={{ color: T.ink[3], cursor: 'pointer' }} title="? 키">단축키 ?</span></p>}
```

- [ ] **Step 7: 타입·린트·단위 테스트**

Run: `cd web && npx tsc -b && npm run lint && npm test`
Expected: 에러 0, 테스트 전부 통과

- [ ] **Step 8: 헤드리스 전체 통과**

개발 서버(5175)가 떠 있는 상태에서:

Run: `cd $S && node keys-check.mjs $S/keys-overlay.png`
Expected: 모든 줄 `ok`, exit 0. `keys-overlay.png` 를 열어 오버레이 표가 3열(그룹·키·설명)로 보이는지 확인

- [ ] **Step 9: 브라우저 수동 확인 (Chrome 확장)**

`http://localhost:5175/#/models/32d1ef4f-d6b0-439d-9649-645e47e196b2` 에서:
- 좌패널 검색 input 에 커서 두고 `w` 타이핑 → 카메라 안 움직임
- `Shift` 누른 채 `W` → 빠르게 이동
- `↑` 계속 누름 → 천장 위에서 멈추고 뒤집히지 않음
- 툴바 홈 버튼 호버 → 툴팁 `홈  Home`

- [ ] **Step 10: 커밋**

```bash
git add web/src/viewer/Viewer.tsx
git commit -m "web: 뷰어 단축키 배선 — 뷰·격리·숨김·단면·측정·스냅·그리드·색상·링크·? 안내

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcPtW7XJsiLrBsZ9TcLZ15"
```

---

### Task 5: README 단축키 표

**Files:**
- Modify: `README.md:24-31` (3D 뷰어 절), `README.md:248` (화면 경로)

- [ ] **Step 1: 3D 뷰어 절에 단축키 불릿**

31행 `![요소 선택 — …](images/02-viewer-selected.png)` 위, 29행 불릿 뒤에 추가:

```markdown
- 키보드만으로 조작: `W/A/S/D` `Q/E` 비행(`Shift` 4배속), 방향키 궤도 회전, `+/-` 줌, `Home`/`F`/`1`/`3`/`7` 뷰, `I`/`H`/`⇧H`/`⌥H` 격리·숨김, `C`/`M`/`N`/`G`/`P` 도구, `L` 링크, `?` 안내
```

- [ ] **Step 2: 화면 경로 줄 보강**

248행 끝에 ` · 단축키 안내 \`?\`` 를 덧붙인다:

```markdown
- `#/models/{id}` — 3D 뷰어 (`?sel=` 선택, `?focus=1` 경보 포커스, `?clip=` 단면, `?v=` 카메라, `?wo=` 작업지시 뷰포인트) · 단축키 안내 `?`
```

- [ ] **Step 3: 확인·커밋**

Run: `grep -n "키보드만으로\|단축키 안내" README.md`
Expected: 두 줄 출력

```bash
git add README.md
git commit -m "docs: README 에 뷰어 키보드 단축키 안내

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01WcPtW7XJsiLrBsZ9TcLZ15"
```

- [ ] **Step 4: 정리**

개발 서버 종료: `pkill -f "vite --port 5175"`. 스크래치패드 스크립트는 저장소에 넣지 않는다.

---

## Self-Review

- 스펙 커버리지: 키맵 전 항목 → Task 1(단발)·Task 2(연속). 무시 조건·blur → Task 1·2. 오버레이·툴팁 → Task 3·4. 메뉴 힌트·속성 탭 텍스트 → Task 4. README → Task 5. 검증(tsc·lint·헤드리스) → Task 2·4
- 타입 일관성: `Action` 리터럴 16개 = `keyAction` 반환 = `act.current` switch 케이스. `FLY` 의 code 문자열 = `fly()` 가 읽는 문자열. `Tool.keys` 는 string
- 생략 확인: Ctrl+A·리바인딩·넘패드 ± 없음
