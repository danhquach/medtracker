import { appUrl } from '../../lib/basePath'
import { PRODUCT_DATA } from './dataVersion'
import type { ListKind, Product, ProductRow } from './types'

export type ListState = { status: 'idle' | 'loading' | 'error' } | { status: 'ready'; products: Record<string, ProductRow> }

export type LookupResult =
  | { status: 'match'; products: Product[] } // 1 normally; 2 if both lists match
  | { status: 'none' }
  | { status: 'unavailable' }
  | { status: 'npn-unavailable' }

const ORDER: ListKind[] = ['din', 'npn']

/** Same-origin URL of a bundled list; the version query makes each data release its own cache entry. */
export function productDataUrl(kind: ListKind): string {
  return appUrl(`products/${kind}.json?v=${PRODUCT_DATA.generatedAt}`)
}

/** Exact-number lookup only: never a near match. */
export function lookupProduct(number: string, lists: Record<ListKind, ListState>, shipped: ListKind[]): LookupResult {
  const products: Product[] = []
  for (const kind of ORDER) {
    const list = lists[kind]
    if (list.status !== 'ready' || !Object.hasOwn(list.products, number)) continue
    const row = list.products[number]
    products.push({ ...row, number, kind: kind === 'din' ? 'DIN' : row.hm ? 'DIN-HM' : 'NPN' })
  }
  if (products.length) return { status: 'match', products }
  if (shipped.some((kind) => lists[kind].status !== 'ready')) return { status: 'unavailable' }
  if (!shipped.includes('npn')) return { status: 'npn-unavailable' }
  return { status: 'none' }
}
