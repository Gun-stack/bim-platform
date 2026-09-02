import { useCallback, useEffect, useState } from 'react'
import { api, type Asset, type ElementDetail } from './api'

/** 어느 화면에서든 객체 하나의 상세·자산 — 맥락 독과 객체 패널 공용. tick 이 바뀌면 다시 받는다(모니터링 5초 폴링과 맞물림).
 *  detail 은 요청한 gid 와 같을 때만 돌려줘 이전 객체가 잠깐 보이지 않게 한다.
 *  ponytail: 화면당 자산 목록을 두세 번 받는다 — 무거워지면 GET /assets?globalId= 추가 */
export function useObject(modelId: string, gid?: string | null, tick?: unknown) {
  const [detail, setDetail] = useState<ElementDetail>()
  const [assets, setAssets] = useState<Asset[]>([])
  const reload = useCallback(() => !gid ? Promise.resolve() : Promise.all([api<ElementDetail>(`/models/${modelId}/elements/${encodeURIComponent(gid)}`), api<Asset[]>(`/models/${modelId}/assets`)])
    .then(([d, a]) => { setDetail(d); setAssets(a) }).catch(() => {}), [modelId, gid])
  useEffect(() => { reload() }, [reload, tick])
  const cur = detail?.globalId === gid ? detail : undefined
  return { detail: cur, asset: gid ? assets.find(a => a.globalId === gid) : undefined, assets, reload }
}
