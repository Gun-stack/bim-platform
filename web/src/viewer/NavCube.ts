import * as THREE from 'three'

/** 우하단 XYZ 축 기즈모 (Blender 스타일). 호버하면 구가 커지고 라벨이 뜨며, 클릭하면 그 축에서 본다. 가운데는 홈 뷰.
 *  자기 렌더러·씬·카메라를 가진 독립 캔버스 — Scene3D 와는 콜백 둘(onAxis·onHome)과 sync() 로만 통한다 */
export class NavCube {
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
