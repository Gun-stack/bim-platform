import { api, type ElementRow, type Model, type StatusRow } from './api'
import { selQ } from './context'

export type Step = { hash: string; title: string; text: string }
export type State = { steps: Step[]; i: number }
export const KEY = 'tour'
export const read = (): State | undefined => { try { return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') ?? undefined } catch { return undefined } }

/** 1분 둘러보기 시작 — 대상은 지금 데이터에서 고른다: 경보+장애가 가장 많은 모델, 그 모델의 첫 경보(없으면 장애) 요소, 이름이 MDB·EMDB 로 시작하는 분전반.
 *  읽기 전용 딥링크만 쓰므로 공개 데모(쓰기 차단)에서도 그대로 동작 */
export async function startTour() {
  const pid = (await api<{ id: string }[]>('/projects'))[0]?.id; if (!pid) return
  const m = (await api<Model[]>(`/projects/${pid}/models`)).filter(x => x.status === 'READY').sort((a, b) => (b.alarms ?? 0) + (b.faults ?? 0) - (a.alarms ?? 0) - (a.faults ?? 0))[0]; if (!m) return
  const [status, els] = await Promise.all([api<StatusRow[]>(`/models/${m.id}/status`), api<ElementRow[]>(`/models/${m.id}/elements`)])
  const hit = status.find(r => r.status.Status === 'ALARM') ?? status.find(r => r.status.Status === 'FAULT'), board = els.find(e => /^E?MDB/.test(e.name ?? ''))
  const steps: Step[] = [
    { hash: `#/models/${m.id}/monitor`, title: '지금 건물 상태', text: '첫 줄 총계와 24시간 발생 막대, 왼쪽 건물 단면에서 빨간 칸이 경보가 난 층·분야다. 칸을 누르면 아래 격자가 그 층·분야로 좁혀진다.' },
    ...(hit ? [{ hash: `#/models/${m.id}${selQ(hit.globalId, '&focus=1')}`, title: '어디서 났나', text: `${hit.name ?? '경보 요소'} — 건물 전체를 유지한 채 구역을 파랗게, 지붕 위에 비콘. 벽 너머로 깜빡이는 점은 다른 경보·장애다.` }] : []),
    ...(board ? [{ hash: `#/models/${m.id}${selQ(board.globalId, '&trace=down')}`, title: '무엇이 영향을 받나', text: `${board.name} 하류 추적 — 원천에서 말단으로 흐르는 빛이 이 분전반에 물린 설비 전부다. 정전·차단 영향 범위를 3D 로 본다.` }] : []),
    ...(hit ? [{ hash: `#/models/${m.id}/fm${selQ(hit.globalId)}`, title: '누가 처리하나', text: '경보가 들어오면 작업지시가 자동으로 생기고(같은 상위 장비·열린 건은 재사용), 칸반에서 배정·진행·완료한다. 오른쪽 패널이 같은 요소의 상태·자산·점검 이력.' }] : []),
    { hash: '#/', title: '다른 건물도 같은 흐름', text: '실무 IFC(Revit 출력 Duplex·Clinic, Schependomlaan)도 업로드하면 같은 3D·모니터링·시설관리로 열린다. 둘러보기 끝.' },
  ]
  sessionStorage.setItem(KEY, JSON.stringify({ steps, i: 0 })); location.hash = steps[0].hash; dispatchEvent(new Event('tour'))
}
