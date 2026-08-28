import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { api, type ElementDetail, type Model } from '../api'

const HIGHLIGHT = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x442200 })

export default function Viewer({ modelId }: { modelId: string }) {
  const canvas = useRef<HTMLDivElement>(null)
  const [model, setModel] = useState<Model>()
  const [selected, setSelected] = useState<ElementDetail | { globalId: string; missing: true }>()
  const [err, setErr] = useState<string>()

  useEffect(() => { api(`/models/${modelId}`).then(setModel).catch(e => setErr(e.message)) }, [modelId])

  useEffect(() => {
    if (!model?.glbUrl || !canvas.current) return
    const el = canvas.current
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xf0f0f0)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 1.5))
    const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(1, 2, 1); scene.add(sun)
    const camera = new THREE.PerspectiveCamera(60, el.clientWidth / el.clientHeight, 0.1, 5000)
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(el.clientWidth, el.clientHeight); renderer.setPixelRatio(devicePixelRatio)
    el.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)

    let picked: THREE.Mesh | undefined, pickedMat: THREE.Material | THREE.Material[] | undefined
    const meshes: THREE.Mesh[] = []
    new GLTFLoader().load(model.glbUrl, gltf => {
      scene.add(gltf.scene)
      gltf.scene.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh) })
      // 모델 전체가 보이도록 카메라 배치
      const box = new THREE.Box3().setFromObject(gltf.scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3())
      camera.position.set(c.x + size.x, c.y + size.y * 1.2, c.z + size.z * 1.5); controls.target.copy(c); controls.update()
    }, undefined, e => setErr(String(e)))

    // 클릭(드래그 아님) → raycast → 노드 이름 = GlobalId
    const ray = new THREE.Raycaster(), down = new THREE.Vector2()
    const onDown = (e: PointerEvent) => down.set(e.clientX, e.clientY)
    const onUp = (e: PointerEvent) => {
      if (down.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 3) return
      const r = renderer.domElement.getBoundingClientRect()
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera)
      const hit = ray.intersectObjects(meshes, false)[0]?.object as THREE.Mesh | undefined
      if (picked) picked.material = pickedMat!
      picked = hit; pickedMat = hit?.material
      if (hit) hit.material = HIGHLIGHT
      const gid = hit?.name || hit?.parent?.name
      if (!gid) return setSelected(undefined)
      api(`/models/${modelId}/elements/${encodeURIComponent(gid)}`).then(setSelected).catch(() => setSelected({ globalId: gid, missing: true }))
    }
    renderer.domElement.addEventListener('pointerdown', onDown); renderer.domElement.addEventListener('pointerup', onUp)

    let raf = 0
    const loop = () => { raf = requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera) }
    loop()
    const onResize = () => { camera.aspect = el.clientWidth / el.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(el.clientWidth, el.clientHeight) }
    addEventListener('resize', onResize)
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', onResize); renderer.dispose(); el.removeChild(renderer.domElement) }
  }, [model?.glbUrl])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: '100vh', fontFamily: 'system-ui' }}>
      <div ref={canvas} style={{ position: 'relative' }}>
        <a href="#/" style={{ position: 'absolute', top: 8, left: 8, background: '#fff', padding: '4px 8px', borderRadius: 4 }}>← 모델 목록</a>
        {err && <p style={{ position: 'absolute', top: 40, left: 8, color: 'crimson' }}>{err}</p>}
      </div>
      <aside style={{ overflow: 'auto', padding: 12, borderLeft: '1px solid #ddd', fontSize: 13 }}>
        <h3 style={{ margin: '0 0 8px' }}>{model?.name ?? '…'}</h3>
        <div style={{ color: '#666' }}>{model?.ifcSchema} · 요소 {model?.elementCount}</div>
        <hr />
        {!selected && <p style={{ color: '#888' }}>요소를 클릭하면 속성이 표시됩니다.</p>}
        {selected && 'missing' in selected && <p>glb 노드 <code>{selected.globalId}</code> 는 element 테이블에 없음 (Opening/Space 등)</p>}
        {selected && !('missing' in selected) && <Props e={selected} />}
      </aside>
    </div>
  )
}

function Props({ e }: { e: ElementDetail }) {
  return (
    <>
      <b>{e.ifcClass}</b> <span>{e.name}</span>
      <div style={{ color: '#666', margin: '4px 0 8px' }}>{e.spatialClass} {e.spatialName} · <code>{e.globalId}</code></div>
      {Object.entries(e.properties).map(([pset, props]) => (
        <details key={pset} open={pset.startsWith('Pset_')}>
          <summary>{pset}</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {Object.entries(props).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #eee' }}><td style={{ color: '#666', padding: '2px 4px', whiteSpace: 'nowrap' }}>{k}</td><td style={{ padding: '2px 4px', wordBreak: 'break-all' }}>{String(v)}</td></tr>
            ))}
          </tbody></table>
        </details>
      ))}
    </>
  )
}
