import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { boxYup, evict, parse, plan, sse, SSE_PX, tileMode, type Cam, type Tileset } from './tiles'

const K = 950 / (2 * Math.tan(Math.PI / 6))   // 세로 950px · FOV 60°
/** eye 에서 at 을 보는 카메라의 순회 입력 */
function cam(eye: number[], at: number[]): Cam {
  const c = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
  c.position.fromArray(eye); c.lookAt(new THREE.Vector3().fromArray(at)); c.updateMatrixWorld()
  return { eye: c.position.clone(), frustum: new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse)), k: K }
}
const box = (a: number[], b: number[]) => new THREE.Box3(new THREE.Vector3().fromArray(a), new THREE.Vector3().fromArray(b))
/** Y-up: 동 하나(x 0..10, 높이 0..20, z -10..0), 아래층 L(0..10)·위층 U(10..20). 동 오차 1m */
const TS: Tileset = { box: box([0, 0, -10], [10, 20, 0]), site: 'site.glb', buildings: [{ gid: 'B', shell: 'b0.glb', error: 1, box: box([0, 0, -10], [10, 20, 0]),
  storeys: [{ uri: 'L', gid: 'GL', box: box([0, 0, -10], [10, 10, 0]) }, { uri: 'U', gid: 'GU', box: box([0, 10, -10], [10, 20, 0]) }] }] }
const FAR = cam([5, 5, 500], [5, 5, 0]), NEAR = cam([5, 5, 20], [5, 5, -5]), DOWN = cam([5, 5, 5], [5, 0, -10])   // DOWN: 아래층만 절두체 안
const none = new Set<string>()

describe('tileMode', () => {
  it('?tiles=0 끔 · ?tiles=1 켬(tileset 있을 때) · 아니면 3000 요소 이상', () => {
    expect(tileMode('t', 5000, null)).toBe(true); expect(tileMode('t', 2999, null)).toBe(false)
    expect(tileMode('t', 10, '1')).toBe(true); expect(tileMode('t', 5000, '0')).toBe(false); expect(tileMode(undefined, 5000, '1')).toBe(false)
  })
})

describe('boxYup — tileset 상자(Z-up) → 뷰어(Y-up)', () => {
  it('(x,y,z) → (x, z, -y)', () => {
    const b = boxYup([10, 20, 30, 5, 0, 0, 0, 4, 0, 0, 0, 3])
    expect(b.min.toArray()).toEqual([5, 27, -24]); expect(b.max.toArray()).toEqual([15, 33, -16])
  })
  it('parse: 루트 대지 → 동(외피) → 층, 콘텐츠 없는 층은 뺀다', () => {
    const t = { boundingVolume: { box: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }, geometricError: 0 }
    const ts = parse({ root: { ...t, content: { uri: 'site.glb' }, children: [{ ...t, geometricError: 2, content: { uri: 'b0.glb' }, extras: { globalId: 'B' },
      children: [{ ...t, content: { uri: 'b0s0.glb' }, extras: { globalId: 'S' } }, { ...t }] }] } })
    expect(ts.site).toBe('site.glb')
    expect(ts.buildings.map(b => [b.gid, b.shell, b.error, b.storeys.map(s => [s.gid, s.uri])])).toEqual([['B', 'b0.glb', 2, [['S', 'b0s0.glb']]]])
  })
})

describe('sse — 화면 공간 오차', () => {
  it('동 오차 = 대지 대각선/20 이면 거리 ≈ 2.57×대각선 안쪽에서 정제 (홈 뷰 1.1×, 가장 먼 동 ≈ 1.33×)', () => {
    const diag = 100
    expect(sse(diag / 20, 2.5 * diag, K)).toBeGreaterThan(SSE_PX)
    expect(sse(diag / 20, 2.65 * diag, K)).toBeLessThan(SSE_PX)
  })
  it('상자 안(거리 0)이면 무한', () => { expect(sse(1, 0, K)).toBe(Infinity) })
})

describe('plan — 정제·요청·REPLACE', () => {
  it('멀면 외피만: 층 요청 없음', () => {
    const p = plan(TS, FAR, none, none)
    expect(p.want).toEqual([]); expect([...p.shells]).toEqual(['b0.glb']); expect(p.show.size).toBe(0)
  })
  it('가까우면 절두체 안 층을 가까운 순으로, 다 들어오기 전엔 외피 유지', () => {
    const p = plan(TS, NEAR, none, none)
    expect(p.want).toEqual(['L', 'U'])   // 눈(높이 5)에서 L 이 더 가깝다
    expect([...p.shells]).toEqual(['b0.glb'])
  })
  it('필요한 층이 다 들어오면 외피를 숨기고 층을 보인다', () => {
    const p = plan(TS, NEAR, new Set(['L', 'U']), none)
    expect(p.shells.size).toBe(0); expect([...p.show].sort()).toEqual(['L', 'U'])
  })
  it('절두체 밖 층은 요청하지 않고, 필요한 층만 들어와도 외피를 숨긴다', () => {
    const p = plan(TS, DOWN, new Set(['L']), none)
    expect(p.want).toEqual(['L']); expect(p.shells.size).toBe(0)
  })
  it('외피 없는 동은 멀어도 층으로(대신 보일 것이 없다)', () => {
    const p = plan({ ...TS, buildings: [{ ...TS.buildings[0], shell: undefined }] }, FAR, none, none)
    expect(p.want).toEqual(['L', 'U']); expect(p.shells.size).toBe(0)
  })
  it('고정 층은 멀어도 요청·표시(외피와 함께)', () => {
    const p = plan(TS, FAR, new Set(['U']), new Set(['U']))
    expect(p.want).toEqual(['U']); expect([...p.show]).toEqual(['U']); expect([...p.shells]).toEqual(['b0.glb'])
  })
})

describe('evict — 삼각형 예산 LRU', () => {
  const c = [{ uri: 'A', tris: 500, used: 1, dist: 10 }, { uri: 'B', tris: 500, used: 2, dist: 5 }, { uri: 'C', tris: 500, used: 1, dist: 50 }]
  it('필요·고정은 빼고 오래된 것 → 먼 것 순으로 예산 아래까지', () => {
    expect(evict(c, new Set(['B']), 600)).toEqual(['C', 'A'])
    expect(evict(c, new Set(['B']), 1000)).toEqual(['C'])
  })
  it('예산 안이면 아무것도, 전부 필요하면 초과해도 유지', () => {
    expect(evict(c, none, 1500)).toEqual([])
    expect(evict(c, new Set(['A', 'B', 'C']), 0)).toEqual([])
  })
})
