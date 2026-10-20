// Uses the real offline sync engine over fake IndexedDB; only the network (supabase) is mocked.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DoseEvent, Profile } from '../lib/types'

const rpc = vi.hoisted(() => vi.fn())
const select = vi.hoisted(() => vi.fn())
const user = vi.hoisted(() => ({ id: '' }))
vi.mock('../lib/supabase', () => ({
  currentUserId: () => Promise.resolve(user.id),
  supabase: {
    rpc,
    from: (table: string) => ({
      select: () => {
        const q = { eq: () => q, gte: () => q, lt: () => q, order: () => q, single: () => q, then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => select(table).then(ok, err) }
        return q
      },
    }),
  },
}))

type Doses = typeof import('./doses')
let doses: Doses

const profile = { user_id: 'u', time_zone: 'America/Toronto' } as Profile
const dose = (over: Partial<DoseEvent> = {}): DoseEvent => ({
  id: 'd1', user_id: 'u', medication_id: 'm1', scheduled_for: '2026-10-20T12:00:00.000Z', status: 'pending',
  acted_at: null, notified_at: null, snoozed_until: null, ...over,
})
const offline = () => Promise.resolve({ data: null, error: new TypeError('Failed to fetch') })

beforeEach(async () => {
  vi.resetModules()
  user.id = crypto.randomUUID()
  rpc.mockReset()
  select.mockReset()
  const { openStore } = await import('./offline/store')
  const s = await openStore(user.id)
  await s.writeCache({ meds: [{ id: 'm1', user_id: 'u', units_per_dose: 1, stock: 3 } as never], schedules: [], doses: [dose()], profile })
  s.close()
  doses = await import('./doses')
})

describe('doses data offline', () => {
  it('listDoses falls back to cache after a network error', async () => {
    select.mockImplementation(offline)
    expect(await doses.listDoses('2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z')).toEqual([dose()])
    expect(await doses.listDoses('2026-10-22T00:00:00.000Z', '2026-10-23T00:00:00.000Z')).toEqual([])
  })

  it('listDoses online returns and caches the server rows', async () => {
    const fresh = dose({ id: 'd2' })
    select.mockImplementation(() => Promise.resolve({ data: [fresh], error: null }))
    expect(await doses.listDoses('2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z')).toEqual([fresh])
    select.mockImplementation(offline)
    expect((await doses.listDoses('2026-10-20T00:00:00.000Z', '2026-10-21T00:00:00.000Z')).map((d) => d.id)).toEqual(['d2'])
  })

  it('setDoseStatus on a provisional dose queues by med and time', async () => {
    const { openStore } = await import('./offline/store')
    const s = await openStore(user.id)
    await s.writeCache({ ...(await s.readCache()), doses: [dose({ id: 'local:m1:2026-10-20T12:00:00.000Z' })] })
    s.close()
    rpc.mockImplementation(offline)
    const row = await doses.setDoseStatus('local:m1:2026-10-20T12:00:00.000Z', 'taken')
    expect(row).toMatchObject({ status: 'taken', medication_id: 'm1' })
    expect(rpc).toHaveBeenCalledWith('set_dose_status_at', expect.objectContaining({ p_med: 'm1', p_scheduled_for: '2026-10-20T12:00:00.000Z', p_status: 'taken' }))
  })

  it('setDoseStatus returns null when the server no longer has that dose', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }))
    select.mockImplementation(() => Promise.resolve({ data: [], error: null }))
    expect(await doses.setDoseStatus('d1', 'taken')).toBeNull()
  })

  it('setDoseStatus on an uncached dose calls set_dose_status directly', async () => {
    rpc.mockImplementation(() => Promise.resolve({ data: dose({ id: 'zz', status: 'skipped' }), error: null }))
    expect(await doses.setDoseStatus('zz', 'skipped')).toMatchObject({ id: 'zz' })
    expect(rpc).toHaveBeenCalledWith('set_dose_status', { p_dose: 'zz', p_status: 'skipped' })
  })

  it('logPrnDose offline adds a taken dose with a client id', async () => {
    rpc.mockImplementation(offline)
    const row = await doses.logPrnDose('m1')
    expect(row).toMatchObject({ status: 'taken', medication_id: 'm1' })
    expect(rpc).toHaveBeenCalledWith('log_prn_dose', expect.objectContaining({ p_med: 'm1', p_id: row!.id }))
  })
})
