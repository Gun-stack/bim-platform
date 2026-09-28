import * as THREE from 'three'
import type { View } from './scene'

/** 카메라 전환 시간(ms) */
export const FLY_MS = 500
/** OS '동작 줄이기' — 켜져 있으면 전환·펄스·흐름·등장 연출을 정적으로 */
export const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** easeInOutCubic. 범위 밖은 0·1 로 클램프 */
export const ease = (k: number) => { const t = Math.min(1, Math.max(0, k)); return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2 }

/** 두 뷰 사이 보간: 타깃은 직선, 카메라는 타깃 기준 방향을 구면 보간 + 거리 선형 — 반대편 프리셋으로 가도 건물을 관통하지 않는다 */
export function interpView(a: View, b: View, k: number): View {
  const e = ease(k)
  const ta = new THREE.Vector3().fromArray(a.t), tb = new THREE.Vector3().fromArray(b.t), t = ta.clone().lerp(tb, e)
  const oa = new THREE.Vector3().fromArray(a.p).sub(ta), ob = new THREE.Vector3().fromArray(b.p).sub(tb)
  const ra = oa.length(), rb = ob.length()
  if (!ra || !rb) return { p: new THREE.Vector3().fromArray(a.p).lerp(new THREE.Vector3().fromArray(b.p), e).toArray(), t: t.toArray() }   // 퇴화: 직선
  const q = new THREE.Quaternion().setFromUnitVectors(oa.normalize(), ob.normalize())
  const dir = oa.applyQuaternion(new THREE.Quaternion().slerp(q, e))   // 항등 → q
  return { p: t.clone().addScaledVector(dir, ra + (rb - ra) * e).toArray(), t: t.toArray() }
}

/** 경보 펄스 주기(초) */
export const PULSE_S = 1.2
/** 경보 펄스 불투명도: 0.15 ↔ 0.6 사인 */
export const pulseOpacity = (t: number) => 0.375 - 0.225 * Math.cos(2 * Math.PI * t / PULSE_S)

/** 흐름 파면 속도(단계/초) */
export const FLOW_SPEED = 6
/** 계통 흐름 파동 밝기(0..1). 파면은 상류 끝에서 하류 끝으로 전진하고 3단계 꼬리를 남긴다. 주기 = 단계 수 + 4(쉼).
 *  하류 추적은 depth 가 클수록 하류, 상류 추적은 depth 가 클수록 상류(원천) — 어느 쪽이든 물리적 흐름 방향으로 흐른다 */
export function flowLevel(t: number, depth: number, maxDepth: number, dir: 'up' | 'down'): number {
  const pos = dir === 'down' ? depth : maxDepth - depth   // 상류 끝 = 0
  const d = (t * FLOW_SPEED) % (maxDepth + 4) - pos       // 파면 뒤쪽 거리
  return d > -1e-9 && d < 3 ? Math.min(1, 1 - d / 3) : 0  // -1e-9: 부동소수 나머지 오차로 파면 칸이 꺼지지 않게
}

/** 후광 텍스처: 가운데 흰 → 가장자리 투명 방사형. 색은 재질 color 가 입힌다 */
let haloTex: THREE.Texture | undefined
const halo = () => {
  if (haloTex) return haloTex
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!, r = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.2, 'rgba(255,255,255,0.9)'); r.addColorStop(0.5, 'rgba(255,255,255,0.3)'); r.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = r; g.fillRect(0, 0, 64, 64)
  return (haloTex = new THREE.CanvasTexture(c))
}

/** 원본 메시 위에 겹쳐 그리는 발광 오버레이 — 지오메트리는 원본 공유(복사·해제 없음), 재질은 키마다 1개.
 *  가산 블렌딩·깊이 무시라 벽 너머로도 보인다. 반투명이라 GTAO 법선 패스에서 빠진다.
 *  withHalo: 요소 중심에 화면 고정 크기 후광 — 감지기처럼 작은 장비도 건물 전체 뷰에서 위치가 읽힌다 */
export class GlowLayer {
  readonly group = new THREE.Group()
  private mats = new Map<number, THREE.MeshBasicMaterial>()
  private haloMats = new Map<number, THREE.SpriteMaterial>()
  private withHalo: boolean
  constructor(withHalo = false) { this.withHalo = withHalo }

  set(items: { mesh: THREE.Mesh; key: number; color: number }[]) {
    this.group.clear()
    for (const m of [...this.mats.values(), ...this.haloMats.values()]) m.dispose()
    this.mats.clear(); this.haloMats.clear()
    for (const { mesh, key, color } of items) {
      let mat = this.mats.get(key)
      if (!mat) { mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }); this.mats.set(key, mat) }
      const o = new THREE.Mesh(mesh.geometry, mat); o.matrixAutoUpdate = false; o.matrix.copy(mesh.matrixWorld); o.renderOrder = 12
      this.group.add(o)
      if (!this.withHalo) continue
      let hm = this.haloMats.get(key)
      if (!hm) { hm = new THREE.SpriteMaterial({ map: halo(), color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, sizeAttenuation: false }); this.haloMats.set(key, hm) }
      const sp = new THREE.Sprite(hm); sp.scale.setScalar(0.035); sp.renderOrder = 12   // 화면 높이의 3.5% ≈ 30px
      new THREE.Box3().setFromObject(mesh).getCenter(sp.position)
      this.group.add(sp)
    }
  }

  /** 키별 불투명도 — 매 프레임. 후광은 저점에서도 0.4 — 펄스 어느 순간에 봐도 위치가 보인다 */
  update(opacity: (key: number) => number) {
    for (const [k, m] of this.mats) m.opacity = opacity(k)
    for (const [k, m] of this.haloMats) m.opacity = 0.4 + 0.6 * Math.min(1, Math.max(0, (opacity(k) - 0.15) / 0.45))
  }
}
