import { ArrowUpDown, Cable, Flame, Network, Wrench, type LucideIcon } from 'lucide-react'

/** 팀 ↔ 계통 이름 매핑 — 모니터링 격자, FM 보드 카드 색, 뷰어 계통 탭 묶음이 전부 이 표 하나를 쓴다.
 *  순서가 곧 표시 순서·우선순위(요소가 여러 계통이면 앞선 팀): 소방 > 수송 > 설비 > 통신·제어 > 전기 */
export const TEAMS: { key: string; name: string; short: string; icon: LucideIcon; color: string; systems: string[] }[] = [
  { key: 'fire', name: '소방팀', short: '소방', icon: Flame, color: '#dc2626', systems: ['소방', '화재감지'] },
  { key: 'trans', name: '수송팀', short: '수송', icon: ArrowUpDown, color: '#78716c', systems: ['수송', '주차관제'] },
  { key: 'mech', name: '설비팀', short: '설비', icon: Wrench, color: '#2563eb', systems: ['공조', '냉난방수', '환기', '급수', '급탕', '배수', '가스', 'Domestic Cold Water', 'Domestic Hot Water', 'Sanitary', 'Hydronic Supply', 'Hydronic Return', 'Vent', 'Supply Air', 'Return Air', 'Exhaust Air', 'Cooling'] },   // 영문은 실무 IFC의 Pset 유도 계통(레빗 System Classification)
  { key: 'comm', name: '통신·제어팀', short: '통신', icon: Network, color: '#4f46e5', systems: ['통신'] },
  { key: 'elec', name: '전기팀', short: '전기', icon: Cable, color: '#f59e0b', systems: ['전기', '비상전원', 'Power', 'Emergency Power', 'Lighting', 'Receptacle', 'Appliance'] },   // 전기는 Load Classification·BackupSupplySystem 유도
]
/** 요소의 팀 — 계통 기준. 예외: 조명제어반은 통신 계통에도 걸리지만 전기팀 (모든 화면이 같은 답을 내야 하므로 여기 한 곳) */
export const teamOfSystems = (systems: string[] | undefined, name?: string | null) =>
  name?.includes('조명제어반') ? TEAMS.find(t => t.key === 'elec') : TEAMS.find(t => (systems ?? []).some(s => t.systems.includes(s)))
