import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type Kind = 'element' | 'space' | 'opening'
export type Stats = { calls: number; triangles: number; fps: number }
const HIGHLIGHT = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x442200 })
const SPACE = new THREE.MeshStandardMaterial({ color: 0x4488ff, transparent: true, opacity: 0.25, depthWrite: false })

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
  onPick?: (gid: string | undefined, kind: Kind | undefined) => void

  private el: HTMLElement

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
    addEventListener('resize', this.onResize)
    const loop = () => { this.raf = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); this.frames++ }
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
    const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
    this.camera.position.set(c.x + size.x, c.y + size.y * 1.2, c.z + size.z * 1.5); this.controls.target.copy(c); this.controls.update()
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
    for (const m of this.meshes) if (m.name === this.picked) m.material = this.kind.get(m.name) === 'space' ? SPACE : this.original.get(m)!
    this.picked = gid
    if (gid) for (const m of this.meshes) if (m.name === gid) m.material = HIGHLIGHT
    if (this.merged) this.setMerged(true)  // 하이라이트 재질이 자기 그룹으로 분리된다 (+1 draw call)
    this.onPick?.(gid, gid ? this.kind.get(gid) : undefined)
  }

  /** 카메라를 해당 요소로 */
  focus(gid: string) {
    const ms = this.meshes.filter(m => m.name === gid); if (!ms.length) return
    const box = new THREE.Box3(); ms.forEach(m => box.expandByObject(m))
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length()
    this.controls.target.copy(c); this.camera.position.copy(c).add(new THREE.Vector3(r, r * 0.8, r)); this.controls.update()
    this.select(gid)
  }

  stats(): Stats {
    this.renderer.render(this.scene, this.camera)  // 탭이 숨겨져 rAF 가 멈춰도 수치는 최신으로
    const now = performance.now()
    if (now - this.fpsAt > 500) { this.fps = Math.round(this.frames * 1000 / (now - this.fpsAt)); this.frames = 0; this.fpsAt = now }
    return { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, fps: this.fps }
  }

  dispose() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.onResize); this.renderer.dispose(); this.el.removeChild(this.renderer.domElement) }

  private apply() {
    for (const m of this.meshes) m.visible = this.visible(m.name, this.kind.get(m.name)!)
    if (this.merged) this.setMerged(true)  // 병합 모드면 재구성
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
