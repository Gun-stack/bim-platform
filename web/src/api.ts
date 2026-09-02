export type Model = {
  id: string; name: string; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  ifcSchema?: string; elementCount?: number; progress: number; error?: string; glbUrl?: string; createdAt?: string
}
export type SpatialNode = { id: number; parentId: number | null; globalId: string; ifcClass: string; name: string | null; elevation: number | null }
export type ElementRow = { globalId: string; ifcClass: string; name: string | null; spatialNodeId: number | null }
export type ElementDetail = ElementRow & { properties: Record<string, Record<string, unknown>>; spatialClass?: string; spatialName?: string; systems?: string[] }

/** REST 호출. 응답 타입은 호출부가 T 로 선언한다 — 서버 응답이 Map 이라 여기가 유일한 계약 */
export const api = <T = unknown>(path: string, init?: RequestInit): Promise<T> => fetch('/api' + path, init).then(async r => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? r.statusText)
  return r.status === 204 ? undefined as T : r.json()   // DELETE 는 본문 없음
})
export const post = <T = unknown>(path: string, body: unknown, method = 'POST') => api<T>(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

export type Asset = { id: string; tag: string; category: string | null; status: 'ACTIVE' | 'OUT_OF_SERVICE' | 'RETIRED'; installedOn: string | null; attributes: Record<string, unknown>
  globalId: string | null; ifcClass: string | null; elementName: string | null; lastInspectedOn?: string | null; lastResult?: 'OK' | 'DEFECT' | null; openWorkOrders?: number; nextDueOn?: string | null; storey?: string | null; zone?: string | null }
export type Inspection = { id: string; inspectedOn: string; result: 'OK' | 'DEFECT'; note: string | null }
export type Viewpoint = { v?: number[]; sel?: string[]; clip?: number[] }
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type WorkOrder = { id: string; title: string; status: 'OPEN' | 'IN_PROGRESS' | 'DONE'; priority: Priority; description: string | null; assignee: string | null; dueOn: string | null; inspectionId: string | null; viewpoint: Viewpoint | null; createdAt: string; updatedAt?: string
  assetId?: string; assetTag?: string; assetCategory?: string | null; globalId?: string | null; ifcClass?: string | null; elementName?: string | null; storey?: string | null; zone?: string | null; systems?: string[]; inspectionNote?: string | null }
export type AssetDetail = Asset & { inspections: Inspection[]; workOrders: WorkOrder[] }

export type System = { id: number; globalId: string; name: string; predefinedType: string | null; memberCount: number; connectionCount: number }
export type SystemMember = ElementRow & { spatialName: string | null; upstream: number; downstream: number }
export type RouteNode = { globalId: string; ifcClass: string; name: string | null; depth: number; spatialName: string | null; via: string | null }
export type Route = { globalId: string; direction: 'up' | 'down'; systems: string[]; nodes: RouteNode[] }
export type StatusRow = { globalId: string; ifcClass: string; name: string | null; spatialName: string | null; status: Record<string, unknown> & { Status?: string } }
export type PowerResult = { source: 'UTILITY' | 'GENERATOR'; powered: string[]; unpowered: string[] }
/** PATCH …/status 응답의 작업지시 부분 */
export type StatusPatchResult = { globalId: string; name: string | null; status: Record<string, unknown>; workOrder?: { suppressedBy?: { name: string }; reopened?: boolean; existing?: boolean; assetTag?: string } }
