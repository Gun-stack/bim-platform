import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { NavCube } from './NavCube'
import { coverRect } from '../context'
import { T, num } from '../theme'

export type Kind = 'element' | 'space' | 'opening'
const GID = /^[0-9A-Za-z_$]{22}$/
export type Stats = { calls: number; triangles: number; fps: number }
// 선택: 색상 모드의 어떤 팔레트와도 겹치지 않는 마젠타, 반투명 + 항상 앞에(depthTest off) + 외곽선. 가려져 있어도 어디가 선택됐는지 보인다
const HIGHLIGHT = new THREE.MeshBasicMaterial({ color: 0xff2d95, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
const OUTLINE = new THREE.LineBasicMaterial({ color: 0xff2d95, depthTest: false })
const HOVER_OUTLINE = new THREE.LineBasicMaterial({ color: num(T.accent), transparent: true, opacity: 0.85, depthTest: false })
const SPACE = new THREE.MeshStandardMaterial({ color: 0x6a9ad9, transparent: true, opacity: 0.22, depthWrite: false })
const GHOST = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.15, depthWrite: false })   // 어두운 배경에선 유령이 배경보다 밝아야 보인다
const FOCUS_SPACE = new THREE.MeshStandardMaterial({ color: num(T.accent), emissive: 0x24406e, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })
export type View = { p: number[]; t: number[] }
/** 격리: 집합 밖 요소는 반투명(GHOST). undefined 면 해제 */
export type Focus = { gids: Set<string> } | undefined

/** glb 한 개 = 씬 한 개. 노드 이름(GlobalId) 기준으로 분류·필터·픽킹. React 는 이 클래스만 호출한다. */
export class Scene3D {
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: OrbitControls
  private raf = 0
  private frames = 0; private fpsAt = performance.now(); private fps = 0
  /** 원본 메시. 병합 모드에서도 유지(픽킹·재구성용) */
  private meshes: THREE.Mesh[] = []
  private kind = new Map<string, Kind>()
  private original = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private visible: (gid: string, kind: Kind) => boolean = () => true
  private merged?: THREE.Group
  private mergedRanges: { mesh: THREE.Mesh; ranges: { start: number; end: number; gid: string }[] }[] = []
  private picked = new Set<string>()
  private outlines = new THREE.Group()   // 선택 요소 외곽선(EdgesGeometry). apply() 마다 재구성
  private focusSet: Focus
  private focusSpace?: string   // 포커스 모드에서 강조할 IfcSpace
  private colors?: Map<string, number>   // 색상 모드: gid → hex. 없는 요소는 회색 또는 반투명(ghostOthers)
  private ghostOthers = false
  private colorMats = new Map<number, THREE.Material>()
  // 섹션 박스: 축마다 min/max 두 평면. Plane(normal, c): normal·p + c >= 0 인 쪽만 남긴다
  private clipPlanes = [
    new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
    new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Plane(new THREE.Vector3(0, 0, -1), 0)]
  private box = new THREE.Box3()
  onPick?: (gids: string[]) => void
  onContext?: (x: number, y: number) => void
  /** 측정 모드. 클릭마다 점을 찍고 두 점이 모이면 onMeasure. 끄면 스냅 미리보기 점도 정리 */
  private _measuring = false
  get measuring() { return this._measuring }
  set measuring(v: boolean) { this._measuring = v; if (!v) this.clearPreview() }
  /** 스냅: 빈 곳 클릭/호버 시 근처 요소 마그네틱 픽 + 측정 시 꼭짓점·모서리 스냅 */
  snap = true
  private lastSnap = false          // 직전 hitPoint 가 꼭짓점/모서리에 스냅됐는지 (미리보기 점 색·크기)
  private previewDot?: THREE.Mesh   // 측정 중 커서를 따라다니는 스냅 위치 미리보기
  private hoverGroup = new THREE.Group()   // 호버 외곽선 — 마그네틱 픽이 잡은 요소 표시
  private hoveredGid?: string
  onMeasure?: (m: { a: number[]; b: number[]; d: number }) => void
  private measurePt?: THREE.Vector3
  private measureGroup = new THREE.Group()
  private marker?: THREE.Group

  private el: HTMLElement
  private ro: ResizeObserver
  private navCube: NavCube

  constructor(el: HTMLElement) {
    this.el = el
    this.scene.background = new THREE.Color(num(T.bg.base))
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4048, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(1, 2, 1); this.scene.add(sun)
    this.scene.add(this.hoverGroup)
    this.camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 5000)
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(el.clientWidth, el.clientHeight); this.renderer.setPixelRatio(devicePixelRatio)
    el.appendChild(this.renderer.domElement)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    const down = new THREE.Vector2()
    this.renderer.domElement.addEventListener('pointerdown', e => down.set(e.clientX, e.clientY))
    this.renderer.domElement.addEventListener('pointerup', e => {
      if (down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 3) return  // 드래그는 회전/팬
      if (this.measuring && e.button === 0) return this.measureClick(e.clientX, e.clientY)
      const gid = this.pick(e.clientX, e.clientY)
      if (e.button === 2) {   // 우클릭: contextmenu 이벤트는 OrbitControls 의 pointer capture·macOS 순서 문제로 신뢰 못 함 → pointerup 에서 연다
        if (gid && !this.picked.has(gid)) this.select([gid])
        this.onContext?.(e.clientX, e.clientY)
        return
      }
      if (e.metaKey || e.ctrlKey) { if (gid) this.select([gid], 'toggle') }   // Cmd/Ctrl: 토글
      else this.select(gid ? [gid] : [])
    })
    this.renderer.domElement.addEventListener('contextmenu', e => e.preventDefault())   // 브라우저 기본 메뉴만 막는다
    addEventListener('keydown', this.onKey)
    this.renderer.domElement.addEventListener('dblclick', e => { const g = this.pick(e.clientX, e.clientY); this.fitAll(g ? [g] : []) })
    this.ro = new ResizeObserver(this.onResize); this.ro.observe(el)   // 패널 리사이즈 추종
    this.navCube = new NavCube(el, dir => this.lookFrom(dir), () => this.preset('home'))
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); this.navCube.sync(this.camera); this.frames++ }
    loop()
  }

  async load(url: string, classify: (gid: string) => Kind) {
    const gltf = await new GLTFLoader().loadAsync(url)
    gltf.scene.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      // 프리미티브가 여럿인 노드는 GLTFLoader 가 자식 메시를 `GlobalId_0`, `_1` 로 이름 붙인다 → GlobalId 형식(22자)에 맞는 쪽을 취한다
      const gid = [m.name, m.parent?.name].find(n => GID.test(n ?? '')) ?? m.name
      m.name = gid; this.meshes.push(m); this.original.set(m, m.material)
      this.kind.set(gid, classify(gid))
      if (this.kind.get(gid) === 'space') m.material = SPACE
    })
    this.scene.add(gltf.scene); this.scene.add(this.measureGroup); this.scene.add(this.outlines); this.outlines.renderOrder = 9
    this.box.setFromObject(gltf.scene)
    this.preset('home')
    this.apply()
  }

  /** 표시 조건 교체 → 즉시 반영 */
  setVisible(fn: (gid: string, kind: Kind) => boolean) { this.visible = fn; this.apply() }

  /** 병합 모드: 보이는 메시를 재질별로 합쳐 draw call 을 재질 수로 줄인다. 원본은 숨김. */
  setMerged(on: boolean) {
    if (this.merged) { this.scene.remove(this.merged); this.merged.traverse(o => (o as THREE.Mesh).geometry?.dispose()); this.merged = undefined; this.mergedRanges = [] }
    if (on) {
      const byMat = new Map<THREE.Material, THREE.Mesh[]>()
      for (const m of this.meshes) if (m.visible && !Array.isArray(m.material)) (byMat.get(m.material) ?? byMat.set(m.material, []).get(m.material)!).push(m)
      this.merged = new THREE.Group()
      for (const [mat, ms] of byMat) {
        const geos = ms.map(m => { const g = m.geometry.clone().applyMatrix4(m.matrixWorld); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g })
        const g = mergeGeometries(geos, false)
        geos.forEach(x => x.dispose())
        if (!g) continue
        const ranges: { start: number; end: number; gid: string }[] = []
        let start = 0
        // 병합 결과의 index 순서 = 입력 순서. faceIndex*3 이 어느 구간에 속하는지로 요소를 되찾는다
        for (const m of ms) { const cnt = m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count; ranges.push({ start, end: start + cnt, gid: m.name }); start += cnt }
        const mesh = new THREE.Mesh(g, mat); this.merged.add(mesh); this.mergedRanges.push({ mesh, ranges })
      }
      this.scene.add(this.merged)
    }
    for (const m of this.meshes) m.visible = on ? false : this.visible(m.name, this.kind.get(m.name)!)
  }

  /** 선택. set = 교체, toggle = 추가/제거 */
  select(gids: string[], mode: 'set' | 'toggle' = 'set') {
    if (mode === 'set') this.picked = new Set(gids)
    else for (const g of gids) { if (this.picked.has(g)) this.picked.delete(g); else this.picked.add(g) }
    this.apply()
    this.onPick?.([...this.picked])
  }

  get selected() { return [...this.picked] }

  /** glb 에 형상이 있는 요소인지 */
  has(gid: string) { return this.kind.has(gid) }

  /** 색상 모드: gid → 색. undefined 면 원래 재질 */
  setColors(map?: Map<string, number>, ghostOthers = false) { this.colors = map; this.ghostOthers = ghostOthers; this.apply() }

  /** 요소 위치 비콘 (길찾기): 요소에서 건물 지붕 위까지 솟는 기둥 + 머리. 반투명·벽을 뚫고 보이도록 depthTest 끔 */
  setMarker(gid?: string, color = num(T.crit)) {
    if (this.marker) { this.scene.remove(this.marker); this.marker = undefined }
    if (!gid) return
    const ms = this.meshes.filter(m => m.name === gid); if (!ms.length) return
    const box = ms.reduce((b, m) => b.expandByObject(m), new THREE.Box3()), c = box.getCenter(new THREE.Vector3())
    const top = this.box.max.y + 2.5, h = top - c.y
    const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 })
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 8), mat); stem.position.set(c.x, c.y + h / 2, c.z)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), mat); head.position.set(c.x, top, c.z)
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 32), mat); ring.rotation.x = Math.PI / 2; ring.position.set(c.x, c.y, c.z)
    for (const m of [stem, head, ring]) m.renderOrder = 20
    g.add(stem, head, ring); this.marker = g; this.scene.add(g)
  }

  /** 격리(나머지 반투명) / 숨김. undefined 면 복원. space 를 주면 그 구역을 진한 파랑으로 강조 */
  setFocus(f: Focus, space?: string) { this.focusSet = f; this.focusSpace = space; this.apply() }

  private grid?: THREE.GridHelper
  /** 기준 그리드. plane 은 건축(IFC z-up) 기준 이름 — floor=바닥 XY, front=정면 XZ, side=측면 YZ. 픽킹 대상 아님 */
  setGrid(on: boolean, plane: 'floor' | 'front' | 'side' = 'floor', step = 1) {
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.grid = undefined }
    if (!on || this.box.isEmpty() || !(step > 0)) return
    const div = Math.max(2, Math.round(this.box.getSize(new THREE.Vector3()).length() * 1.5 / step))
    const g = new THREE.GridHelper(div * step, div, 0x3a4048, 0x262b32)   // 칸 크기가 정확히 step
    const c = this.box.getCenter(new THREE.Vector3())
    if (plane === 'front') { g.rotation.x = Math.PI / 2; g.position.set(c.x, c.y, this.box.min.z - 0.02) }
    else if (plane === 'side') { g.rotation.z = Math.PI / 2; g.position.set(this.box.min.x - 0.02, c.y, c.z) }
    else g.position.set(c.x, this.box.min.y - 0.02, c.z)   // 바닥 슬래브와 z-fighting 방지
    const m = g.material as THREE.Material; m.transparent = true; m.opacity = 0.6
    this.grid = g; this.scene.add(g)
  }

  /** 섹션 박스 [xmin,xmax,ymin,ymax,zmin,zmax]. null 이면 해제 */
  setClipBox(b: number[] | null) {
    if (!b) { this.renderer.clippingPlanes = []; return }
    for (let a = 0; a < 3; a++) { this.clipPlanes[a * 2].constant = -b[a * 2]; this.clipPlanes[a * 2 + 1].constant = b[a * 2 + 1] }
    this.renderer.clippingPlanes = this.clipPlanes
  }

  bounds() { return { min: this.box.min.toArray(), max: this.box.max.toArray() } }

  /** 현재 화면을 w×h JPEG dataURL 로 (가운데 크롭). render 직후 같은 태스크에서 읽으므로 preserveDrawingBuffer 가 필요 없다. 독·객체 패널의 썸네일용 */
  snapshot(w: number, h: number) {
    this.renderer.render(this.scene, this.camera)
    const src = this.renderer.domElement, c = document.createElement('canvas'); c.width = w; c.height = h
    const r = coverRect(src.width, src.height, w, h)
    c.getContext('2d')!.drawImage(src, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h)
    return c.toDataURL('image/jpeg', 0.7)
  }

  getView(): View { return { p: this.camera.position.toArray().map(n => +n.toFixed(2)), t: this.controls.target.toArray().map(n => +n.toFixed(2)) } }
  setView(v: View) { this.camera.position.fromArray(v.p); this.controls.target.fromArray(v.t); this.controls.update() }

  /** 선택 요소들 또는 전체가 화면에 들어오게 */
  fit() { this.fitAll(this.selected) }

  preset(name: 'home' | 'top' | 'front' | 'side') {
    this.lookFrom({ home: new THREE.Vector3(1, 0.8, 1), top: new THREE.Vector3(0, 1, 0.0001), front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0) }[name])
    this.fitAll([])   // 프리셋은 선택과 무관하게 건물 전체
  }

  /** 주어진 방향에서 현재 타깃을 바라보게 (거리 유지). NavCube·프리셋 공용 */
  lookFrom(dir: THREE.Vector3) {
    const t = this.controls.target, d = this.camera.position.distanceTo(t) || this.box.getSize(new THREE.Vector3()).length()
    this.camera.position.copy(t).addScaledVector(dir.clone().normalize(), d); this.controls.update()
  }

  /** 요소들에 카메라 맞춤. 비었거나 형상이 없으면 전체 */
  fitAll(gids: string[]) {
    const set = new Set(gids), ms = this.meshes.filter(m => set.has(m.name))
    const box = ms.length ? ms.reduce((b, m) => b.expandByObject(m), new THREE.Box3()) : this.box
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(c); this.camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1); this.controls.update()
  }

  private measureClick(x: number, y: number) {
    const hit = this.hitPoint(x, y); if (!hit) return
    if (!this.measurePt) { this.measurePt = hit; this.measureGroup.add(this.dot(hit)); return }
    const a = this.measurePt, b = hit; this.measurePt = undefined
    this.measureGroup.add(this.dot(b))
    this.measureGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: num(T.crit), depthTest: false })))
    const d = a.distanceTo(b)
    this.measureGroup.add(this.label(`${d.toFixed(2)} m`, a.clone().lerp(b, 0.5)))
    this.onMeasure?.({ a: a.toArray(), b: b.toArray(), d })
  }
  clearMeasures() { this.measurePt = undefined; this.measureGroup.clear(); this.previewDot = undefined }   // 미리보기 점은 다음 호버에서 재생성
  private dot(p: THREE.Vector3) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: num(T.crit), depthTest: false })); m.position.copy(p); m.renderOrder = 10; return m }
  private label(text: string, p: THREE.Vector3) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64
    const g = c.getContext('2d')!; g.fillStyle = T.bg.raised; g.strokeStyle = T.bg.line; g.lineWidth = 2; g.beginPath(); g.roundRect(8, 8, 240, 48, 10); g.fill(); g.stroke()
    g.fillStyle = T.ink[1]; g.font = 'bold 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 33)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }))
    sp.scale.set(0.16, 0.04, 1); sp.position.copy(p); sp.renderOrder = 11; return sp
  }
  /** 보이는 면 위의 3D 점 (단면 평면도 존중). snap 이면 히트 삼각형의 꼭짓점(12px 내) → 모서리 순으로 스냅 */
  private hitPoint(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera)
    const targets = this.merged ? this.merged.children : this.meshes.filter(m => m.visible)
    const planes = this.renderer.clippingPlanes
    const hit = ray.intersectObjects(targets, false).find(h => planes.every(p => p.distanceToPoint(h.point) >= 0))
    this.lastSnap = false
    if (!hit) return
    if (!this.snap || !hit.face) return hit.point
    const pos = (hit.object as THREE.Mesh).geometry.attributes.position
    const vs = [hit.face.a, hit.face.b, hit.face.c].map(i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(hit.object.matrixWorld))
    const toScreen = (v: THREE.Vector3) => { const s = v.clone().project(this.camera); return new THREE.Vector2((s.x + 1) / 2 * r.width + r.left, (-s.y + 1) / 2 * r.height + r.top) }
    const mouse = new THREE.Vector2(x, y)
    let best: { d: number; pt: THREE.Vector3 } | undefined
    for (const v of vs) { const d = toScreen(v).distanceTo(mouse); if (d < 12 && (!best || d < best.d)) best = { d, pt: v } }   // 꼭짓점 우선
    if (!best) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
      const cp = new THREE.Line3(vs[a], vs[b]).closestPointToPoint(hit.point, true, new THREE.Vector3())
      const d = toScreen(cp).distanceTo(mouse); if (d < 12 && (!best || d < best.d)) best = { d, pt: cp }
    }
    this.lastSnap = !!best
    return best?.pt ?? hit.point
  }

  /** 호버: 픽킹 + 스냅 피드백 — 잡힌 요소 파란 외곽선·pointer 커서, 측정 중엔 스냅 위치 미리보기 점 */
  hover(x: number, y: number) {
    const gid = this.pick(x, y)
    this.renderer.domElement.style.cursor = gid && !this._measuring ? 'pointer' : ''
    this.setHoverHighlight(this._measuring ? undefined : gid && this.kind.get(gid) === 'element' ? gid : undefined)
    if (this._measuring) this.measurePreview(x, y)
    return gid
  }

  private setHoverHighlight(gid?: string) {
    if (gid === this.hoveredGid) return
    this.hoveredGid = gid
    this.hoverGroup.traverse(o => (o as THREE.LineSegments).geometry?.dispose()); this.hoverGroup.clear()
    if (!gid || this.picked.has(gid)) return   // 선택된 요소는 이미 마젠타 외곽선
    for (const m of this.meshes) if (m.name === gid && m.visible) {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), HOVER_OUTLINE)
      l.matrixAutoUpdate = false; l.matrix.copy(m.matrixWorld); l.renderOrder = 8; this.hoverGroup.add(l)
    }
  }

  private measurePreview(x: number, y: number) {
    const p = this.hitPoint(x, y)
    if (!this.previewDot) { this.previewDot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: num(T.accent), depthTest: false, transparent: true, opacity: 0.9 })); this.previewDot.renderOrder = 10; this.measureGroup.add(this.previewDot) }
    this.previewDot.visible = !!p
    if (p) { this.previewDot.position.copy(p); (this.previewDot.material as THREE.MeshBasicMaterial).color.set(this.lastSnap ? num(T.crit) : num(T.accent)); this.previewDot.scale.setScalar(this.lastSnap ? 1.6 : 1) }   // 스냅되면 빨갛게 커진다
  }

  private clearPreview() { if (this.previewDot) { this.measureGroup.remove(this.previewDot); this.previewDot.geometry.dispose(); (this.previewDot.material as THREE.Material).dispose(); this.previewDot = undefined } }

  stats(): Stats {
    this.renderer.render(this.scene, this.camera)  // 탭이 숨겨져 rAF 가 멈춰도 수치는 최신으로
    const now = performance.now()
    if (now - this.fpsAt > 500) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now }
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps }
  }

  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.select([]) }

  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('keydown', this.onKey); this.navCube.dispose(); this.renderer.dispose(); this.el.removeChild(this.renderer.domElement) }

  private apply() {
    this.outlines.traverse(o => (o as THREE.LineSegments).geometry?.dispose()); this.outlines.clear()
    for (const m of this.meshes) {
      if (this.picked.has(m.name)) { const l = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), OUTLINE); l.matrixAutoUpdate = false; l.matrix.copy(m.matrixWorld); l.renderOrder = 9; this.outlines.add(l) }
      const gid = m.name, kind = this.kind.get(gid)!, inFocus = !this.focusSet || this.focusSet.gids.has(gid)
      m.visible = this.visible(gid, kind)
      m.material = this.picked.has(gid) ? HIGHLIGHT : !inFocus ? GHOST : gid === this.focusSpace ? FOCUS_SPACE : kind === 'space' ? SPACE
        : this.colors ? (this.colors.has(gid) ? this.colorMat(this.colors.get(gid)!) : this.ghostOthers ? GHOST : this.colorMat(0x8b9199)) : this.original.get(m)!   // 색 없음: 채색 요소보다 눌리는 회색
    }
    if (this.merged) this.setMerged(true)  // 병합 모드면 재구성 (하이라이트·고스트가 자기 그룹으로 분리)
  }

  private colorMat(hex: number) {
    let m = this.colorMats.get(hex)
    if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 }); this.colorMats.set(hex, m) }
    return m
  }

  /** 픽 + 마그네틱: 정확히 맞은 게 없으면 주변 8방향 × 반경 8/16px 을 훑어 가까운 요소를 잡는다 */
  private pick(x: number, y: number): string | undefined {
    const g = this.pickOnce(x, y)
    if (g || !this.snap) return g
    for (const rad of [8, 16]) for (let a = 0; a < 8; a++) {
      const g2 = this.pickOnce(x + rad * Math.cos(a * Math.PI / 4), y + rad * Math.sin(a * Math.PI / 4))
      if (g2) return g2
    }
    return undefined
  }

  /** 화면 좌표 → GlobalId. 반투명 공간(구역) 박스가 안의 장비를 가리므로 요소(element) 히트를 우선, 요소가 없을 때만 공간/개구부 */
  private pickOnce(x: number, y: number): string | undefined {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera)
    let gids: (string | undefined)[]
    if (this.merged) {
      gids = ray.intersectObjects(this.merged.children, false).map(hit => {
        if (hit.faceIndex == null) return undefined
        const entry = this.mergedRanges.find(e => e.mesh === hit.object)
        const idx = hit.faceIndex * 3
        return entry?.ranges.find(rg => idx >= rg.start && idx < rg.end)?.gid
      })
    } else gids = ray.intersectObjects(this.meshes.filter(m => m.visible), false).map(h => (h.object as THREE.Mesh).name)
    const found = gids.filter((g): g is string => !!g)
    return found.find(g => this.kind.get(g) === 'element') ?? found[0]
  }

  private onResize = () => { this.camera.aspect = this.el.clientWidth / this.el.clientHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(this.el.clientWidth, this.el.clientHeight) }
}
