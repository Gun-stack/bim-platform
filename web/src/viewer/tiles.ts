import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Classify, Scene3D } from './scene'

/** 요소 수가 이 이상이고 tileset 이 있으면 타일 모드 */
export const TILE_MIN = 3000
/** 화면 공간 오차 임계(px) — 넘으면 동 외피를 층 타일로 정제 */
export const SSE_PX = 16
/** 동시 요청 수(고정 타일은 예외 — 즉시) */
export const MAX_REQ = 4
/** 층 타일 삼각형 예산 — 넘으면 안 보이는 타일부터 해제. 보이는·고정 타일은 예산을 넘어도 유지(연성 상한) */
export const TRI_BUDGET = 1_000_000
/** 순회 주기(ms). 카메라가 그대로면 건너뛴다 */
export const TICK_MS = 250

/** 타일 모드 여부: ?tiles=0 강제 끔, ?tiles=1 강제 켬(tileset 이 있을 때), 아니면 요소 수 기준 */
export const tileMode = (tilesetUrl: string | undefined, elementCount: number, q: string | null) =>
  q !== '0' && !!tilesetUrl && (q === '1' || elementCount >= TILE_MIN)

/** 3D Tiles box(Z-up: 중심 3 + 반축 3×3) → 뷰어 Y-up Box3. (x,y,z)_zup → (x, z, -y)_yup. 반축이 기울어도 감싸는 축 정렬 상자 */
export function boxYup(b: number[]): THREE.Box3 {
  const [cx, cy, cz] = b
  const hx = Math.abs(b[3]) + Math.abs(b[6]) + Math.abs(b[9]), hy = Math.abs(b[4]) + Math.abs(b[7]) + Math.abs(b[10]), hz = Math.abs(b[5]) + Math.abs(b[8]) + Math.abs(b[11])
  return new THREE.Box3(new THREE.Vector3(cx - hx, cz - hz, -(cy + hy)), new THREE.Vector3(cx + hx, cz + hz, -(cy - hy)))
}

/** 화면 공간 오차(px): 기하 오차 e(m) 가 거리 d(m) 에서 몇 px 인가. k = 화면 높이(px) / (2·tan(fov/2)). 상자 안(d=0)이면 무한 */
export const sse = (e: number, d: number, k: number) => d <= 0 ? Infinity : e * k / d

type TileJson = { boundingVolume: { box: number[] }; geometricError: number; content?: { uri: string }; children?: TileJson[]; extras?: { globalId?: string } }
export type Storey = { uri: string; gid: string; box: THREE.Box3 }
export type Building = { gid: string; shell?: string; error: number; box: THREE.Box3; storeys: Storey[] }
export type Tileset = { box: THREE.Box3; site?: string; buildings: Building[] }

/** tileset.json(워커 tiles.py) → 뷰어 구조. 루트(ADD, 대지 잔여) → 동(REPLACE, 외피) → 층(잎) 3단만 읽는다 */
export function parse(j: { root: TileJson }): Tileset {
  const r = j.root
  return {
    box: boxYup(r.boundingVolume.box), site: r.content?.uri,
    buildings: (r.children ?? []).map(b => ({
      gid: b.extras?.globalId ?? '', shell: b.content?.uri, error: b.geometricError, box: boxYup(b.boundingVolume.box),
      storeys: (b.children ?? []).filter(s => s.content).map(s => ({ uri: s.content!.uri, gid: s.extras?.globalId ?? '', box: boxYup(s.boundingVolume.box) })),
    })),
  }
}

export type Cam = { eye: THREE.Vector3; frustum: THREE.Frustum; k: number }

/** 순회 한 번의 결정(순수). 동마다 SSE > SSE_PX 면 정제 → 절두체 안 층이 필요.
 *  want: 받을(받은 것 포함) 층 타일 — 고정 먼저, 나머지 가까운 순. show: 보일 층 타일(정제된 동의 받은 층 + 고정). shells: 보일 외피 — REPLACE: 정제된 동의 필요한 층이 다 들어오면 숨김.
 *  dist: 층 타일까지 거리(해제 순서용) */
export function plan(ts: Tileset, cam: Cam, loaded: Set<string>, pinned: Set<string>) {
  const near: { uri: string; d: number }[] = [], show = new Set<string>(), shells = new Set<string>(), dist = new Map<string, number>()
  for (const b of ts.buildings) {
    const refine = !b.shell || sse(b.error, b.box.distanceToPoint(cam.eye), cam.k) > SSE_PX   // 외피가 없는 동(설비 전용 모델)은 대신 보일 것이 없다 — 항상 층으로
    let ready = true
    for (const s of b.storeys) {
      const d = s.box.distanceToPoint(cam.eye); dist.set(s.uri, d)
      if (refine && cam.frustum.intersectsBox(s.box)) { near.push({ uri: s.uri, d }); if (!loaded.has(s.uri)) ready = false }
      if (loaded.has(s.uri) && (refine || pinned.has(s.uri))) show.add(s.uri)   // ponytail: 정제 안 된 동의 고정 층은 외피와 겹쳐 그려진다(건축 요소 이중 반투명) — 외피 메시를 층별로 끄려면 외피에 층 표시가 필요
    }
    if (b.shell && !(refine && ready)) shells.add(b.shell)
  }
  near.sort((a, b) => a.d - b.d)
  return { want: [...new Set([...pinned, ...near.map(n => n.uri)])], show, shells, dist }
}

export type Cached = { uri: string; tris: number; used: number; dist: number }
/** 예산 초과분 해제 목록: keep(필요·고정) 제외, 오래 안 쓴 것 → 먼 것 순으로 예산 아래가 될 때까지 */
export function evict(cached: Cached[], keep: Set<string>, budget: number): string[] {
  let total = cached.reduce((n, c) => n + c.tris, 0)
  const out: string[] = []
  for (const c of cached.filter(c => !keep.has(c.uri)).sort((a, b) => a.used - b.used || b.dist - a.dist)) {
    if (total <= budget) break
    out.push(c.uri); total -= c.tris
  }
  return out
}

/** 3D Tiles 순회기(자체, 의존성 없음). 대지·외피는 처음에 모두 받고 두며(작다), 층 타일만 TICK_MS 마다 plan → 요청 → 표시 → 예산 해제.
 *  요소 지정 기능(선택·추적·펄스·포커스)은 ensureLoaded 로 필요한 층을 고정해 받는다 */
export class Tiles {
  private ts: Tileset
  private base: string
  private scene: Scene3D
  private classify: Classify
  private storeyOf: (gid: string) => string | undefined
  private byStorey = new Map<string, string>()   // 층 GlobalId → 층 타일 uri
  private storeyUris = new Set<string>()
  private loader = new GLTFLoader()
  private loaded = new Map<string, { tris: number; used: number }>()
  private loading = new Map<string, Promise<void>>()
  private failed = new Set<string>()
  private pins = new Map<string, Set<string>>()
  private want: string[] = []
  private sig = ''
  private shownKey = ''
  private added = false
  private tick = 0
  private timer = 0
  private disposed = false

  /** url = tileset.json 절대 URL(콘텐츠 uri 의 기준). storeyOf = 요소·공간 GlobalId → 층 GlobalId (API spatial 조상) */
  constructor(json: { root: TileJson }, url: string, scene: Scene3D, classify: Classify, storeyOf: (gid: string) => string | undefined) {
    this.ts = parse(json); this.base = url; this.scene = scene; this.classify = classify; this.storeyOf = storeyOf
    for (const b of this.ts.buildings) for (const s of b.storeys) { this.byStorey.set(s.gid, s.uri); this.storeyUris.add(s.uri) }
  }

  /** 카메라를 tileset 상자에 맞추고 대지·외피를 받아 보인다(첫 화면). 층 계획은 첫 틱부터 — 딥링크 뷰(?v=)·선택이 먼저 적용되게 */
  async start() {
    this.scene.begin(this.ts.box)
    const fixed = [this.ts.site, ...this.ts.buildings.map(b => b.shell)].filter((u): u is string => !!u)
    await Promise.all(fixed.map(u => this.load(u)))
    if (this.disposed) return   // 대기 중 언마운트 — 죽은 씬에 표시·순회 타이머를 걸지 않는다
    this.scene.setTileShown(u => fixed.includes(u))
    this.timer = window.setInterval(() => this.update(), TICK_MS)
  }

  /** 고정 집합 key(sel·trace·pulse)를 gids 의 층 타일로 교체하고 즉시 받는다. 다 들어오면(실패 포함) resolve */
  ensureLoaded(key: string, gids: string[]): Promise<void> {
    const uris = new Set(gids.map(g => this.tileOf(g)).filter((u): u is string => !!u))
    this.pins.set(key, uris)
    this.update(true)
    return Promise.all([...uris].map(u => this.load(u))).then(() => {})
  }

  /** 이 요소의 층 타일이 들어왔나(층 타일이 없는 요소 = 처음부터 있는 대지 콘텐츠면 true) — '형상 없음' 안내를 로드 전에 띄우지 않게 */
  settled(gid: string) { const u = this.tileOf(gid); return !u || this.loaded.has(u) || this.failed.has(u) }

  /** 통계: 받은 콘텐츠 / 전체, 받을 차례를 기다리는 층 타일 수 */
  count() { return { loaded: this.loaded.size, total: this.storeyUris.size + this.ts.buildings.filter(b => b.shell).length + (this.ts.site ? 1 : 0), pending: this.want.filter(u => !this.loaded.has(u) && !this.failed.has(u)).length } }

  dispose() { this.disposed = true; clearInterval(this.timer) }

  private tileOf(gid: string) { const s = this.storeyOf(gid); return s ? this.byStorey.get(s) : undefined }

  private update(force = false) {
    if (this.disposed || !this.timer) return
    const v = this.scene.tileView()
    if (!force && v.sig === this.sig) return
    this.sig = v.sig; this.tick++
    const pinned = new Set([...this.pins.values()].flatMap(s => [...s]))
    const p = plan(this.ts, v, new Set(this.loaded.keys()), pinned)
    this.want = p.want
    for (const u of p.want) { const c = this.loaded.get(u); if (c) c.used = this.tick }
    for (const u of p.want) if (!this.loaded.has(u) && !this.loading.has(u) && !this.failed.has(u) && (pinned.has(u) || this.loading.size < MAX_REQ)) void this.load(u)
    const cached = [...this.loaded].filter(([u]) => this.storeyUris.has(u)).map(([uri, c]) => ({ uri, tris: c.tris, used: c.used, dist: p.dist.get(uri) ?? Infinity }))
    const gone = evict(cached, new Set(p.want), TRI_BUDGET)
    for (const u of gone) { this.loaded.delete(u); this.scene.removeContent(u) }
    const show = new Set([this.ts.site, ...p.shells, ...[...p.show].filter(u => this.loaded.has(u))].filter((u): u is string => !!u))
    const key = [...show].sort().join()
    if (gone.length || this.added || key !== this.shownKey) { this.shownKey = key; this.added = false; this.scene.setTileShown(u => show.has(u)) }
  }

  private load(uri: string): Promise<void> {
    if (this.loaded.has(uri)) return Promise.resolve()
    let p = this.loading.get(uri)
    if (!p) {
      p = this.loader.loadAsync(new URL(uri, this.base).href).then(g => {
        if (this.disposed) return
        let tris = 0
        g.scene.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3 })
        this.scene.addContent(g.scene, uri, this.classify)
        this.loaded.set(uri, { tris, used: this.tick }); this.added = true; this.failed.delete(uri)   // 고정으로 나중에 성공하면 다음부터 순회기가 다시 요청할 수 있게
      }).catch(e => { this.failed.add(uri); console.warn('타일 로드 실패', uri, e) })
        .finally(() => { this.loading.delete(uri); this.update(true) })
      this.loading.set(uri, p)
    }
    return p
  }
}
