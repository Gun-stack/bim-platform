import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Kind = 'element' | 'space' | 'opening'
const GID = /^[0-9A-Za-z_$]{22}$/
export type Stats = { calls: number; triangles: number; fps: number }
const HIGHLIGHT = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x442200 })
const SPACE = new THREE.MeshStandardMaterial({ color: 0x4488ff, transparent: true, opacity: 0.25, depthWrite: false })
const GHOST = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.12, depthWrite: false })
const FOCUS_SPACE = new THREE.MeshStandardMaterial({ color: 0x2563eb, emissive: 0x1e3a8a, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide })
export type View = { p: number[]; t: number[] }
export type Focus = { mode: 'ghost' | 'hide'; gids: Set<string> } | undefined

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
  /** 측정 모드. 클릭마다 점을 찍고 두 점이 모이면 onMeasure */
  measuring = false
  onMeasure?: (m: { a: number[]; b: number[]; d: number }) => void
  private measurePt?: THREE.Vector3
  private measureGroup = new THREE.Group()
  private marker?: THREE.Group

  private el: HTMLElement
  private ro: ResizeObserver
  private navCube: NavCube

  constructor(el: HTMLElement) {
    this.el = el
    this.scene.background = new THREE.Color(0xf0f0f0)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(1, 2, 1); this.scene.add(sun)
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
    this.scene.add(gltf.scene); this.scene.add(this.measureGroup)
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

  get isMerged() { return !!this.merged }

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

  /** 요소의 월드 바운딩 (없으면 undefined) */
  elementBox(gid: string) { const ms = this.meshes.filter(m => m.name === gid); if (!ms.length) return; const b = ms.reduce((b, m) => b.expandByObject(m), new THREE.Box3()); return { min: b.min.toArray(), max: b.max.toArray() } }

  /** 요소 위치 비콘 (길찾기): 요소에서 건물 지붕 위까지 솟는 기둥 + 머리. 반투명·벽을 뚫고 보이도록 depthTest 끔 */
  setMarker(gid?: string, color = 0xdc2626) {
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

  /** 섹션 박스 [xmin,xmax,ymin,ymax,zmin,zmax]. null 이면 해제 */
  setClipBox(b: number[] | null) {
    if (!b) { this.renderer.clippingPlanes = []; return }
    for (let a = 0; a < 3; a++) { this.clipPlanes[a * 2].constant = -b[a * 2]; this.clipPlanes[a * 2 + 1].constant = b[a * 2 + 1] }
    this.renderer.clippingPlanes = this.clipPlanes
  }

  bounds() { return { min: this.box.min.toArray(), max: this.box.max.toArray() } }

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
    this.measureGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false })))
    const d = a.distanceTo(b)
    this.measureGroup.add(this.label(`${d.toFixed(2)} m`, a.clone().lerp(b, 0.5)))
    this.onMeasure?.({ a: a.toArray(), b: b.toArray(), d })
  }
  clearMeasures() { this.measurePt = undefined; this.measureGroup.clear() }
  private dot(p: THREE.Vector3) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false })); m.position.copy(p); m.renderOrder = 10; return m }
  private label(text: string, p: THREE.Vector3) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64
    const g = c.getContext('2d')!; g.fillStyle = '#222'; g.beginPath(); g.roundRect(8, 8, 240, 48, 10); g.fill()
    g.fillStyle = '#fff'; g.font = 'bold 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 33)
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false }))
    sp.scale.set(0.16, 0.04, 1); sp.position.copy(p); sp.renderOrder = 11; return sp
  }
  /** 보이는 면 위의 3D 점 (단면 평면도 존중) */
  private hitPoint(x: number, y: number) {
    const r = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera)
    const targets = this.merged ? this.merged.children : this.meshes.filter(m => m.visible)
    const planes = this.renderer.clippingPlanes
    return ray.intersectObjects(targets, false).find(h => planes.every(p => p.distanceToPoint(h.point) >= 0))?.point
  }

  /** 호버용: 픽킹만, 선택 안 함 */
  hover(x: number, y: number) { return this.pick(x, y) }

  stats(): Stats {
    this.renderer.render(this.scene, this.camera)  // 탭이 숨겨져 rAF 가 멈춰도 수치는 최신으로
    const now = performance.now()
    if (now - this.fpsAt > 500) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now }
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps }
  }

  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.select([]) }

  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); removeEventListener('keydown', this.onKey); this.navCube.dispose(); this.renderer.dispose(); this.el.removeChild(this.renderer.domElement) }

  private apply() {
    for (const m of this.meshes) {
      const gid = m.name, kind = this.kind.get(gid)!, inFocus = !this.focusSet || this.focusSet.gids.has(gid)
      m.visible = this.visible(gid, kind) && (inFocus || this.focusSet?.mode === 'ghost')
      m.material = this.picked.has(gid) ? HIGHLIGHT : !inFocus ? GHOST : gid === this.focusSpace ? FOCUS_SPACE : kind === 'space' ? SPACE
        : this.colors ? (this.colors.has(gid) ? this.colorMat(this.colors.get(gid)!) : this.ghostOthers ? GHOST : this.colorMat(0xd8d8d8)) : this.original.get(m)!
    }
    if (this.merged) this.setMerged(true)  // 병합 모드면 재구성 (하이라이트·고스트가 자기 그룹으로 분리)
  }

  private colorMat(hex: number) {
    let m = this.colorMats.get(hex)
    if (!m) { m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.9 }); this.colorMats.set(hex, m) }
    return m
  }

  private pick(x: number, y: number): string | undefined {
    const r = this.renderer.domElement.getBoundingClientRect()
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), this.camera)
    if (this.merged) {
      const hit = ray.intersectObjects(this.merged.children, false)[0]
      if (!hit || hit.faceIndex == null) return
      const entry = this.mergedRanges.find(e => e.mesh === hit.object)
      const idx = hit.faceIndex * 3
      return entry?.ranges.find(rg => idx >= rg.start && idx < rg.end)?.gid
    }
    return (ray.intersectObjects(this.meshes.filter(m => m.visible), false)[0]?.object as THREE.Mesh | undefined)?.name
  }

  private onResize = () => { this.camera.aspect = this.el.clientWidth / this.el.clientHeight; this.camera.updateProjectionMatrix(); this.renderer.setSize(this.el.clientWidth, this.el.clientHeight) }
}

/** 우하단 XYZ 축 기즈모 (Blender 스타일). 호버하면 구가 커지고 라벨이 뜨며, 클릭하면 그 축에서 본다. 가운데는 홈 뷰. */
class NavCube {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10)
  private root = new THREE.Group()
  private balls: THREE.Mesh[] = []
  private hovered?: THREE.Mesh
  private el: HTMLCanvasElement
  private label: HTMLDivElement

  constructor(parent: HTMLElement, onAxis: (dir: THREE.Vector3) => void, onHome: () => void) {
    this.el = document.createElement('canvas')
    Object.assign(this.el.style, { position: 'absolute', right: '12px', bottom: '56px', width: '96px', height: '96px', cursor: 'pointer' })
    parent.appendChild(this.el)
    this.label = document.createElement('div')
    Object.assign(this.label.style, { position: 'absolute', right: '112px', bottom: '92px', background: '#222', color: '#fff', padding: '2px 8px', borderRadius: '3px', fontSize: '12px', display: 'none', pointerEvents: 'none', whiteSpace: 'nowrap' })
    parent.appendChild(this.label)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.el, alpha: true, antialias: true })
    this.renderer.setSize(96, 96, false); this.renderer.setPixelRatio(devicePixelRatio)
    this.camera.position.set(0, 0, 5)
    // X 빨강, Y 초록(위), Z 파랑 — glb 는 Y-up. 라벨은 건축 관례(정면 = +Z 에서 봄)
    const axes: [THREE.Vector3, number, string, string][] = [
      [new THREE.Vector3(1, 0, 0), 0xe0403a, 'Right', 'Left'],
      [new THREE.Vector3(0, 1, 0), 0x6fa83a, 'Top', 'Bottom'],
      [new THREE.Vector3(0, 0, 1), 0x3a7de0, 'Front', 'Back']]
    const ball = new THREE.SphereGeometry(0.22, 16, 12)
    for (const [dir, color, pos, neg] of axes) {
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 8), new THREE.MeshBasicMaterial({ color }))
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); line.position.copy(dir).multiplyScalar(0.5)
      this.root.add(line)
      for (const sign of [1, -1]) {
        const m = new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: sign > 0 ? 1 : 0.35 }))
        m.position.copy(dir).multiplyScalar(sign)
        m.userData = { dir: dir.clone().multiplyScalar(sign), label: sign > 0 ? pos : neg }
        if (Math.abs(m.userData.dir.y) === 1) m.userData.dir.z = 0.0001   // 위/아래에서 볼 때 OrbitControls 특이점 회피
        this.root.add(m); this.balls.push(m)
      }
    }
    const home = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), new THREE.MeshBasicMaterial({ color: 0x888888 }))
    home.userData = { label: 'Home' }
    this.root.add(home); this.balls.push(home)
    this.scene.add(this.root)

    const pick = (e: MouseEvent) => {
      const r = this.el.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * 2 - 1, y = -((e.clientY - r.top) / r.height) * 2 + 1
      if (Math.hypot(x, y) < 0.14) return home   // 가운데는 축 구에 가려져도 항상 홈
      const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), this.camera)
      return ray.intersectObjects(this.balls)[0]?.object as THREE.Mesh | undefined
    }
    this.el.addEventListener('pointermove', e => this.setHover(pick(e)))
    this.el.addEventListener('pointerleave', () => this.setHover(undefined))
    this.el.addEventListener('click', e => {
      const hit = pick(e); if (!hit) return
      if (hit.userData.dir) onAxis(hit.userData.dir); else onHome()
    })
  }

  private setHover(m: THREE.Mesh | undefined) {
    if (m === this.hovered) return
    this.hovered?.scale.setScalar(1)
    this.hovered = m
    if (m) { m.scale.setScalar(1.35); this.label.textContent = m.userData.label; this.label.style.display = 'block' }
    else this.label.style.display = 'none'
    this.el.style.cursor = m ? 'pointer' : 'default'
  }

  sync(main: THREE.Camera) {
    this.root.quaternion.copy(main.quaternion).invert()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() { this.renderer.dispose(); this.el.remove(); this.label.remove() }
}
