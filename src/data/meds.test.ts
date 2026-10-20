import { beforeEach, describe, expect, it, vi } from 'vitest'

// Writes are offline ops (see offline/sync.ts): assert the op each call queues.
const cache = vi.hoisted(() => ({ meds: [{ id: 'm1', stock: 15 }], schedules: [], doses: [], profile: null }))
const submit = vi.hoisted(() => vi.fn())
vi.mock('./offline/sync', () => ({ submit, readThrough: (f: () => unknown) => f() }))
vi.mock('../lib/supabase', () => ({ currentUserId: () => Promise.resolve('u1'), supabase: {} }))
import { addStock, deleteMed, saveMed, setPaused, stopMed } from './meds'

const queued = () => submit.mock.calls.map(([op]) => op)

const med = { name: 'A', strength: null, form: null, notes: null, units_per_dose: 1, stock: null, refill_threshold_days: 7, notify: true }
beforeEach(() => {
  submit.mockReset()
  submit.mockImplementation((_op: unknown, local: (c: typeof cache) => unknown) => Promise.resolve(local(cache)))
})

describe('meds data', () => {
  it('saveMed create assigns a client id and create=true', async () => {
    const scheds = [{ kind: 'prn' as const, times: [], weekdays: null, interval_days: null, start_date: null, end_date: null }]
    const id = await saveMed(med, scheds)
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    expect(queued()).toEqual([expect.objectContaining({ kind: 'saveMed', create: true, med: { ...med, id }, schedules: scheds })])
  })
  it('saveMed edit keeps the id and create=false', async () => {
    expect(await saveMed({ ...med, id: 'm1' }, [])).toBe('m1')
    expect(queued()[0]).toMatchObject({ kind: 'saveMed', create: false, med: { id: 'm1' } })
  })
  it('saveMed throws when the server rejects it', async () => {
    submit.mockRejectedValue(new Error('nope'))
    await expect(saveMed(med, [])).rejects.toThrow('nope')
  })
  it('stopMed ends open recurring schedules today; keeps earlier ends, as-needed and stock', async () => {
    const full = { ...med, id: 'm1', user_id: 'u1', stock: 5, paused: false, refill_alerted_at: null, created_at: '', updated_at: '' }
    const base = { id: 's', user_id: 'u1', medication_id: 'm1', times: ['09:00:00'], weekdays: null, interval_days: null, start_date: null }
    await stopMed(
      full,
      [
        { ...base, kind: 'daily', end_date: null },
        { ...base, kind: 'daily', end_date: '2026-12-01' },
        { ...base, kind: 'daily', end_date: '2026-10-01' },
        { ...base, kind: 'prn', times: [], end_date: null },
      ],
      '2026-10-19',
    )
    const [op] = queued()
    expect(op.med).toEqual({ ...med, id: 'm1', stock: undefined })
    expect('stock' in op.med).toBe(false)
    expect(op.schedules.map((s: { end_date: string | null }) => s.end_date)).toEqual(['2026-10-19', '2026-10-19', '2026-10-01', null])
  })
  it('setPaused and deleteMed queue one op each', async () => {
    await setPaused('m1', true)
    await deleteMed('m1')
    expect(queued()).toEqual([
      expect.objectContaining({ kind: 'setPaused', medId: 'm1', paused: true }),
      expect.objectContaining({ kind: 'deleteMed', medId: 'm1' }),
    ])
  })
  it('addStock uses add_stock and rejects qty <= 0', async () => {
    await expect(addStock('m1', 0)).rejects.toThrow()
    await expect(addStock('m1', NaN)).rejects.toThrow()
    await expect(addStock('m1', Infinity)).rejects.toThrow()
    expect(submit).not.toHaveBeenCalled()
    expect(await addStock('m1', 5)).toBe(15)
    expect(queued()).toEqual([expect.objectContaining({ kind: 'addStock', medId: 'm1', qty: 5, opId: expect.any(String), at: expect.any(String) })])
  })
})
