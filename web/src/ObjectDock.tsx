import { useEffect, useState } from 'react'
import { Box, X } from 'lucide-react'
import { useObject } from './useObject'
import { getRecent, getSnap, objLinks, pushRecent, selQ } from './context'
import { statusUi } from './status'
import { teamOfSystems } from './teams'

/** "지금 보는 객체" 독 — 세 화면 모두 좌하단에 고정. URL ?sel= 이 상태이고, 뷰어가 남긴 3D 스냅샷을 썸네일로 보여준다.
 *  링크 3D/모니터링/카드로 화면을 옮겨도 같은 객체가 따라가고, 최근 본 객체 칩으로 되돌아갈 수 있다 */
export default function ObjectDock({ modelId, route }: { modelId: string; route: '' | '/monitor' | '/fm' }) {
  const [, bump] = useState(0)   // hashchange + 뷰어의 replaceState/스냅샷 알림(objctx) → 다시 그린다
  useEffect(() => { const f = () => bump(n => n + 1); addEventListener('hashchange', f); addEventListener('objctx', f); return () => { removeEventListener('hashchange', f); removeEventListener('objctx', f) } }, [])
  const sel = new URLSearchParams(location.hash.split('?')[1] ?? '').get('sel')
  const { detail, asset } = useObject(modelId, sel)
  useEffect(() => { if (detail) pushRecent(modelId, { gid: detail.globalId, name: detail.name ?? detail.globalId }) }, [modelId, detail])
  const recent = getRecent(modelId).filter(r => r.gid !== sel)
  if (!sel && !recent.length) return null
  const snap = sel ? getSnap(modelId, sel) : undefined
  const st = statusUi((detail?.properties.Pset_BimStatus as Record<string, unknown> | undefined)?.Status as string | undefined)
  const team = detail ? teamOfSystems(detail.systems, detail.name) : undefined
  const links = sel ? objLinks(modelId, sel) : undefined
  const link = { color: '#2563eb', textDecoration: 'none', whiteSpace: 'nowrap' } as const
  return (
    <div style={{ position: 'fixed', left: 16, bottom: 16, width: 280, zIndex: 45, background: '#fff', borderRadius: 10, boxShadow: '0 6px 20px #0003, 0 0 0 1px #0000000d', padding: '8px 10px', fontSize: 12, fontFamily: 'system-ui', boxSizing: 'border-box' }}>
      {sel && links && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {snap ? <img src={snap} alt="" width={56} height={35} style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} /> : <span style={{ width: 56, height: 35, borderRadius: 4, background: '#e5e7eb', display: 'grid', placeItems: 'center', color: '#9ca3af', flexShrink: 0 }}><Box size={16} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><b style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={detail?.name ?? sel}>{detail?.name ?? '…'}</b>
              {st && <span style={{ padding: '0 6px', borderRadius: 999, color: '#fff', fontSize: 10, fontWeight: 600, background: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>}
              {team && <span style={{ fontSize: 10, border: '1px solid ' + team.color, color: team.color, borderRadius: 4, padding: '0 3px', whiteSpace: 'nowrap' }}>{team.short}</span>}</div>
            <div style={{ display: 'flex', gap: 8, color: '#888', fontSize: 11, marginTop: 1 }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{detail?.spatialName ?? ''}{asset ? ` · ${asset.tag}` : ''}</span>
              <a href={links.viewer} style={link}>3D</a>
              {route !== '/monitor' && <a href={links.monitor} style={link}>모니터링</a>}
              {route !== '/fm' && <a href={links.fm} style={link}>카드</a>}</div>
          </div>
          {route !== '' && <X size={14} style={{ cursor: 'pointer', color: '#888', flexShrink: 0 }} onClick={() => { location.hash = `#/models/${modelId}${route}` }} />}
        </div>
      </>}
      {recent.length > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: sel ? 6 : 0, color: '#999', fontSize: 11 }}>최근
        {recent.map(r => <a key={r.gid} href={`#/models/${modelId}${route}${selQ(r.gid)}`} title={r.name} style={{ ...link, color: '#444', background: '#f3f4f6', borderRadius: 999, padding: '1px 8px', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</a>)}</div>}
    </div>)
}
