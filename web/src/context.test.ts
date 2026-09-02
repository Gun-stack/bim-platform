import { describe, expect, it } from 'vitest'
import { coverRect, objLinks, pushCapped, selQ } from './context'

describe('pushCapped — 최근 목록·스냅샷 색인', () => {
  const same = (a: string, b: string) => a === b
  it('앞에 넣고, 같은 항목은 맨 앞으로 옮기고, cap 을 넘는 꼬리는 evicted', () => {
    expect(pushCapped(['a', 'b'], 'c', 5, same)).toEqual({ list: ['c', 'a', 'b'], evicted: [] })
    expect(pushCapped(['a', 'b', 'c'], 'b', 5, same).list).toEqual(['b', 'a', 'c'])
    expect(pushCapped(['a', 'b'], 'c', 2, same)).toEqual({ list: ['c', 'a'], evicted: ['b'] })
  })
})

describe('coverRect — 가운데 크롭', () => {
  it('가로로 긴 원본은 좌우를, 세로로 긴 원본은 위아래를 잘라내고 정수로', () => {
    expect(coverRect(1500, 950, 240, 150)).toEqual({ sx: 0, sy: 6, sw: 1500, sh: 938 })   // 1500×950 은 240×150 보다 살짝 세로로 길다
    expect(coverRect(1000, 1000, 240, 150)).toEqual({ sx: 0, sy: 188, sw: 1000, sh: 625 })
    expect(coverRect(480, 300, 240, 150)).toEqual({ sx: 0, sy: 0, sw: 480, sh: 300 })   // 같은 비율 → 전체
    expect(coverRect(300, 900, 240, 150)).toEqual({ sx: 0, sy: 356, sw: 300, sh: 188 })
  })
})

describe('selQ / objLinks — 딥링크', () => {
  it('GlobalId 의 $ 를 인코딩하고, gid 없으면 빈 문자열, focus 는 뷰어 링크에만', () => {
    expect(selQ('0a$b_c')).toBe('?sel=0a%24b_c')
    expect(selQ(null)).toBe('')
    expect(objLinks('m1', 'g$1')).toEqual({ viewer: '#/models/m1?sel=g%241&focus=1', monitor: '#/models/m1/monitor?sel=g%241', fm: '#/models/m1/fm?sel=g%241' })
  })
})
