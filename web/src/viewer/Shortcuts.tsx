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
