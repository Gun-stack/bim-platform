import { ExternalLink, X } from 'lucide-react'
import ObjectSummary from './ObjectSummary'
import StatusEditor from './viewer/StatusEditor'
import FmPanel from './viewer/FmPanel'
import { useObject } from './useObject'
import { objLinks } from './context'
import { btn, useEsc } from './ui'
import { T } from './theme'

/** 공용 객체 패널: 모니터링·시설관리에서 ?sel= 이 있으면 우측에 뜬다 — 뷰어 우측 패널과 같은 내용(요약·운영 상태·자산/점검/작업지시·트렌드).
 *  배경막 없음: 뒤의 행·카드는 계속 클릭된다. 화면을 옮겨도 ?sel= 이 따라가므로 같은 패널이 그대로 열린다 */
export default function ObjectDrawer({ modelId, gid, tick, reload, onClose }: { modelId: string; gid: string; tick?: unknown; reload?: () => Promise<unknown>; onClose: () => void }) {
  const obj = useObject(modelId, gid, tick)
  useEsc(onClose)
  const reloadAll = () => Promise.all([obj.reload(), reload?.()])
  const links = objLinks(modelId, gid), d = obj.detail
  return (
    <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, background: T.bg.surface, boxShadow: T.shadow, padding: 14, overflow: 'auto', fontSize: 13, zIndex: 40, boxSizing: 'border-box', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <b>객체</b><span style={{ color: T.ink[2], fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={gid}>{gid}</span>
        <a href={links.viewer} title="뷰어에서 구역 강조 + 비콘" style={btn}><ExternalLink size={12} /> 3D 위치</a>
        <X size={16} style={{ cursor: 'pointer', color: T.ink[2] }} onClick={onClose} />
      </div>
      {!d ? <p style={{ color: T.ink[2] }}>불러오는 중…</p> : <>
        <ObjectSummary modelId={modelId} detail={d} asset={obj.asset} />
        <StatusEditor key={gid} modelId={modelId} e={d} reload={reloadAll} />
        <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '14px 0 6px', fontSize: 13 }}>자산 · 점검 · 작업지시</h4>
        <FmPanel modelId={modelId} selection={[gid]} byGid={new Map([[gid, d]])} detail={d} assets={obj.assets} reload={reloadAll} viewpoint={() => ({})} />
      </>}
    </aside>)
}
