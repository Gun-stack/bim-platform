import { useEffect, useState } from 'react'
import { Box, X } from 'lucide-react'
import { useObject } from './useObject'
import { getRecent, getSnap, pushRecent, selQ } from './context'
import NavLinks from './NavLinks'
import { isQuiet, statusHex, statusLabel } from './status'
import { badge } from './ui'
import { teamOfSystems } from './teams'
import { T } from './theme'

const POS_KEY = 'dock:pos'

/** "지금 보는 객체" 독 — 세 화면 모두 좌하단에 고정. URL ?sel= 이 상태이고, 뷰어가 남긴 3D 스냅샷을 썸네일로 보여준다.
 *  링크 3D/모니터링/카드로 화면을 옮겨도 같은 객체가 따라가고, 최근 본 객체 칩으로 되돌아갈 수 있다 */
export default function ObjectDock({ modelId, route }: { modelId: string; route: '' | '/monitor' | '/fm' }) {
  const [, bump] = useState(0)   // hashchange + 뷰어의 replaceState/스냅샷 알림(objctx) → 다시 그린다
  useEffect(() => { const f = () => bump(n => n + 1); addEventListener('hashchange', f); addEventListener('objctx', f); addEventListener('resize', f); return () => { removeEventListener('hashchange', f); removeEventListener('objctx', f); removeEventListener('resize', f) } }, [])
  const sel = new URLSearchParams(location.hash.split('?')[1] ?? '').get('sel')
  const { detail, asset } = useObject(modelId, sel)
  useEffect(() => { if (detail) pushRecent(modelId, { gid: detail.globalId, name: detail.name ?? detail.globalId }) }, [modelId, detail])
  // 드래그로 옮긴 위치(localStorage). 없으면 기본 위치. 링크·아이콘을 누른 건 드래그가 아니다
  const [pos, setPos] = useState<{ x: number; y: number } | null>(() => { try { return JSON.parse(localStorage.getItem(POS_KEY) ?? 'null') } catch { return null } })
  const recent = getRecent(modelId).filter(r => r.gid !== sel)
  if (!sel && !recent.length) return null
  const snap = sel ? getSnap(modelId, sel) : undefined
  const st = (detail?.properties.Pset_BimStatus as Record<string, unknown> | undefined)?.Status as string | undefined
  const team = detail ? teamOfSystems(detail.systems, detail.name) : undefined
  const link = { color: T.accent, textDecoration: 'none', whiteSpace: 'nowrap' } as const   // 최근 칩
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('a, svg')) return
    const r = e.currentTarget.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top
    let p: typeof pos = null   // 3px 이상 움직여야 드래그. 그냥 클릭은 기본 위치(반응형)를 굳히지 않는다
    const move = (ev: PointerEvent) => {
      if (!p && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 3) return
      p = { x: Math.max(0, Math.min(ev.clientX - dx, innerWidth - r.width)), y: Math.max(0, Math.min(ev.clientY - dy, innerHeight - r.height)) }; setPos(p) }
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (p) try { localStorage.setItem(POS_KEY, JSON.stringify(p)) } catch { /* 저장 불가 환경 — 무시 */ } }
    addEventListener('pointermove', move); addEventListener('pointerup', up)
  }
  // 기본 위치: 뷰어면 3D 캔버스 우측 상단(우측 패널 폭·창 크기 따라 재계산), 다른 화면은 좌하단
  const canvas = route === '' ? document.getElementById('viewer-canvas')?.getBoundingClientRect() : undefined
  const at = pos ? { left: Math.min(pos.x, innerWidth - 280), top: Math.min(pos.y, innerHeight - 60) }
    : canvas ? { left: canvas.right - 280 - 16, top: canvas.top + 16 } : { left: 16, bottom: 16 }
  return (
    <div onPointerDown={drag} style={{ position: 'fixed', ...at, width: 280, zIndex: 45, cursor: 'grab', touchAction: 'none', userSelect: 'none', background: T.bg.surface, border: `1px solid ${T.bg.line}`, borderRadius: T.radius, boxShadow: T.shadow, padding: '8px 10px', fontSize: 12, fontFamily: 'system-ui', boxSizing: 'border-box' }}>
      {sel && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {snap ? <img src={snap} alt="" draggable={false} width={56} height={35} style={{ borderRadius: T.radius, objectFit: 'cover', flexShrink: 0 }} /> : <span style={{ width: 56, height: 35, borderRadius: T.radius, background: T.bg.line, display: 'grid', placeItems: 'center', color: T.ink[3], flexShrink: 0 }}><Box size={16} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={detail?.name ?? sel}>{detail?.name ?? '…'}</b>
              {st && !isQuiet(st) && <span style={badge(statusHex(st))}>{statusLabel(st)}</span>}
              {team && <span style={{ fontSize: T.fs.xs, color: team.color, whiteSpace: 'nowrap' }}>{team.short}</span>}</div>
            <div style={{ display: 'flex', gap: 8, color: T.ink[2], fontSize: 11, marginTop: 1 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{detail?.spatialName ?? ''}{asset ? ` · ${asset.tag}` : ''}</span>
              <NavLinks modelId={modelId} gid={sel} /></div>
          </div>
          {route !== '' && <X size={14} style={{ cursor: 'pointer', color: T.ink[2], flexShrink: 0 }} onClick={() => { location.hash = `#/models/${modelId}${route}` }} />}
        </div>
      </>}
      {recent.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: sel ? 6 : 0, color: T.ink[2], fontSize: 11 }}>최근
        {recent.map(r => <a key={r.gid} href={`#/models/${modelId}${route}${selQ(r.gid)}`} title={r.name} style={{ ...link, color: T.ink[2], background: T.bg.raised, borderRadius: 999, padding: '1px 8px', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</a>)}</div>}
    </div>)
}
