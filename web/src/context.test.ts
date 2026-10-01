import { describe, expect, it } from 'vitest'
import { objLinks, selQ } from './context'

describe('selQ / objLinks — 딥링크', () => {
  it('GlobalId 의 $ 를 인코딩하고, gid 없으면 빈 문자열, focus 는 뷰어 링크에만', () => {
    expect(selQ('0a$b_c')).toBe('?sel=0a%24b_c')
    expect(selQ(null)).toBe('')
    expect(objLinks('m1', 'g$1')).toEqual({ viewer: '#/models/m1?sel=g%241&focus=1', monitor: '#/models/m1/monitor?sel=g%241', fm: '#/models/m1/fm?sel=g%241' })
  })
})
