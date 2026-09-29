import { useEffect, useState } from 'react'

/** 공개 데모 여부 — nginx 가 DEMO_PUBLIC=1 일 때만 GET /api/config 에 {"demo":true} 를 직접 응답한다(평소엔 api 로 넘어가 404). 앱당 한 번만 묻는다 */
let asked: Promise<boolean> | undefined
export const isDemo = () => asked ??= fetch('/api/config').then(r => r.ok ? r.json() : {}).then((j: { demo?: boolean }) => !!j.demo).catch(() => false)
export const useDemo = () => { const [d, setD] = useState(false); useEffect(() => { isDemo().then(setD) }, []); return d }
