import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
// MapLibre 6 는 Blob 워커 안에서 자기 모듈 옆의 maplibre-gl-worker.mjs 를 import 한다 → Vite 단일 번들에선 경로가 깨져
// nginx 가 index.html 을 돌려주고 워커가 죽는다(GeoJSON 소스가 영원히 로드 안 됨). 워커 파일을 자산으로 내보내 URL 을 알려준다.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'   // ?worker: 의존성(maplibre-gl.mjs)까지 묶은 독립 워커 번들
maplibregl.setWorkerUrl(new URL(workerUrl, location.href).href)   // Blob 워커 안의 import() 는 절대 URL 이어야 한다
import { ArrowLeft, Box, Crosshair, MapPin, X } from 'lucide-react'
import { api, post, type Model } from './api'
import { btn } from './ui'
import { T } from './theme'

type Feature = { type: 'Feature'; id: string; geometry: { type: 'Polygon'; coordinates: number[][][] }; properties: { name: string; georefSource: string | null; crs: string | null; manual: boolean | null; areaM2: number; lon: number; lat: number; elementCount: number } }

/** #/map — 모든 모델의 풋프린트. 지리참조 없는 모델은 지도 클릭으로 배치(수동 핀). */
export default function MapPage() {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map>(null)
  const [features, setFeatures] = useState<Feature[]>([])
  const [models, setModels] = useState<(Model & { footprint?: unknown; mapConversion?: { source?: string } })[]>([])
  const [placing, setPlacing] = useState<{ id: string; name: string; rotation: number }>()
  const placingRef = useRef(placing)
  useEffect(() => { placingRef.current = placing }, [placing])
  const [err, setErr] = useState<string>()

  const reload = async () => {
    const [fc, ps] = await Promise.all([api<{ features: Feature[] }>('/map/footprints'), api<{ id: string }[]>('/projects')])
    setFeatures(fc.features)
    setModels((await Promise.all(ps.map(p => api<Model[]>(`/projects/${p.id}/models`)))).flat().filter(m => m.status === 'READY'))
    return fc.features
  }

  useEffect(() => {
    if (!el.current) return
    const m = new maplibregl.Map({
      container: el.current, center: [127.8, 36.3], zoom: 6,   // 한국 전역
      style: { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
               layers: [{ id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-brightness-max': 0.42, 'raster-saturation': -0.75, 'raster-contrast': 0.15 } }] },   // 다크 UI 에 맞춰 OSM 타일을 눌러 그린다 (무료 다크 타일은 키가 필요)
    })
    map.current = m
    m.addControl(new maplibregl.NavigationControl(), 'top-right')
    m.on('error', e => setErr('map: ' + e.error?.message))
    m.on('load', async () => {
      m.addSource('fp', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'fp-fill', type: 'fill', source: 'fp', paint: { 'fill-color': ['case', ['==', ['get', 'manual'], true], T.warn, T.accent], 'fill-opacity': 0.35 } })
      m.addLayer({ id: 'fp-line', type: 'line', source: 'fp', paint: { 'line-color': ['case', ['==', ['get', 'manual'], true], T.warn, T.accent], 'line-width': 2 } })
      m.addLayer({ id: 'fp-label', type: 'symbol', source: 'fp', layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.2], 'text-anchor': 'top' }, paint: { 'text-color': T.ink[1], 'text-halo-color': T.bg.base, 'text-halo-width': 1.5 } })
      try { const fs = await reload(); if (fs.length) fitTo(m, fs) } catch (x) { setErr('로드 실패: ' + (x as Error).message) }
      m.on('click', 'fp-fill', e => {
        if (placingRef.current) return
        const p = e.features![0].properties as Feature['properties'] & { id: string }
        new maplibregl.Popup({ closeButton: false, maxWidth: '280px' }).setLngLat(e.lngLat).setHTML(`
          <div style="font:13px system-ui"><b>${p.name}</b><div style="color:#666;font-size:12px;margin:2px 0 6px">
          ${p.manual ? '수동 배치' : p.georefSource}${p.crs ? ' · ' + p.crs : ''} · ${p.areaM2} m² · 요소 ${p.elementCount}</div>
          <a href="#/models/${p.id}" style="margin-right:8px">3D 뷰어</a><a href="#/models/${p.id}/fm">시설관리</a></div>`).addTo(m)
      })
      m.on('mouseenter', 'fp-fill', () => { if (!placingRef.current) m.getCanvas().style.cursor = 'pointer' })
      m.on('mouseleave', 'fp-fill', () => { if (!placingRef.current) m.getCanvas().style.cursor = '' })
      m.on('click', async e => {   // 배치 모드: 클릭 지점에 핀
        const pl = placingRef.current; if (!pl) return
        setErr(undefined)
        try { await post(`/models/${pl.id}/footprint`, { lon: e.lngLat.lng, lat: e.lngLat.lat, rotation: pl.rotation }, 'PUT'); setPlacing(undefined); m.getCanvas().style.cursor = ''; await reload() }
        catch (x) { setErr((x as Error).message) }
      })
    })
    return () => { m.remove(); map.current = null }
  }, [])
  useEffect(() => { (map.current?.getSource('fp') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features }) }, [features])

  const startPlacing = (m: Model) => { setPlacing({ id: m.id, name: m.name, rotation: 0 }); map.current!.getCanvas().style.cursor = 'crosshair' }
  const flyTo = (f: Feature) => fitTo(map.current!, [f])
  const placed = new Set(features.map(f => f.id))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', height: '100vh', fontFamily: 'system-ui', fontSize: 13 }}>
      <aside style={{ overflow: 'auto', borderRight: `1px solid ${T.bg.line}`, background: T.bg.raised, padding: 12 }}>
        <a href="#/" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none', color: T.accent, fontSize: 12 }}><ArrowLeft size={13} /> 모델 목록</a>
        <h3 style={{ margin: '6px 0 2px', display: 'flex', alignItems: 'center', gap: 6 }}><MapPin size={16} /> 지도</h3>
        <div style={{ color: T.ink[3], fontSize: 12, marginBottom: 10 }}>풋프린트 {features.length} · 미배치 {models.filter(m => !placed.has(m.id)).length}</div>
        {placing && <div style={{ background: T.warnSoft, border: `1px solid ${T.warn}`, borderRadius: 8, padding: 10, marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Crosshair size={14} color="#b45309" /><b style={{ flex: 1 }}>{placing.name}</b><X size={14} style={{ cursor: 'pointer' }} onClick={() => { setPlacing(undefined); map.current!.getCanvas().style.cursor = '' }} /></div>
          <div style={{ color: T.warn, fontSize: 12, margin: '4px 0' }}>지도에서 건물 위치를 클릭하세요</div>
          <label style={{ fontSize: 12 }}>회전 <input type="number" value={placing.rotation} onChange={e => setPlacing({ ...placing, rotation: +e.target.value })} style={{ width: 60 }} />°</label>
        </div>}
        {err && <p style={{ color: T.crit, fontSize: 12 }}>{err}</p>}
        {models.map(m => { const f = features.find(f => f.id === m.id); return (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 6px', borderTop: `1px solid ${T.bg.line}` }}>
            <Box size={14} style={{ color: f ? (f.properties.manual ? T.warn : T.accent) : T.ink[3], flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.name}>{m.name}</div>
              <div style={{ color: T.ink[2], fontSize: 11 }}>{f ? `${f.properties.manual ? '수동 배치' : f.properties.georefSource}${f.properties.crs ? ' · ' + f.properties.crs : ''} · ${f.properties.areaM2} m²` : '지리참조 없음 — 배치 → 지도 클릭'}</div>
            </div>
            {f ? <button onClick={() => flyTo(f)} style={btn}>이동</button> : <button onClick={() => startPlacing(m)} style={{ ...btn, borderColor: T.warn, color: T.warn }}>배치</button>}
            {f && <button onClick={() => startPlacing(m)} title="다시 배치" style={btn}><MapPin size={12} /></button>}
          </div>) })}
      </aside>
      <div ref={el} />
    </div>
  )
}

function fitTo(m: maplibregl.Map, fs: Feature[]) {
  const b = new maplibregl.LngLatBounds()
  for (const f of fs) for (const c of f.geometry.coordinates[0]) b.extend(c as [number, number])
  m.fitBounds(b, { padding: 80, maxZoom: 18, duration: 800 })
}
