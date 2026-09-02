import { inlineReadings } from './readings'
import { isAbnormal } from './status'
import { TEAMS, teamOfSystems } from './teams'
import { inspectionOverdue } from './ui'

/** 모니터링 화면의 순수 로직 — 행 타입과 '지금 처리할 것' 우선순위. 컴포넌트 밖에 두어 테스트한다 (monitor.test.ts) */
export type Row = { globalId: string; ifcClass: string; name: string | null; storey: string | null; zone: string | null; elevation: number | null; systems: string[]
  status: (Record<string, unknown> & { Status?: string }) | null; assetId: string | null; assetTag: string | null; assetStatus: string | null; lastResult: string | null; openWorkOrders: number
  woAssignee?: string | null; woDueOn?: string | null; woStatus?: string | null; nextDueOn?: string | null }
export type Ev = { at: string | null; kind: 'STATUS' | 'WORK_ORDER'; globalId: string | null; name: string | null; status: string | null; storey: string | null; woTitle: string | null; woStatus: string | null }

export const isAbn = (r: Row) => isAbnormal(r.status?.Status)
/** 점검 주기를 넘긴 자산(ACTIVE 만) — 지연은 긴급도 최하위로 '지금 처리할 것' 끝에 선다 */
export const overdue = (r: Row) => inspectionOverdue(r.nextDueOn, r.assetStatus)
/** 계측값 중 가장 나쁜 등급 */
export const worst = (r: Row) => inlineReadings(r.status, r.name).reduce((m, x) => x.level === 'crit' ? 'crit' : m === 'crit' ? m : x.level === 'warn' ? 'warn' : m, 'ok' as 'ok' | 'warn' | 'crit')
/** 긴급도: 경보 0 → 장애·오프라인 1 → 절체·무전원·계측 위험 2 → 계측 주의·열린 작업지시 3 → 결함 4 → 점검 지연 5 → 정상 9 */
export const rank = (r: Row, dead = false) => ({ ALARM: 0, FAULT: 1, OFFLINE: 1, TRANSFERRED: 2 }[r.status?.Status ?? ''] ?? (dead ? 2 : worst(r) === 'crit' ? 2 : worst(r) === 'warn' ? 3 : r.openWorkOrders ? 3 : r.lastResult === 'DEFECT' ? 4 : overdue(r) ? 5 : 9))
/** GET /monitor/stats 한 행 — 요소별 경보 에피소드(정상→이상 전이) 집계 */
export type StatRow = { globalId: string; name: string | null; ifcClass: string | null; systems: string[]; alarms: number; faults: number; recovered: number; open: number; mttrMin: number | null; lastAt: string | null }
/** 팀별 합계: 발생 건수, 복구 시간 평균(복구된 에피소드 가중), 미복구, 재발 장비(기간 내 2회 이상) */
export const teamStats = (rows: StatRow[]) => TEAMS.map(t => {
  const rs = rows.filter(r => teamOfSystems(r.systems, r.name)?.key === t.key)
  const recovered = rs.reduce((n, r) => n + r.recovered, 0)
  return { team: t, alarms: rs.reduce((n, r) => n + r.alarms, 0), faults: rs.reduce((n, r) => n + r.faults, 0), open: rs.reduce((n, r) => n + r.open, 0),
    mttrMin: recovered ? Math.round(rs.reduce((n, r) => n + (r.mttrMin ?? 0) * r.recovered, 0) / recovered) : null, recurring: rs.filter(r => r.alarms + r.faults >= 2).length }
})
/** 팀별 핵심(원천) 장비 — 이름 접두어. 팀을 고르면 격자보다 먼저 카드로 */
export const KEY_EQUIP: Record<string, string[]> = {
  fire: ['FACP', 'FP-1', 'FT-1', 'SEF-1', 'PA-1', 'GS-1'],
  trans: ['EL-1 승객', 'ES-1', 'PCS-1', 'BG-IN', 'BG-OUT', 'DISP-1'],
  mech: ['CH-1', 'CT-1', 'AHU-1', 'B-1', 'HWB-1', 'WP-1', 'WT-1', 'HP-1', 'JF-1'],
  comm: ['MDF', 'BMS', 'FMS', 'NVR', '출입통제', 'UPS-1'],
  elec: ['HV-1', 'TR-1', 'MDB', 'EG-1', 'ATS-1', 'EMDB', 'PV-1', 'UPS-1'],
}
