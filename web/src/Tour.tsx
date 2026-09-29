import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { KEY, read } from './tourSteps'
import { btn, btnPrimary, useEsc } from './ui'
import { T } from './theme'

/** 둘러보기 안내 카드 — 하단 가운데(뷰어 툴바 위). 단계마다 딥링크로 이동, Esc·X 로 닫기. 키오스크에선 App 이 안 그린다 */
export default function Tour() {
  const [t, setT] = useState(read)
  useEffect(() => { const f = () => setT(read()); addEventListener('tour', f); return () => removeEventListener('tour', f) }, [])
  const close = () => { sessionStorage.removeItem(KEY); setT(undefined) }
  useEsc(close)
  if (!t) return null
  const go = (i: number) => { if (i >= t.steps.length) return close(); const n = { ...t, i }; sessionStorage.setItem(KEY, JSON.stringify(n)); setT(n); location.hash = t.steps[i].hash }
  const s = t.steps[t.i], last = t.i === t.steps.length - 1
  return (
    <div role="dialog" aria-label="둘러보기" style={{ position: 'fixed', left: '50%', bottom: 72, transform: 'translateX(-50%)', width: 480, maxWidth: 'calc(100vw - 32px)', zIndex: 55, background: T.bg.raised, border: `1px solid ${T.accent}`, borderRadius: T.radius, boxShadow: T.shadow, padding: '12px 14px', fontFamily: 'system-ui', fontSize: T.fs.md }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: T.accent, fontSize: T.fs.xs, fontWeight: T.fw.bold }}>둘러보기 {t.i + 1} / {t.steps.length}</span>
        <b style={{ fontSize: T.fs.lg }}>{s.title}</b>
        <button onClick={close} aria-label="둘러보기 닫기" title="닫기 (Esc)" style={{ marginLeft: 'auto', border: 0, background: 'none', color: T.ink[2], cursor: 'pointer', display: 'inline-flex', padding: 2 }}><X size={16} /></button>
      </div>
      <p style={{ margin: '6px 0 10px', color: T.ink[2], lineHeight: 1.55 }}>{s.text}</p>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {t.i > 0 && <button onClick={() => go(t.i - 1)} style={btn}>이전</button>}
        <button onClick={() => go(t.i + 1)} style={btnPrimary}>{last ? '끝' : '다음'}</button>
      </div>
    </div>
  )
}
