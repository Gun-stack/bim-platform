export type Model = {
  id: string; name: string; status: 'UPLOADED' | 'PROCESSING' | 'READY' | 'FAILED'
  ifcSchema?: string; elementCount?: number; progress: number; error?: string; glbUrl?: string
}
export type SpatialNode = { id: number; parentId: number | null; globalId: string; ifcClass: string; name: string | null; elevation: number | null }
export type ElementRow = { globalId: string; ifcClass: string; name: string | null; spatialNodeId: number | null }
export type ElementDetail = ElementRow & { properties: Record<string, Record<string, unknown>>; spatialClass?: string; spatialName?: string }

export const api = (path: string, init?: RequestInit) => fetch('/api' + path, init).then(async r => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message ?? r.statusText)
  return r.json()
})

export type Asset = { id: string; tag: string; category: string | null; status: 'ACTIVE' | 'OUT_OF_SERVICE' | 'RETIRED'; installedOn: string | null; attributes: Record<string, unknown>
  globalId: string | null; ifcClass: string | null; elementName: string | null; lastInspectedOn?: string | null; lastResult?: 'OK' | 'DEFECT' | null; openWorkOrders?: number }
export type Inspection = { id: string; inspectedOn: string; result: 'OK' | 'DEFECT'; note: string | null }
export type Viewpoint = { v?: number[]; sel?: string[]; clip?: number[] }
export type WorkOrder = { id: string; title: string; status: 'OPEN' | 'IN_PROGRESS' | 'DONE'; assignee: string | null; dueOn: string | null; inspectionId: string | null; viewpoint: Viewpoint | null; createdAt: string
  assetId?: string; assetTag?: string; globalId?: string | null; ifcClass?: string | null; elementName?: string | null }
export type AssetDetail = Asset & { inspections: Inspection[]; workOrders: WorkOrder[] }
export const post = (path: string, body: unknown, method = 'POST') => api(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
