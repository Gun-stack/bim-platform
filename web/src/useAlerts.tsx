// oxlint-disable react/only-export-components -- 훅 + 토스트 컴포넌트 한 파일 (같이 쓰이는 소규모 단위)
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api, type StatusRow } from './api'
import { isAbnormal, statusHex, statusLabel } from './status'
import { T } from './theme'

const isAbn = (r: StatusRow) => isAbnormal(r.status.Status)

/** 상태 5초 폴링 + 새 ALARM/FAULT 감지 — 어느 화면에서든 경보 인지 (MonitorPage 는 자기 데이터로 같은 diff 를 한다) */
export function useAlerts(modelId: string) {
  const [rows, setRows] = useState<StatusRow[]>([])
  const [fresh, setFresh] = useState<StatusRow[]>([])   // 새로 발생한 경보 — 토스트로, 8초 후 자동 소거
  const prev = useRef<Set<string> | null>(null)
  const reload = useCallback(() => api<StatusRow[]>(`/models/${modelId}/status`).then(rs => {
    const abn = new Set(rs.filter(isAbn).map(r => r.globalId))
    if (prev.current) {
      const nw = rs.filter(r => abn.has(r.globalId) && !prev.current!.has(r.globalId))
      if (nw.length) { setFresh(f => [...f, ...nw]); setTimeout(() => setFresh(f => f.filter(x => !nw.includes(x))), 8000) }
    }
    prev.current = abn
    setRows(rs)
  }).catch(() => {}), [modelId])
  // oxlint-disable-next-line react/set-state-in-effect -- 모델 변경 시 이전 모델의 토스트 제거
  useEffect(() => { prev.current = null; setFresh([]); reload(); const t = setInterval(reload, 5000); return () => clearInterval(t) }, [reload])
  const dismiss = useCallback((r: StatusRow) => setFresh(f => f.filter(x => x !== r)), [])
  return { rows, abnormal: rows.filter(isAbn), fresh, dismiss, reload }
}

/** 우하단 경보 토스트 스택: 이름·위치 + 3D/모니터링/칸반 카드 링크. 뷰어에서는 onFocus 로 같은 화면 포커스 */
export function AlertToast({ modelId, fresh, dismiss, onFocus }: { modelId: string; fresh: StatusRow[]; dismiss: (r: StatusRow) => void; onFocus?: (gid: string) => void }) {
  if (!fresh.length) return null
  const link = { color: T.accent, cursor: 'pointer', textDecoration: 'none' } as const
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 60 }}>
      {fresh.slice(-4).map(r => { const c = statusHex(r.status.Status); return (
        <div key={r.globalId} className="fresh" style={{ background: T.bg.surface, borderLeft: '4px solid ' + c, borderRadius: 8, boxShadow: T.shadow, padding: '8px 12px', fontSize: 12, minWidth: 260, maxWidth: 340 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <b style={{ color: c }}>{statusLabel(r.status.Status)}</b>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <X size={14} onClick={() => dismiss(r)} style={{ cursor: 'pointer', color: T.ink[2], flexShrink: 0 }} />
          </div>
          {r.spatialName && <div style={{ color: T.ink[2], marginTop: 2 }}>{r.spatialName}</div>}
          <div style={{ display: 'flex', gap: 12, marginTop: 4 }}>
            {onFocus
              ? <a onClick={() => { onFocus(r.globalId); dismiss(r) }} style={link}>3D 위치</a>
              : <a href={`#/models/${modelId}?sel=${encodeURIComponent(r.globalId)}&focus=1`} style={link}>3D 위치</a>}
            <a href={`#/models/${modelId}/monitor?sel=${encodeURIComponent(r.globalId)}`} style={link}>모니터링</a>
            <a href={`#/models/${modelId}/fm?sel=${encodeURIComponent(r.globalId)}`} style={link}>카드</a>
          </div>
        </div>) })}
    </div>
  )
}
