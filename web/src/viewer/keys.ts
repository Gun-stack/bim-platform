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
