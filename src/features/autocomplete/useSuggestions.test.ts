import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Medication } from '../../lib/types'
import { useSuggestions } from './useSuggestions'

const meds = [{ name: 'Ibuprofen' }] as Medication[]
const dpdBody = (names: string[]) => names.map((brand_name) => ({ brand_name }))
const rxBody = (names: string[]) => [names.length, names, { STRENGTHS_AND_FORMS: names.map(() => ['1 mg Tab']) }, []]
const res = (body: unknown) => ({ ok: true, json: async () => body }) as Response

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useSuggestions', () => {
  it('under 3 chars → idle, no fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSuggestions('ib', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.mine).toEqual([])
    expect(result.current.ca).toEqual({ items: [], state: 'idle' })
    expect(result.current.us).toEqual({ items: [], state: 'idle' })
  })

  it('blank input → idle, no fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSuggestions('   ', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.ca.state).toBe('idle')
    expect(result.current.us.state).toBe('idle')
  })

  it('padded input matches own meds and searches the trimmed name', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(res(url.includes('canada.ca') ? dpdBody([]) : rxBody([]))),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ q }) => useSuggestions(q, meds, true), { initialProps: { q: ' ibu ' } })
    expect(result.current.mine.map((s) => s.name)).toEqual(['Ibuprofen'])
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url] of fetchMock.mock.calls) expect(url).not.toMatch(/%20/)
    rerender({ q: 'ibu' })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.ca.state).toBe('done')
  })

  it('remoteEnabled=false → no fetch, mine still shown', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSuggestions('ibu', meds, false))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.mine.map((s) => s.name)).toEqual(['Ibuprofen'])
    expect(result.current.ca.state).toBe('idle')
    expect(result.current.us.state).toBe('idle')
  })

  it('debounces 300 ms then loads both groups', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(res(url.includes('canada.ca') ? dpdBody(['A']) : rxBody(['B']))),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSuggestions('ibu', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.ca.state).toBe('done')
    expect(result.current.ca.items.map((s) => s.name)).toEqual(['A'])
    expect(result.current.us.items.map((s) => s.name)).toEqual(['B'])
  })

  it('ca failing → ca.state=error, us still done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.includes('canada.ca') ? Promise.reject(new TypeError('network')) : Promise.resolve(res(rxBody(['B']))),
      ),
    )
    const { result } = renderHook(() => useSuggestions('ibu', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(result.current.ca.state).toBe('error')
    expect(result.current.us.state).toBe('done')
    expect(result.current.us.items).toHaveLength(1)
  })

  it('us HTTP error → us.state=error, ca still done', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(url.includes('canada.ca') ? res(dpdBody(['A'])) : ({ ok: false, status: 500 } as Response)),
      ),
    )
    const { result } = renderHook(() => useSuggestions('ibu', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(result.current.us).toEqual({ items: [], state: 'error' })
    expect(result.current.ca.state).toBe('done')
    expect(result.current.ca.items.map((s) => s.name)).toEqual(['A'])
  })

  it('a cancelled lookup leaves no error behind', async () => {
    // fetch rejects with AbortError once its signal is aborted, like the real one
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          }),
      ),
    )
    const { result, rerender } = renderHook(({ q }) => useSuggestions(q, meds, true), { initialProps: { q: 'ibu' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    rerender({ q: 'ibup' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    rerender({ q: 'ibu' })
    expect(result.current.ca).toEqual({ items: [], state: 'loading' })
    expect(result.current.us).toEqual({ items: [], state: 'loading' })
  })

  it('closing mid-debounce never fetches', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { unmount } = renderHook(() => useSuggestions('ibu', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(299) })
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('closing mid-lookup aborts both requests', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signals.push(init!.signal as AbortSignal)
        return new Promise<Response>(() => {})
      }),
    )
    const { unmount } = renderHook(() => useSuggestions('ibu', meds, true))
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(signals).toHaveLength(2)
    unmount()
    expect(signals.every((s) => s.aborted)).toBe(true)
  })

  it('latest query wins', async () => {
    const pending: Record<string, (r: Response) => void> = {}
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (!url.includes('canada.ca')) return Promise.resolve(res(rxBody([])))
        const q = new URL(url).searchParams.get('brandname')!
        // deliberately ignore abort so the stale response can still resolve
        return new Promise<Response>((resolve) => { pending[q] = resolve })
      }),
    )
    const { result, rerender } = renderHook(({ q }) => useSuggestions(q, meds, true), { initialProps: { q: 'ibu' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    rerender({ q: 'ibup' })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    await act(async () => { pending['ibup'](res(dpdBody(['FROM-IBUP']))) })
    await act(async () => { pending['ibu'](res(dpdBody(['FROM-IBU']))) })
    expect(result.current.ca.items.map((s) => s.name)).toEqual(['FROM-IBUP'])
    expect(result.current.ca.state).toBe('done')
  })

  it('aborts the previous request on a new query', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        signals.push(init!.signal as AbortSignal)
        return new Promise<Response>(() => {})
      }),
    )
    const { rerender } = renderHook(({ q }) => useSuggestions(q, meds, true), { initialProps: { q: 'ibu' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    rerender({ q: 'ibup' })
    expect(signals[0].aborted).toBe(true)
  })

  it('changing q hides old items immediately (same-active)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(res(url.includes('canada.ca') ? dpdBody([new URL(url).searchParams.get('brandname')!]) : rxBody([]))),
      ),
    )
    const { result, rerender } = renderHook(({ q }) => useSuggestions(q, meds, true), { initialProps: { q: 'ibu' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    expect(result.current.ca.items.map((s) => s.name)).toEqual(['ibu'])
    rerender({ q: 'ibup' })
    expect(result.current.ca.items).toEqual([])
    expect(result.current.ca.state).toBe('loading')
  })

  it('re-activation does not show old query results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(res(url.includes('canada.ca') ? dpdBody(['IBU-RESULT']) : rxBody(['IBU-US']))),
      ),
    )
    const { result, rerender } = renderHook(({ q }) => useSuggestions(q, meds, true), { initialProps: { q: 'ibu' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
    rerender({ q: 'ib' })
    expect(result.current.ca.state).toBe('idle')
    rerender({ q: 'asp' })
    expect(result.current.ca.items).toEqual([])
    expect(result.current.us.items).toEqual([])
  })
})
