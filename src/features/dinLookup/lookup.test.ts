import { describe, expect, it } from 'vitest'
import { lookupProduct, productDataUrl, type ListState } from './lookup'
import { PRODUCT_DATA } from './dataVersion'
import type { ListKind, ProductRow } from './types'

const row = (name: string, extra: Partial<ProductRow> = {}): ProductRow =>
  ({ name, form: 'tablet', strength: '500 mg', discontinued: false, ...extra })
const ready = (products: Record<string, ProductRow>): ListState => ({ status: 'ready', products })
const lists = (din: ListState, npn: ListState = { status: 'idle' }): Record<ListKind, ListState> => ({ din, npn })

describe('lookupProduct', () => {
  it('exact match returns the DIN product with kind DIN', () => {
    const r = lookupProduct('02242963', lists(ready({ '02242963': row('Test Tab') })), ['din'])
    expect(r).toEqual({ status: 'match', products: [{ ...row('Test Tab'), number: '02242963', kind: 'DIN' }] })
  })

  it('leading-zero key matches', () => {
    const r = lookupProduct('00000019', lists(ready({ '00000019': row('Zero Cap') })), ['din'])
    expect(r.status).toBe('match')
  })

  it('no fuzzy match for one wrong digit', () => {
    const l = lists(ready({ '02242963': row('A') }), ready({ '80012345': row('B') }))
    expect(lookupProduct('02242964', l, ['din', 'npn'])).toEqual({ status: 'none' })
    expect(lookupProduct('2242963', l, ['din', 'npn'])).toEqual({ status: 'none' })
  })

  it('both lists match returns two products, DIN first', () => {
    const l = lists(ready({ '80012345': row('Drug') }), ready({ '80012345': row('Natural') }))
    const r = lookupProduct('80012345', l, ['din', 'npn'])
    expect(r.status === 'match' && r.products.map((p) => [p.name, p.kind])).toEqual([['Drug', 'DIN'], ['Natural', 'NPN']])
  })

  it('a DIN-HM licence in the NPN list has kind DIN-HM', () => {
    const r = lookupProduct('80012345', lists(ready({}), ready({ '80012345': row('Homeo', { hm: true }) })), ['din', 'npn'])
    expect(r.status === 'match' && r.products[0].kind).toBe('DIN-HM')
  })

  it('list not ready yields unavailable', () => {
    expect(lookupProduct('02242963', lists({ status: 'loading' }), ['din'])).toEqual({ status: 'unavailable' })
    expect(lookupProduct('02242963', lists({ status: 'error' }), ['din'])).toEqual({ status: 'unavailable' })
    expect(lookupProduct('02242963', lists(ready({}), { status: 'error' }), ['din', 'npn'])).toEqual({ status: 'unavailable' })
  })

  it('a match in a ready list wins even while another list is not ready', () => {
    const r = lookupProduct('02242963', lists(ready({ '02242963': row('A') }), { status: 'loading' }), ['din', 'npn'])
    expect(r.status).toBe('match')
  })

  it('npn not shipped yields npn-unavailable', () => {
    expect(lookupProduct('80012345', lists(ready({})), ['din'])).toEqual({ status: 'npn-unavailable' })
  })

  it('all shipped lists ready and no match yields none', () => {
    expect(lookupProduct('80012345', lists(ready({}), ready({})), ['din', 'npn'])).toEqual({ status: 'none' })
  })
})

describe('productDataUrl', () => {
  it('productDataUrl carries the version', () => {
    expect(productDataUrl('din')).toBe(`${location.origin}/products/din.json?v=${PRODUCT_DATA.generatedAt}`)
  })
})
