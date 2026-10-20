import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Medication, Profile } from '../../lib/types'
import type { Op } from './ops'

const rpc = vi.hoisted(() => vi.fn())
const del = vi.hoisted(() => vi.fn())
const select = vi.hoisted(() => vi.fn())
const gte = vi.hoisted(() => vi.fn())
const user = vi.hoisted(() => ({ id: '' }))
vi.mock('../../lib/supabase', () => ({
  currentUserId: () => Promise.resolve(user.id),
  supabase: {
    rpc,
    from: (table: string) => ({
      delete: () => ({ eq: (_c: string, id: string) => del(id) }),
      select: () => {
        const q = { eq: () => q, gte: (c: string, v: string) => (gte(c, v), q), lt: () => q, order: () => q, single: () => q, then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => select(table).then(ok, err) }
        return q
      },
    }),
  },
}))

type Sync = typeof import('./sync')
type StoreMod = typeof import('./store')
let sync: Sync
let store: StoreMod

const profile = { user_id: 'u', time_zone: 'America/Toronto' } as Profile
const med = (stock: number) => ({ id: 'm1', user_id: 'u', name: 'A', units_per_dose: 1, stock, paused: false }) as Medication
const ok = (data: unknown) => Promise.resolve({ data, error: null })
const offline = () => Promise.resolve({ data: null, error: new TypeError('Failed to fetch') })
const addStock = (n: number, qty = 1): Op => ({ opId: `op${n}`, at: new Date().toISOString(), kind: 'addStock', medId: 'm1', qty })

/** Server tables the mocked selects return after a flush. */
let server: { medications: unknown[]; schedules: unknown[]; profiles: unknown; dose_events: unknown[] }

beforeEach(async () => {
  vi.resetModules()
  user.id = crypto.randomUUID()
  rpc.mockReset()
  del.mockReset()
  server = { medications: [med(10)], schedules: [], profiles: profile, dose_events: [] }
  select.mockReset()
  select.mockImplementation((t: keyof typeof server) => ok(server[t]))
  sync = await import('./sync')
  store = await import('./store')
  const s = await store.openStore(user.id)
  await s.writeCache({ meds: [med(10)], schedules: [], doses: [], profile })
  s.close()
})

const outbox = async () => {
  const s = await store.openStore(user.id)
  const items = await s.list()
  s.close()
  return items
}
const stockOf = (c: { meds: Medication[] }) => c.meds[0]?.stock

describe('sync engine', () => {
  it('submit online returns server result and empties outbox', async () => {
    rpc.mockImplementation(() => ((server.medications = [med(15)]), ok(15)))
    expect(await sync.submit(addStock(1, 5), stockOf)).toBe(15)
    expect(rpc).toHaveBeenCalledWith('add_stock', { p_med: 'm1', p_qty: 5, p_op: 'op1' })
    expect(await outbox()).toEqual([])
  })

  it('submit offline returns local result and keeps op pending', async () => {
    rpc.mockImplementation(offline)
    expect(await sync.submit(addStock(1, 5), stockOf)).toBe(15)
    expect((await outbox()).map((i) => [i.op.opId, i.state])).toEqual([['op1', 'pending']])
  })

  it('flush sends ops in order', async () => {
    rpc.mockImplementation(offline)
    for (const n of [1, 2, 3]) await sync.submit(addStock(n), stockOf)
    rpc.mockReset()
    rpc.mockImplementation(() => ok(1))
    await sync.flush()
    expect(rpc.mock.calls.map((c) => c[1].p_op)).toEqual(['op1', 'op2', 'op3'])
    expect(await outbox()).toEqual([])
  })

  it('network error stops flush and keeps order', async () => {
    rpc.mockImplementation(offline)
    for (const n of [1, 2]) await sync.submit(addStock(n), stockOf)
    rpc.mockReset()
    rpc.mockImplementationOnce(() => ok(1)).mockImplementation(offline)
    await sync.flush()
    expect((await outbox()).map((i) => i.op.opId)).toEqual(['op2'])
  })

  it('permanent error marks failed and continues', async () => {
    rpc.mockImplementation(offline)
    for (const n of [1, 2]) await sync.submit(addStock(n), stockOf)
    rpc.mockReset()
    rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { code: 'P0002', message: 'medication not found' } })).mockImplementation(() => ok(1))
    await sync.flush()
    expect((await outbox()).map((i) => [i.op.opId, i.state, i.error])).toEqual([['op1', 'failed', 'medication not found']])
  })

  it('submit throws when its own op fails permanently online', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { code: '22023', message: 'quantity must be greater than 0' } }))
    await expect(sync.submit(addStock(1), stockOf)).rejects.toMatchObject({ message: 'quantity must be greater than 0' })
    expect(await outbox()).toEqual([])
  })

  it.each([503, 502, 429])('a %i server error keeps the op queued instead of dropping it', async (code) => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { code: '', message: 'Unexpected token <' }, status: code }))
    expect(await sync.submit(addStock(1, 5), stockOf)).toBe(15)
    expect((await outbox()).map((i) => [i.op.opId, i.state])).toEqual([['op1', 'pending']])
    expect(sync.getStatus().online).toBe(true)
  })

  it('null result is a permanent failure', async () => {
    rpc.mockImplementation(() => ok(null))
    const op: Op = { opId: 'd', at: new Date().toISOString(), kind: 'doseStatus', medId: 'm1', scheduledFor: '2026-10-20T12:00:00.000Z', status: 'taken' }
    await expect(sync.submit(op, () => null)).rejects.toMatchObject({ code: sync.STALE_DOSE_CODE })
  })

  it('401 sets needsSignIn and keeps op', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: { status: 401, code: 'PGRST301', message: 'JWT expired' } }))
    const seen: boolean[] = []
    sync.subscribe((s) => seen.push(s.needsSignIn))
    await sync.submit(addStock(1), stockOf)
    expect(seen.at(-1)).toBe(true)
    expect((await outbox()).map((i) => i.state)).toEqual(['pending'])
  })

  it('flush retries an op whose response was lost without double effect', async () => {
    let applied = 0
    rpc.mockImplementationOnce(() => (applied++, offline())).mockImplementation((_n: string, a: { p_op: string }) => (a.p_op === 'op1' ? ok(11) : ok(0)))
    await sync.submit(addStock(1), stockOf)
    await sync.flush()
    expect(applied).toBe(1)
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1])
    expect(await outbox()).toEqual([])
  })

  it('concurrent flush calls run the queue once', async () => {
    rpc.mockImplementation(offline)
    await sync.submit(addStock(1), stockOf)
    rpc.mockReset()
    rpc.mockImplementation(() => ok(1))
    await Promise.all([sync.flush(), sync.flush(), sync.flush()])
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('readThrough serves cache while ops are pending', async () => {
    rpc.mockImplementation(offline)
    await sync.submit(addStock(1, 5), stockOf)
    const fetch = vi.fn(() => Promise.resolve([med(99)]))
    const meds = await sync.readThrough(fetch, (c) => c.meds, (c, v) => ({ ...c, meds: v }))
    expect(stockOf({ meds })).toBe(15)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('readThrough writes fresh data through when online', async () => {
    const meds = await sync.readThrough(() => Promise.resolve([med(42)]), (c) => c.meds, (c, v) => ({ ...c, meds: v }))
    expect(stockOf({ meds })).toBe(42)
    const s = await store.openStore(user.id)
    expect(stockOf(await s.readCache())).toBe(42)
    s.close()
  })

  it('readThrough does not cache rows when the user changed during the fetch', async () => {
    const first = user.id
    const meds = await sync.readThrough(
      () => ((user.id = crypto.randomUUID()), Promise.resolve([med(42)])),
      (c) => c.meds,
      (c, v) => ({ ...c, meds: v }),
    )
    expect(stockOf({ meds })).toBe(42)
    const s = await store.openStore(first)
    expect(stockOf(await s.readCache())).toBe(10)
    s.close()
  })

  it('readThrough falls back to cache on a network error', async () => {
    const meds = await sync.readThrough(() => Promise.reject(new TypeError('Failed to fetch')), (c) => c.meds, (c, v) => ({ ...c, meds: v }))
    expect(stockOf({ meds })).toBe(10)
  })

  it('readThrough rethrows a network error when nothing was ever cached', async () => {
    const s = await store.openStore(user.id)
    await s.clear()
    s.close()
    await expect(
      sync.readThrough(() => Promise.reject(new TypeError('Failed to fetch')), (c) => c.meds, (c, v) => ({ ...c, meds: v })),
    ).rejects.toThrow('Failed to fetch')
  })

  it('subscribe reports pending count changes', async () => {
    rpc.mockImplementation(offline)
    const seen: number[] = []
    sync.subscribe((s) => seen.push(s.pending))
    await sync.submit(addStock(1), stockOf)
    rpc.mockImplementation(() => ok(1))
    await sync.flush()
    expect(seen).toContain(1)
    expect(seen.at(-1)).toBe(0)
  })

  it('resetForSignOut deletes this user’s cache and outbox', async () => {
    rpc.mockImplementation(offline)
    await sync.submit(addStock(1), stockOf)
    expect(await sync.pendingCount()).toBe(1)
    await sync.resetForSignOut()
    expect(await outbox()).toEqual([])
  })

  it('a run stops sending when the signed-in user changes mid-flush', async () => {
    rpc.mockImplementation(offline)
    for (const n of [1, 2]) await sync.submit(addStock(n), stockOf)
    rpc.mockReset()
    rpc.mockImplementation(() => ((user.id = crypto.randomUUID()), ok(1)))
    await sync.flush()
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(select).not.toHaveBeenCalled()
  })

  it('resetForSignOut waits for a running flush', async () => {
    rpc.mockImplementation(offline)
    await sync.submit(addStock(1), stockOf)
    let release!: () => void
    rpc.mockReset()
    rpc.mockImplementation(() => new Promise((r) => (release = () => r({ data: 1, error: null }))))
    const flushing = sync.flush()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
    const reset = sync.resetForSignOut()
    release()
    await Promise.all([flushing, reset])
    expect(await outbox()).toEqual([])
  })

  it('resetForSignOut does not wait forever on a hung flush', async () => {
    rpc.mockImplementation(offline)
    await sync.submit(addStock(1), stockOf)
    rpc.mockReset()
    rpc.mockImplementation(() => new Promise(() => {})) // fetch never settles
    void sync.flush()
    await vi.waitFor(() => expect(rpc).toHaveBeenCalled())
    await Promise.race([sync.resetForSignOut(undefined, 50), new Promise((_, rej) => setTimeout(() => rej(new Error('hung')), 1000))])
    expect(await outbox()).toEqual([])
  })

  it('resetForSignOut works before anything opened the store', async () => {
    const s = await store.openStore(user.id)
    await s.enqueue(addStock(1))
    s.close()
    vi.resetModules()
    const fresh = await import('./sync')
    await fresh.resetForSignOut()
    expect(await outbox()).toEqual([])
  })

  it('reopens the store after another tab deleted it', async () => {
    rpc.mockImplementation(offline)
    await sync.submit(addStock(1), stockOf) // opens this tab's connection
    await store.deleteStore(user.id) // e.g. sign-out in another tab closes it
    const meds = await sync.readThrough(() => Promise.resolve([med(7)]), (c) => c.meds, (c, v) => ({ ...c, meds: v }))
    expect(stockOf({ meds })).toBe(7)
    expect(await sync.pendingCount()).toBe(0)
  })

  it('refresh after a write reads a fixed recent dose window', async () => {
    const s = await store.openStore(user.id)
    await s.writeCache({ ...(await s.readCache()), doses: [{ id: 'old', medication_id: 'm1', scheduled_for: '2020-01-01T00:00:00.000Z', status: 'taken' } as never] })
    s.close()
    rpc.mockImplementation(() => ok(11))
    await sync.submit(addStock(1), stockOf)
    const from = Date.parse(gte.mock.calls.at(-1)![1] as string)
    expect(Date.now() - from).toBeLessThanOrEqual(2 * 86_400_000 + 60_000)
  })

  it('deleteMed op goes through a table delete', async () => {
    del.mockImplementation(() => Promise.resolve({ error: null }))
    await sync.submit({ opId: 'x', at: new Date().toISOString(), kind: 'deleteMed', medId: 'm1' }, () => undefined)
    expect(del).toHaveBeenCalledWith('m1')
  })
})
