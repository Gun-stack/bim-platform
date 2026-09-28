import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

/** 카메라가 멈춘 뒤 AO 를 켜기까지(ms). 조작 중엔 AO 를 꺼 대형 모델 조작감을 지킨다 */
export const AO_IDLE_MS = 150

/** GTAO 법선·깊이 패스에서 반투명 메시 제외 — X-ray 벽·공간·고스트·발광 오버레이가 AO 를 만들지 않게.
 *  재질 userData.ao 가 켜진 것(X-ray 슬래브)은 예외: 바닥 접지감. 선·점은 원래대로 제외 */
class OpaqueGTAOPass extends GTAOPass {
  declare _visibilityCache: THREE.Object3D[]
  _overrideVisibility() {
    const cache = this._visibilityCache
    this.scene.traverse(o => {
      if (!o.visible) return
      const m = o as THREE.Mesh
      const skip = (o as THREE.Line).isLine || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (m.isMesh && [m.material].flat().some(x => x.transparent && !x.userData.ao))
      if (skip) { o.visible = false; cache.push(o) }
    })
  }
}

/** 장면 draw call 만 센다 — AO 법선 패스·전체화면 합성은 빼서 기존 '렌더:' 수치와 의미를 맞춘다 */
class CountingRenderPass extends RenderPass {
  calls = 0; triangles = 0
  render(...args: Parameters<RenderPass['render']>) {
    const info = args[0].info.render, c = info.calls, t = info.triangles
    super.render(...args)
    this.calls = info.calls - c; this.triangles = info.triangles - t
  }
}

/** 렌더 파이프라인: 장면(MSAA 4×) → GTAO → 출력(sRGB). 루프·스냅샷·통계가 draw() 하나를 거친다 */
export class Pipeline {
  private renderer: THREE.WebGLRenderer
  private camera: THREE.Camera
  private composer: EffectComposer
  private main: CountingRenderPass
  private ao: OpaqueGTAOPass
  private out = new OutputPass()
  private lastMove = -Infinity
  private prevP = new THREE.Vector3()
  private prevQ = new THREE.Quaternion()

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, w: number, h: number) {
    this.renderer = renderer; this.camera = camera
    // 톤매핑 없음(선형 → sRGB 만): Neutral 은 암부를 눌러 다크 테마 배경이 검게 되고, AgX·ACES 는 경보 빨강 같은 의미색 채도를 떨어뜨린다
    renderer.info.autoReset = false                   // 패스가 여러 개 — draw() 가 프레임 시작에 reset
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 }))
    this.main = new CountingRenderPass(scene, camera)
    this.ao = new OpaqueGTAOPass(scene, camera, w, h)
    this.ao.updateGtaoMaterial({ radius: 0.5, samples: 24 })   // 미터 단위 모델 — 설비 접촉부·모서리 크기. 샘플↑ = 근접 시 입자 노이즈↓ (정지 때만 도는 비용)
    this.ao.updatePdMaterial({ samples: 24 })
    this.composer.addPass(this.main); this.composer.addPass(this.ao); this.composer.addPass(this.out)
    this.setSize(w, h)
  }

  setSize(w: number, h: number) { this.composer.setPixelRatio(devicePixelRatio); this.composer.setSize(w, h) }

  /** 한 프레임. 카메라가 움직였으면 AO 를 끄고, AO_IDLE_MS 동안 멈춰 있으면 켠다 */
  draw(now = performance.now()) {
    const c = this.camera
    if (!c.position.equals(this.prevP) || !c.quaternion.equals(this.prevQ)) { this.lastMove = now; this.prevP.copy(c.position); this.prevQ.copy(c.quaternion) }
    this.ao.enabled = now - this.lastMove > AO_IDLE_MS
    this.renderer.info.reset()
    this.composer.render()
  }

  get calls() { return this.main.calls }
  get triangles() { return this.main.triangles }

  dispose() { this.ao.dispose(); this.out.dispose(); this.composer.dispose() }
}
