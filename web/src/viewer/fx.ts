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
