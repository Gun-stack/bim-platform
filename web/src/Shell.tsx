import { useEffect, useState } from 'react'
import { Building2 } from 'lucide-react'
import { api, type Model } from './api'
import { selQ } from './context'
import { inp } from './ui'
import { T } from './theme'

/** 상단 바 높이 — 전체 높이 화면(뷰어·지도)과 고정 패널이 이만큼 비운다 */
export const SHELL_H = 44
export type Screen = '' | '/monitor' | '/fm'
const SCREENS: [Screen, string][] = [['', '3D 뷰어'], ['/monitor', '모니터링'], ['/fm', '시설관리']]

/** 공통 상단 바(sticky — 긴 화면에서도 내비가 남는다. 드로어·모달 z 40+ 가 위) — 브랜드 · (모델 화면이면) 모델 전환 + 화면 탭 · 지도·문서. 탭은 선택 객체(?sel=)를 끌고 가고, 모델 전환은 버린다(GlobalId 는 모델 안에서만 뜻이 있다) */
export default function Shell({ modelId, screen = '' }: { modelId?: string; screen?: Screen }) {
  const [models, setModels] = useState<Model[]>([])
  const [sel, setSel] = useState<string | null>(null)   // 뷰어는 선택을 replaceState 로 쓴다(hashchange 없음) → objctx 알림도 듣는다
  useEffect(() => {
    const f = () => setSel(new URLSearchParams(location.hash.split('?')[1] ?? '').get('sel'))
    f(); addEventListener('hashchange', f); addEventListener('objctx', f)
    return () => { removeEventListener('hashchange', f); removeEventListener('objctx', f) }
  }, [])
  useEffect(() => {   // 모델 화면에 들어올 때마다 — 홈에서 방금 올린 모델도 전환 목록에 보이게
    if (!modelId) return
    api<{ id: string }[]>('/projects').then(ps => ps[0] ? api<Model[]>(`/projects/${ps[0].id}/models`) : []).then(setModels).catch(() => setModels([]))
  }, [modelId])
  const ready = models.filter(m => m.status === 'READY')
  const link = { color: T.ink[2], textDecoration: 'none', fontSize: T.fs.sm, padding: '4px 8px', borderRadius: T.radius } as const
  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 30, height: SHELL_H, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px', background: T.bg.surface, borderBottom: `1px solid ${T.bg.line}`, fontFamily: 'system-ui' }}>
      <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: T.ink[1], textDecoration: 'none', fontWeight: T.fw.bold, fontSize: T.fs.lg }}><Building2 size={18} color={T.accent} />bim-platform</a>
      {modelId && <>
        <select aria-label="모델 전환" value={modelId} onChange={e => { location.hash = `#/models/${e.target.value}${screen}` }} style={{ ...inp, fontSize: T.fs.sm, maxWidth: 260 }}>
          {!ready.some(m => m.id === modelId) && <option value={modelId}>…</option>}
          {ready.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <nav style={{ display: 'inline-flex', gap: 2, padding: 2, background: T.bg.base, borderRadius: T.radius }}>
          {SCREENS.map(([path, label]) => { const on = screen === path
            return <a key={path} href={`#/models/${modelId}${path}${selQ(sel)}`} aria-current={on ? 'page' : undefined}
              style={{ padding: '4px 12px', borderRadius: T.radius - 2, textDecoration: 'none', fontSize: T.fs.sm, background: on ? T.bg.raised : 'transparent', color: on ? T.ink[1] : T.ink[2], fontWeight: on ? T.fw.bold : T.fw.normal }}>{label}</a> })}
        </nav>
      </>}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 2 }}>
        <a href="#/map" style={link}>지도</a>
        {/* Archify 로 만든 탐색형 다이어그램(web/public/*.html, 원본 docs/*.archify.json). 새 탭으로 */}
        <a href="/flow.html" target="_blank" rel="noopener" title="업로드 → 변환 → 운영 → 작업지시 흐름" style={link}>운영 흐름</a>
        <a href="/architecture.html" target="_blank" rel="noopener" title="컨테이너 구성과 요청 경로" style={link}>아키텍처</a>
      </span>
    </header>
  )
}
