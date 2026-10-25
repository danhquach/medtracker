import { useSyncExternalStore } from 'react'
import { PRODUCT_DATA } from './dataVersion'
import { productDataUrl, type ListState } from './lookup'
import { dropOtherVersions, PRODUCT_CACHE } from './swRoute'
import type { ListKind, ProductFile } from './types'

type Lists = Record<ListKind, ListState>

const IDLE: Lists = { din: { status: 'idle' }, npn: { status: 'idle' } }

// Module-level, so remounting the form doesn't refetch.
let lists: Lists = IDLE
let inflight: Partial<Record<ListKind, Promise<void>>> = {}
const listeners = new Set<() => void>()

function set(kind: ListKind, state: ListState) {
  lists = { ...lists, [kind]: state }
  for (const l of listeners) l()
}

// Before the service worker controls the page (first-ever visit) its route can't see this
// fetch, so store the response in the same cache it uses.
async function cacheIfUncontrolled(url: string, res: Response) {
  if (navigator.serviceWorker?.controller || !('caches' in window)) return
  try {
    const cache = await caches.open(PRODUCT_CACHE)
    await cache.put(url, res)
    await dropOtherVersions(cache, url)
  } catch {
    // Offline lookup just won't survive a reload until the service worker takes over.
  }
}

async function load(kind: ListKind) {
  set(kind, { status: 'loading' })
  try {
    const url = productDataUrl(kind)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const [file] = await Promise.all([res.clone().json() as Promise<ProductFile>, cacheIfUncontrolled(url, res)])
    if (!file?.products || typeof file.products !== 'object') throw new Error('Bad product file')
    set(kind, { status: 'ready', products: file.products })
  } catch {
    set(kind, { status: 'error' })
  } finally {
    delete inflight[kind]
  }
}

/** Starts loading every shipped list that isn't loaded; resolves with the lists once none is loading. */
function ensure(): Promise<Lists> {
  for (const kind of PRODUCT_DATA.lists) {
    const s = lists[kind].status
    if (s === 'idle' || s === 'error') inflight[kind] = load(kind)
  }
  return Promise.all(Object.values(inflight)).then(() => lists)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useProductLists(): { lists: Lists; ensure(): Promise<Lists> } {
  return { lists: useSyncExternalStore(subscribe, () => lists), ensure }
}

export function __resetProductListsForTests() {
  lists = IDLE
  inflight = {}
}
