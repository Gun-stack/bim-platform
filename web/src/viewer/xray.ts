import * as THREE from 'three'

/** X-ray 층위: 수평(슬래브·지붕) = 층 구분, 수직(벽·창·기둥…) = 거의 투명 + 외곽선, 나머지(설비) = 원본 재질 */
export type Tier = 'horizontal' | 'vertical' | 'equipment'
const HORIZONTAL = /^Ifc(Slab|Roof|Covering)/
const VERTICAL = /^Ifc(Wall|CurtainWall|Window|Door|Column|Beam|Stair|Ramp|Railing|Plate|Member)/   // 접두 일치 — StandardCase·Flight 하위형 포함
export const tier = (ifcClass?: string): Tier => !ifcClass ? 'equipment' : HORIZONTAL.test(ifcClass) ? 'horizontal' : VERTICAL.test(ifcClass) ? 'vertical' : 'equipment'

/** 수평: 어두운 반불투명 — 위층이 아래층을 덮되 비친다. userData.ao: GTAO 법선 패스에 참여(설비 바닥 접지감) */
const H = new THREE.MeshStandardMaterial({ color: 0x3a414b, roughness: 0.9, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide })
H.userData.ao = true
/** 수직: 거의 투명 — 설비가 벽 너머로 보인다. 형태는 외곽선이 담당 */
const V = new THREE.MeshStandardMaterial({ color: 0x8a93a0, roughness: 0.9, transparent: true, opacity: 0.08, depthWrite: false, side: THREE.DoubleSide })
export const xrayMat = (t: Tier): THREE.Material | undefined => t === 'horizontal' ? H : t === 'vertical' ? V : undefined

/** 건축 외곽선 — 밝은 회색 얇은 선. 배관 원통은 면마다 선이 생겨 대상에서 뺀다(equipment) */
export const EDGE = new THREE.LineBasicMaterial({ color: 0xa3a9b3, transparent: true, opacity: 0.35, depthWrite: false })
export const edgesOf = (g: THREE.BufferGeometry) => new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), EDGE)
