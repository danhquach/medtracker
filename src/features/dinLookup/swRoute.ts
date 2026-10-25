// Shared by the service worker (src/sw.ts) and the page (useProductLists), so both use one cache.

export const PRODUCT_CACHE = 'product-data'

/** True only for the app's own products/din.json or products/npn.json, with any query. */
export function isProductDataUrl(url: URL, scope: string): boolean {
  const base = new URL(scope)
  return url.origin === base.origin && (url.pathname === `${base.pathname}products/din.json` || url.pathname === `${base.pathname}products/npn.json`)
}

/** Each data release has its own ?v= URL: once the new copy is stored, delete the old one of that list. */
export async function dropOtherVersions(cache: Cache, url: string): Promise<void> {
  const kept = new URL(url)
  for (const req of await cache.keys()) {
    const u = new URL(req.url)
    if (u.origin === kept.origin && u.pathname === kept.pathname && u.href !== kept.href) await cache.delete(req)
  }
}
