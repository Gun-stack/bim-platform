import { post } from './api'

/** 상태 PATCH 공용: 결과의 작업지시 정보를 사람 말로. 상태판(SystemPanel)과 속성 패널이 같이 쓴다 */
export const patchStatus = (modelId: string, gid: string, patch: Record<string, unknown>) =>
  post(`/models/${modelId}/elements/${encodeURIComponent(gid)}/status`, patch, 'PATCH').then(r => {
    const w = r.workOrder; if (!w) return undefined as string | undefined
    return w.suppressedBy ? `상위 장비 이상(${w.suppressedBy.name}) — 작업지시 억제` : w.reopened ? `10분 내 완료된 작업지시 다시 열림 (${w.assetTag})` : w.existing ? `열린 작업지시 있음 — 재사용 (${w.assetTag})` : `작업지시 자동 생성 (${w.assetTag})` })
export const statusPatchFor = (Status: string) => Status === 'ALARM' ? { Status, AlarmAt: new Date().toISOString().slice(0, 16) } : { Status }
