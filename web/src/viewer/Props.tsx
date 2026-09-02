import type { ElementDetail, ElementRow } from '../api'

/** 우측 속성 탭의 표: 단일 요소 Pset 표와 다중 선택 공통 속성. 뷰어 상태와 무관한 순수 표시 */

export function Props({ e }: { e: ElementDetail }) {
  return (
    <>
      <b>{e.ifcClass}</b> <span>{e.name}</span>
      <div style={{ color: '#666', margin: '4px 0 8px' }}>{e.spatialClass} {e.spatialName} · <code>{e.globalId}</code></div>
      {Object.entries(e.properties).filter(([pset]) => pset !== 'Pset_BimStatus').map(([pset, props]) => (
        <details key={pset} open={pset.startsWith('Pset_')}>
          <summary>{pset}</summary>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {Object.entries(props).map(([k, v]) => (
              <tr key={k} style={{ borderTop: '1px solid #eee' }}><td style={{ color: '#666', padding: '2px 4px', whiteSpace: 'nowrap' }}>{k}</td><td style={{ padding: '2px 4px', wordBreak: 'break-all' }}>{String(v)}</td></tr>
            ))}
          </tbody></table>
        </details>
      ))}
      {e.properties.Pset_BimStatus && <details><summary style={{ color: '#999' }}>Pset_BimStatus 원본</summary><pre style={{ fontSize: 11, color: '#666', whiteSpace: 'pre-wrap', margin: '4px 0' }}>{JSON.stringify(e.properties.Pset_BimStatus, null, 1)}</pre></details>}
    </>
  )
}

/** 여러 개 선택: 클래스별 개수 + 공통 Pset (모두 같은 값만, 다르면 —) */
export function MultiProps({ selection, byGid, details }: { selection: string[]; byGid: Map<string, ElementRow>; details: ElementDetail[] }) {
  const classes = new Map<string, number>()
  for (const g of selection) { const c = byGid.get(g)?.ifcClass ?? '(형상만)'; classes.set(c, (classes.get(c) ?? 0) + 1) }
  const common: [string, string][] = []
  if (details.length) {
    const keys = new Set<string>(); for (const d of details) for (const [ps, props] of Object.entries(d.properties)) for (const k of Object.keys(props)) keys.add(ps + '.' + k)
    const order = (k: string) => (k.startsWith('Pset_') || k.startsWith('Qto_') ? '0' : '1') + k
    for (const key of [...keys].sort((a, b) => order(a).localeCompare(order(b)))) {
      const [ps, k] = key.split(/\.(.*)/s), vals = new Set(details.map(d => String(d.properties[ps]?.[k] ?? '')))
      if (vals.size === 1 && !vals.has('')) common.push([key, [...vals][0]])
    }
  }
  return (
    <>
      <b>{selection.length}개 선택</b>
      <table style={{ width: '100%', borderCollapse: 'collapse', margin: '6px 0 10px' }}><tbody>
        {[...classes].sort((a, b) => b[1] - a[1]).map(([c, n]) => <tr key={c} style={{ borderTop: '1px solid #eee' }}><td style={{ padding: '2px 4px' }}>{c}</td><td align="right" style={{ padding: '2px 4px', color: '#666' }}>{n}</td></tr>)}
      </tbody></table>
      {details.length > 0 && <>
        <div style={{ color: '#666', fontSize: 12, marginBottom: 4 }}>공통 속성 {details.length < selection.length && `(앞 ${details.length}개 기준)`}</div>
        {common.length ? <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}><tbody>
          {common.map(([k, v]) => <tr key={k} style={{ borderTop: '1px solid #eee' }}><td title={k} style={{ width: '50%', color: '#666', padding: '2px 4px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</td><td style={{ padding: '2px 4px', overflowWrap: 'anywhere' }}>{v}</td></tr>)}
        </tbody></table> : <div style={{ color: '#999' }}>모두 같은 값인 속성 없음</div>}
      </>}
    </>
  )
}
