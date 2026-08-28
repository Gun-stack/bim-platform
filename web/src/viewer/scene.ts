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
  private picked?: string
  private focusSet: Focus
  private colors?: Map<string, number>   // 색상 모드: gid → hex. 없는 요소는 회색
  private colorMats = new Map<number, THREE.Material>()
  private clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)
  private box = new THREE.Box3()
  onPick?: (gid: string | undefined, kind: Kind | undefined) => void

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
      if (down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 3) return  // 드래그는 회전
      this.select(this.pick(e.clientX, e.clientY))
    })
    this.renderer.domElement.addEventListener('dblclick', e => this.fit(this.pick(e.clientX, e.clientY)))
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
    this.scene.add(gltf.scene)
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

  select(gid: string | undefined) {
    this.picked = gid
    this.apply()
    this.onPick?.(gid, gid ? this.kind.get(gid) : undefined)
  }

  get selected() { return this.picked }

  /** glb 에 형상이 있는 요소인지 */
  has(gid: string) { return this.kind.has(gid) }

  /** 색상 모드: gid → 색. undefined 면 원래 재질 */
  setColors(map?: Map<string, number>) { this.colors = map; this.apply() }

  /** 격리(나머지 반투명) / 숨김. undefined 면 복원 */
  setFocus(f: Focus) { this.focusSet = f; this.apply() }

  /** 수평 절단: y 이상을 잘라낸다. null 이면 해제 */
  setClip(y: number | null) {
    this.clipPlane.constant = y ?? 0
    this.renderer.clippingPlanes = y == null ? [] : [this.clipPlane]
  }

  bounds() { return { min: this.box.min.toArray(), max: this.box.max.toArray() } }

  getView(): View { return { p: this.camera.position.toArray().map(n => +n.toFixed(2)), t: this.controls.target.toArray().map(n => +n.toFixed(2)) } }
  setView(v: View) { this.camera.position.fromArray(v.p); this.controls.target.fromArray(v.t); this.controls.update() }

  /** 요소(들) 또는 전체가 화면에 들어오게 */
  fit(gid?: string) {
    const ms = gid ? this.meshes.filter(m => m.name === gid) : []
    const box = ms.length ? ms.reduce((b, m) => b.expandByObject(m), new THREE.Box3()) : this.box
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(c); this.camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1); this.controls.update()
  }

  preset(name: 'home' | 'top' | 'front' | 'side') {
    this.lookFrom({ home: new THREE.Vector3(1, 0.8, 1), top: new THREE.Vector3(0, 1, 0.0001), front: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0) }[name])
    this.fit()
  }

  /** 주어진 방향에서 현재 타깃을 바라보게 (거리 유지). NavCube·프리셋 공용 */
  lookFrom(dir: THREE.Vector3) {
    const t = this.controls.target, d = this.camera.position.distanceTo(t) || this.box.getSize(new THREE.Vector3()).length()
    this.camera.position.copy(t).addScaledVector(dir.clone().normalize(), d); this.controls.update()
  }

  /** 카메라를 해당 요소로 */
  focus(gid: string) {
    const ms = this.meshes.filter(m => m.name === gid); if (!ms.length) return
    const box = new THREE.Box3(); ms.forEach(m => box.expandByObject(m))
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length()
    this.controls.target.copy(c); this.camera.position.copy(c).add(new THREE.Vector3(r, r * 0.8, r)); this.controls.update()
    this.select(gid)
  }

  /** 여러 요소(트리 노드 범위)에 카메라 맞춤 */
  fitAll(gids: string[]) {
    const set = new Set(gids), ms = this.meshes.filter(m => set.has(m.name)); if (!ms.length) return
    const box = ms.reduce((b, m) => b.expandByObject(m), new THREE.Box3())
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(c); this.camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1); this.controls.update()
  }

  /** 호버용: 픽킹만, 선택 안 함 */
  hover(x: number, y: number) { return this.pick(x, y) }

  stats(): Stats {
    this.renderer.render(this.scene, this.camera)  // 탭이 숨겨져 rAF 가 멈춰도 수치는 최신으로
    const now = performance.now()
    if (now - this.fpsAt > 500) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now }
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps }
  }

  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.navCube.dispose(); this.renderer.dispose(); this.el.removeChild(this.renderer.domElement) }

  private apply() {
    for (const m of this.meshes) {
      const gid = m.name, kind = this.kind.get(gid)!, inFocus = !this.focusSet || this.focusSet.gids.has(gid)
      m.visible = this.visible(gid, kind) && (inFocus || this.focusSet?.mode === 'ghost')
      m.material = gid === this.picked ? HIGHLIGHT : !inFocus ? GHOST : kind === 'space' ? SPACE
        : this.colors ? this.colorMat(this.colors.get(gid) ?? 0xd8d8d8) : this.original.get(m)!
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
      hit.userData.dir ? onAxis(hit.userData.dir) : onHome()
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
