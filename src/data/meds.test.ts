import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({ log: [] as string[], stock: null as number | null }))
vi.mock('../lib/supabase', () => {
  const ok = { data: null, error: null }
  const chain = (table: string) => {
    const c: Record<string, unknown> = {}
    const step = (name: string) => (..._a: unknown[]) => {
      calls.log.push(`${table}.${name}`)
      return c
    }
    for (const n of ['update', 'delete', 'eq', 'insert', 'select']) c[n] = step(n)
    c.single = () => Promise.resolve({ data: { id: 'new-id', stock: calls.stock }, error: null })
    c.then = (res: (v: unknown) => unknown) => Promise.resolve(ok).then(res)
    return c
  }
  return {
    currentUserId: () => Promise.resolve('u1'),
    supabase: {
      from: chain,
      rpc: (n: string, a: unknown) => {
        calls.log.push(`rpc.${n}.${JSON.stringify(a)}`)
        return Promise.resolve({ error: null })
      },
    },
  }
})
import { addStock, saveMed, setPaused } from './meds'

const med = { name: 'A', strength: null, form: null, notes: null, units_per_dose: 1, stock: null, refill_threshold_days: 7, notify: true }
beforeEach(() => (calls.log.length = 0))

describe('meds data', () => {
  it('saveMed inserts, replaces schedules, then regenerates that med', async () => {
    const id = await saveMed(med, [{ kind: 'prn', times: [], weekdays: null, interval_days: null, start_date: null, end_date: null }])
    expect(id).toBe('new-id')
    expect(calls.log).toEqual([
      'medications.insert', 'medications.select',
      'schedules.delete', 'schedules.eq', 'schedules.insert',
      'rpc.regenerate_future_doses.{"p_med":"new-id"}',
    ])
  })
  it('setPaused regenerates the user doses after update', async () => {
    await setPaused('m1', true)
    expect(calls.log.at(-1)).toBe('rpc.regenerate_user_doses.undefined')
    expect(calls.log[0]).toBe('medications.update')
  })
  it('addStock rejects non-positive qty and treats null stock as 0', async () => {
    await expect(addStock('m1', 0)).rejects.toThrow()
    calls.stock = null
    await addStock('m1', 5)
    expect(calls.log).toContain('medications.update')
  })
})
