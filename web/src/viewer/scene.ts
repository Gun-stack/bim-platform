import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Kind = 'element' | 'space' | 'opening'
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
    this.navCube = new NavCube(el, dir => this.lookFrom(dir))
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); this.navCube.sync(this.camera); this.frames++ }
    loop()
  }

  async load(url: string, classify: (gid: string) => Kind) {
    const gltf = await new GLTFLoader().loadAsync(url)
    gltf.scene.traverse(o => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const gid = m.name || m.parent?.name || ''
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
      m.material = gid === this.picked ? HIGHLIGHT : !inFocus ? GHOST : kind === 'space' ? SPACE : this.original.get(m)!
    }
    if (this.merged) this.setMerged(true)  // 병합 모드면 재구성 (하이라이트·고스트가 자기 그룹으로 분리)
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

/** 우하단 방향 큐브. 메인 카메라의 회전만 따라가고, 면을 클릭하면 그 방향에서 보게 한다. */
class NavCube {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  private cube: THREE.Mesh
  private el: HTMLCanvasElement

  constructor(parent: HTMLElement, onFace: (dir: THREE.Vector3) => void) {
    this.el = document.createElement('canvas')
    Object.assign(this.el.style, { position: 'absolute', right: '12px', bottom: '56px', width: '96px', height: '96px', cursor: 'pointer' })
    parent.appendChild(this.el)
    this.renderer = new THREE.WebGLRenderer({ canvas: this.el, alpha: true, antialias: true })
    this.renderer.setSize(96, 96, false); this.renderer.setPixelRatio(devicePixelRatio)
    const face = (t: string) => {
      const c = document.createElement('canvas'); c.width = c.height = 128
      const g = c.getContext('2d')!; g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#999'; g.lineWidth = 6; g.strokeRect(0, 0, 128, 128)
      g.fillStyle = '#333'; g.font = 'bold 34px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(t, 64, 66)
      return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })
    }
    // BoxGeometry 재질 순서: +x -x +y -y +z -z
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ['우', '좌', '상', '하', '앞', '뒤'].map(face))
    this.scene.add(this.cube)
    this.camera.position.set(0, 0, 3.2)
    const dirs = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0.0001), new THREE.Vector3(0, -1, 0.0001), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]
    this.el.addEventListener('click', e => {
      const r = this.el.getBoundingClientRect(), ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera)
      const hit = ray.intersectObject(this.cube)[0]
      if (hit?.face) onFace(dirs[hit.face.materialIndex])
    })
  }

  sync(main: THREE.Camera) {
    this.cube.quaternion.copy(main.quaternion).invert()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() { this.renderer.dispose(); this.el.remove() }
}
