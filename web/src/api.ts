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
