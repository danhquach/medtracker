import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupProduct, productDataUrl } from './lookup'
import { PRODUCT_DATA } from './dataVersion'
import { __resetProductListsForTests, useProductLists } from './useProductLists'

const file = { generatedAt: '2026-10-25', products: { '02242963': { name: 'Test Tab', form: 'tablet', strength: '500 mg', discontinued: false } } }
const ok = () => new Response(JSON.stringify(file), { status: 200 })

beforeEach(() => __resetProductListsForTests())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useProductLists', () => {
  it('does not fetch until ensure is called', () => {
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProductLists())
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.lists.din.status).toBe('idle')
  })

  it('ensure fetches each shipped list once', async () => {
    const fetchMock = vi.fn(async (_url: string) => ok())
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProductLists())
    await act(async () => { await result.current.ensure() })
    await act(async () => { await result.current.ensure() })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(PRODUCT_DATA.lists.map(productDataUrl))
    expect(result.current.lists.din.status).toBe('ready')
    expect(result.current.lists.npn.status).toBe(PRODUCT_DATA.lists.includes('npn') ? 'ready' : 'idle')
  })

  it('lookup waits for an in-flight load', async () => {
    const pending: (() => void)[] = []
    const release = () => { for (const r of pending.splice(0)) r() }
    const fetchMock = vi.fn(() => new Promise<Response>((r) => { pending.push(() => r(ok())) }))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProductLists())
    let first!: Promise<unknown>
    act(() => { first = result.current.ensure() })
    expect(result.current.lists.din.status).toBe('loading')
    let second: Awaited<ReturnType<typeof result.current.ensure>> | undefined
    const waiting = result.current.ensure().then((l) => { second = l })
    await Promise.resolve()
    expect(second).toBeUndefined()
    await act(async () => { release(); await first; await waiting })
    expect(fetchMock).toHaveBeenCalledTimes(PRODUCT_DATA.lists.length)
    expect(lookupProduct('02242963', second!, PRODUCT_DATA.lists).status).toBe('match')
  })

  it('fetch failure yields unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    const { result } = renderHook(() => useProductLists())
    let lists!: Awaited<ReturnType<typeof result.current.ensure>>
    await act(async () => { lists = await result.current.ensure() })
    expect(lists.din.status).toBe('error')
    expect(result.current.lists.din.status).toBe('error')
    expect(lookupProduct('02242963', lists, PRODUCT_DATA.lists)).toEqual({ status: 'unavailable' })
  })

  it.runIf(PRODUCT_DATA.lists.includes('npn'))('one list failing still loads the other, and an unmatched number is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('npn.json') ? new Response('nope', { status: 503 }) : ok())))
    const { result } = renderHook(() => useProductLists())
    let lists!: Awaited<ReturnType<typeof result.current.ensure>>
    await act(async () => { lists = await result.current.ensure() })
    expect(lists.din.status).toBe('ready')
    expect(lists.npn.status).toBe('error')
    expect(lookupProduct('02242963', lists, PRODUCT_DATA.lists).status).toBe('match')
    expect(lookupProduct('80012345', lists, PRODUCT_DATA.lists)).toEqual({ status: 'unavailable' })
  })

  it('a non-OK response is an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    const { result } = renderHook(() => useProductLists())
    await act(async () => { await result.current.ensure() })
    expect(result.current.lists.din.status).toBe('error')
  })

  it('retry after error fetches again', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockImplementation(async () => ok())
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useProductLists())
    await act(async () => { await result.current.ensure() })
    expect(result.current.lists.din.status).toBe('error')
    await act(async () => { await result.current.ensure() })
    expect(result.current.lists.din.status).toBe('ready')
    expect(fetchMock).toHaveBeenCalledTimes(PRODUCT_DATA.lists.length + 1)
  })

  it('a remounted hook reuses the loaded lists', async () => {
    const fetchMock = vi.fn(async () => ok())
    vi.stubGlobal('fetch', fetchMock)
    const first = renderHook(() => useProductLists())
    await act(async () => { await first.result.current.ensure() })
    first.unmount()
    const { result } = renderHook(() => useProductLists())
    expect(result.current.lists.din.status).toBe('ready')
    await act(async () => { await result.current.ensure() })
    expect(fetchMock).toHaveBeenCalledTimes(PRODUCT_DATA.lists.length)
  })

  it('uncontrolled page writes the response into the product-data cache', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { controller: null } })
    const old = { url: productDataUrl('din').replace(/\?v=.*/, '?v=2000-01-01') } as Request
    const put = vi.fn(async () => {})
    const del = vi.fn(async () => true)
    const open = vi.fn(async () => ({ put, keys: async () => [old], delete: del }))
    vi.stubGlobal('caches', { open })
    const { result } = renderHook(() => useProductLists())
    await act(async () => { await result.current.ensure() })
    expect(open).toHaveBeenCalledWith('product-data')
    expect(put).toHaveBeenCalledWith(productDataUrl('din'), expect.any(Response))
    expect(del).toHaveBeenCalledWith(old)
    expect(result.current.lists.din.status).toBe('ready')
  })

  it('controlled page leaves caching to the service worker', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { controller: {} } })
    const open = vi.fn()
    vi.stubGlobal('caches', { open })
    const { result } = renderHook(() => useProductLists())
    await act(async () => { await result.current.ensure() })
    expect(open).not.toHaveBeenCalled()
  })

  it('a cache write failure does not fail the load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ok()))
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: { controller: null } })
    vi.stubGlobal('caches', { open: vi.fn(async () => { throw new Error('quota') }) })
    const { result } = renderHook(() => useProductLists())
    await act(async () => { await result.current.ensure() })
    expect(result.current.lists.din.status).toBe('ready')
  })
})
