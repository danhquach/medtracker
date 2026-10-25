import { describe, expect, it, vi } from 'vitest'
import { dropOtherVersions, isProductDataUrl } from './swRoute'

const scope = 'https://example.test/'

describe('isProductDataUrl', () => {
  it('matches din.json and npn.json under the scope with ?v', () => {
    expect(isProductDataUrl(new URL('https://example.test/products/din.json?v=2026-10-25'), scope)).toBe(true)
    expect(isProductDataUrl(new URL('https://example.test/products/npn.json?v=2026-10-25'), scope)).toBe(true)
  })

  it('rejects other origins', () => {
    expect(isProductDataUrl(new URL('https://other.test/products/din.json?v=1'), scope)).toBe(false)
  })

  it('rejects other paths under /products/', () => {
    expect(isProductDataUrl(new URL('https://example.test/products/other.json'), scope)).toBe(false)
    expect(isProductDataUrl(new URL('https://example.test/products/din.json.map'), scope)).toBe(false)
    expect(isProductDataUrl(new URL('https://example.test/x/products/din.json'), scope)).toBe(false)
  })

  it('respects a /medtracker/ scope', () => {
    const sub = 'https://example.test/medtracker/'
    expect(isProductDataUrl(new URL('https://example.test/medtracker/products/din.json?v=1'), sub)).toBe(true)
    expect(isProductDataUrl(new URL('https://example.test/products/din.json?v=1'), sub)).toBe(false)
  })
})

describe('dropOtherVersions', () => {
  const key = (url: string) => ({ url }) as Request

  it('deletes older versions of the same list and keeps everything else', async () => {
    const keys = [
      key('https://example.test/products/din.json?v=2026-09-01'),
      key('https://example.test/products/din.json?v=2026-10-25'),
      key('https://example.test/products/npn.json?v=2026-09-01'),
    ]
    const cache = { keys: vi.fn(async () => keys), delete: vi.fn(async () => true) }
    await dropOtherVersions(cache as unknown as Cache, 'https://example.test/products/din.json?v=2026-10-25')
    expect(cache.delete).toHaveBeenCalledTimes(1)
    expect(cache.delete).toHaveBeenCalledWith(keys[0])
  })
})
