import { useEffect, useState } from 'react'

/** 공개 데모 여부 — nginx 가 GET /api/config 에 항상 직접 응답한다(DEMO_PUBLIC=1 이면 {"demo":true}, 아니면 {"demo":false}; api 로는 안 넘어감). 앱당 한 번만 묻는다 */
let asked: Promise<boolean> | undefined
export const isDemo = () => asked ??= fetch('/api/config').then(r => r.ok ? r.json() : {}).then((j: { demo?: boolean }) => !!j.demo).catch(() => false)
export const useDemo = () => { const [d, setD] = useState(false); useEffect(() => { isDemo().then(setD) }, []); return d }
