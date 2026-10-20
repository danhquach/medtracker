import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const upd = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({
  currentUserId: () => Promise.resolve('u1'),
  supabase: {
    rpc,
    from: () => ({ update: (v: unknown) => ({ eq: () => (upd(v), Promise.resolve({ error: null })) }) }),
  },
}))
import { addStock, saveMed, setPaused, stopMed } from './meds'

const med = { name: 'A', strength: null, form: null, notes: null, units_per_dose: 1, stock: null, refill_threshold_days: 7, notify: true }
beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 'new-id', error: null })
  upd.mockReset()
})

describe('meds data', () => {
  it('saveMed is a single save_med rpc and returns the id', async () => {
    const scheds = [{ kind: 'prn' as const, times: [], weekdays: null, interval_days: null, start_date: null, end_date: null }]
    expect(await saveMed(med, scheds)).toBe('new-id')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('save_med', { p_med: med, p_schedules: scheds })
  })
  it('saveMed throws rpc errors', async () => {
    rpc.mockResolvedValue({ data: null, error: new Error('nope') })
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
    const [, args] = rpc.mock.calls[0]
    expect(args.p_med).toEqual({ ...med, id: 'm1', stock: undefined })
    expect('stock' in args.p_med).toBe(false)
    expect(args.p_schedules.map((s: { end_date: string | null }) => s.end_date)).toEqual(['2026-10-19', '2026-10-19', '2026-10-01', null])
  })
  it('setPaused updates then regenerates the user doses', async () => {
    await setPaused('m1', true)
    expect(upd).toHaveBeenCalledWith({ paused: true })
    expect(rpc).toHaveBeenCalledWith('regenerate_user_doses')
  })
  it('addStock uses add_stock and rejects qty <= 0', async () => {
    await expect(addStock('m1', 0)).rejects.toThrow()
    await expect(addStock('m1', NaN)).rejects.toThrow()
    await expect(addStock('m1', Infinity)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
    await addStock('m1', 5)
    expect(rpc).toHaveBeenCalledWith('add_stock', { p_med: 'm1', p_qty: 5 })
  })
})
