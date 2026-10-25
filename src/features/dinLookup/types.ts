// Shapes of the bundled product lists written by scripts/build-product-data.mjs.

export type ListKind = 'din' | 'npn'

export type ProductRow = {
  name: string
  form: 'tablet' | 'capsule' | 'liquid' | 'other'
  strength: string
  discontinued: boolean
  /** npn list only: the number is a DIN-HM, shown as "DIN-HM" not "NPN". */
  hm?: true
}

export type ProductFile = { generatedAt: string; products: Record<string, ProductRow> }

export type Product = ProductRow & { number: string; kind: 'DIN' | 'NPN' | 'DIN-HM' }

export type ScanResult = { cancelled: true } | { cancelled: false; blocks: { text: string; lines: string[] }[] }
