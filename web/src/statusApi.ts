import { post, type StatusPatchResult } from './api'

/** 상태 PATCH 공용: 결과의 작업지시 정보를 사람 말로. 상태판(SystemPanel)과 속성 패널이 같이 쓴다 */
export const patchStatus = (modelId: string, gid: string, patch: Record<string, unknown>) =>
  post<StatusPatchResult>(`/models/${modelId}/elements/${encodeURIComponent(gid)}/status`, patch, 'PATCH').then(r => {
    const w = r.workOrder; if (!w) return undefined
    return w.suppressedBy ? `상위 장비 이상(${w.suppressedBy.name}) — 작업지시 억제` : w.reopened ? `10분 내 완료된 작업지시 다시 열림 (${w.assetTag})` : w.existing ? `열린 작업지시 있음 — 재사용 (${w.assetTag})` : `작업지시 자동 생성 (${w.assetTag})` })
/** 상태 전이 패치 — 전이 시 이전 경보 확인(AckAt)은 무효가 되므로 지운다. AlarmAt 은 Z 포함 전체 ISO (없으면 로컬 시각으로 잘못 파싱된다) */
export const statusPatchFor = (Status: string) => Status === 'ALARM' ? { Status, AlarmAt: new Date().toISOString(), AckAt: null } : { Status, AckAt: null }
