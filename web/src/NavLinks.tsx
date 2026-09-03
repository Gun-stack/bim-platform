import type { CSSProperties } from 'react'
import { objLinks } from './context'
import { T } from './theme'

/** 객체 이동 링크 묶음 — 카드·패널·토스트·배너 어디서나 같은 글자, 같은 순서(3D · 모니터링 · 시설관리), 같은 자리(줄의 오른쪽 끝).
 *  지금 있는 화면의 링크는 뺀다(해시로 판단). viewer/onViewer 는 3D 링크 대체: 뷰포인트 URL(작업지시)이나 같은 화면 포커스(토스트) */
export default function NavLinks({ modelId, gid, viewer, onViewer, style }: { modelId: string; gid?: string | null; viewer?: string; onViewer?: () => void; style?: CSSProperties }) {
  const here = /\/models\/[^/?]+\/(monitor|fm)/.exec(location.hash)?.[1] ?? 'viewer'
  const links = gid ? objLinks(modelId, gid) : undefined
  const a = { color: T.accent, textDecoration: 'none', cursor: 'pointer', whiteSpace: 'nowrap' } as const
  const stop = (e: React.MouseEvent) => e.stopPropagation()   // 카드 자체 클릭(드로어 열기)과 겹치지 않게
  const threeD = onViewer ? <a onClick={e => { stop(e); onViewer() }} style={a}>3D</a>
    : (viewer ?? links?.viewer) && here !== 'viewer' ? <a href={viewer ?? links!.viewer} onClick={stop} title="뷰어에서 위치 강조" style={a}>3D</a> : null
  const monitor = links && here !== 'monitor' ? <a href={links.monitor} onClick={stop} title="모니터링에서 이 장비" style={a}>모니터링</a> : null
  const card = links && here !== 'fm' ? <a href={links.fm} onClick={stop} title="시설관리에서 이 자산의 카드" style={a}>시설관리</a> : null
  if (!threeD && !monitor && !card) return null
  return <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, fontSize: 11, whiteSpace: 'nowrap', ...style }}>{threeD}{monitor}{card}</span>
}
