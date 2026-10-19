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
import { addStock, saveMed, setPaused } from './meds'

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
