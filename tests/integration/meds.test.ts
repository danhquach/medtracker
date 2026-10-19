import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, newUser } from './helpers'

type U = { client: SupabaseClient; id: string }
let a: U
let b: U

beforeAll(async () => {
  a = await newUser()
  b = await newUser()
})
afterAll(async () => {
  for (const u of [a, b]) if (u) await admin().auth.admin.deleteUser(u.id)
})

const med = (over: Record<string, unknown> = {}) => ({
  name: 'Rpcmed', strength: null, form: 'tablet', notes: null, units_per_dose: 1, stock: 5,
  refill_threshold_days: 7, notify: true, ...over,
})
const daily = { kind: 'daily', times: ['08:00:00'], weekdays: null, interval_days: null, start_date: null, end_date: null }
const count = async (table: string, col: string, val: string) =>
  (await admin().from(table).select('*', { count: 'exact', head: true }).eq(col, val)).count

describe('save_med', () => {
  it('creates med + schedule and ignores user_id/paused from input', async () => {
    const { data, error } = await a.client.rpc('save_med', {
      p_med: med({ user_id: b.id, paused: true }),
      p_schedules: [daily],
    })
    expect(error).toBeNull()
    const row = (await admin().from('medications').select('*').eq('id', data).single()).data!
    expect(row.user_id).toBe(a.id)
    expect(row.paused).toBe(false)
    expect(await count('schedules', 'medication_id', data as string)).toBe(1)
  })

  it('bad schedule on create rolls back: no med row', async () => {
    const name = `Rollback-${crypto.randomUUID()}`
    const { error } = await a.client.rpc('save_med', { p_med: med({ name }), p_schedules: [{ ...daily, kind: 'bogus' }] })
    expect(error).not.toBeNull()
    expect(await count('medications', 'name', name)).toBe(0)
  })

  it('bad schedule on edit rolls back: old schedules and fields intact', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ name: 'Keep' }), p_schedules: [daily] })
    const { error } = await a.client.rpc('save_med', {
      p_med: med({ id, name: 'Changed' }),
      p_schedules: [{ ...daily, kind: 'bogus' }],
    })
    expect(error).not.toBeNull()
    expect((await admin().from('medications').select('name').eq('id', id).single()).data!.name).toBe('Keep')
    expect(await count('schedules', 'medication_id', id as string)).toBe(1)
  })

  it('edit replaces schedules', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [daily, daily] })
    await a.client.rpc('save_med', { p_med: med({ id }), p_schedules: [{ ...daily, kind: 'prn', times: [] }] })
    const rows = (await admin().from('schedules').select('kind').eq('medication_id', id)).data!
    expect(rows).toEqual([{ kind: 'prn' }])
  })

  it("user B cannot save into A's med", async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ name: 'Mine' }), p_schedules: [daily] })
    const { error } = await b.client.rpc('save_med', { p_med: med({ id, name: 'Hijack' }), p_schedules: [] })
    expect(error).not.toBeNull()
    const row = (await admin().from('medications').select('name').eq('id', id).single()).data!
    expect(row.name).toBe('Mine')
    expect(await count('schedules', 'medication_id', id as string)).toBe(1)
  })
})

describe('add_stock', () => {
  it('adds, treats null as 0, rejects qty <= 0, rejects foreign med', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ stock: null }), p_schedules: [] })
    expect((await a.client.rpc('add_stock', { p_med: id, p_qty: 4 })).data).toBe(4)
    expect((await a.client.rpc('add_stock', { p_med: id, p_qty: 0 })).error).not.toBeNull()
    expect((await b.client.rpc('add_stock', { p_med: id, p_qty: 1 })).error).not.toBeNull()
  })

  it('concurrent calls both apply', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ stock: 0 }), p_schedules: [] })
    await Promise.all(Array.from({ length: 5 }, () => a.client.rpc('add_stock', { p_med: id, p_qty: 10 })))
    expect((await admin().from('medications').select('stock').eq('id', id).single()).data!.stock).toBe(50)
  })
})

describe('value checks (MT-4)', () => {
  const rejects = async (p_med: Record<string, unknown>, p_schedules: unknown[]) => {
    const name = `Bad-${crypto.randomUUID()}`
    const { error } = await a.client.rpc('save_med', { p_med: { ...p_med, name }, p_schedules })
    expect(error?.code).toBe('23514')
    expect(await count('medications', 'name', name)).toBe(0)
  }

  it('rejects units_per_dose <= 0', async () => {
    await rejects(med({ units_per_dose: 0 }), [daily])
    await rejects(med({ units_per_dose: -1 }), [daily])
  })
  it('rejects negative stock', () => rejects(med({ stock: -1 }), [daily]))
  it('rejects weekdays outside 1..7', async () => {
    await rejects(med(), [{ ...daily, kind: 'weekdays', weekdays: [0] }])
    await rejects(med(), [{ ...daily, kind: 'weekdays', weekdays: [8] }])
  })
  it('rejects a weekdays schedule with no days', async () => {
    await rejects(med(), [{ ...daily, kind: 'weekdays', weekdays: [] }])
    await rejects(med(), [{ ...daily, kind: 'weekdays', weekdays: null }])
  })
  it('rejects every 0 days, or interval with no days', async () => {
    await rejects(med(), [{ ...daily, kind: 'interval', interval_days: 0, start_date: '2026-01-01' }])
    await rejects(med(), [{ ...daily, kind: 'interval', interval_days: null, start_date: '2026-01-01' }])
  })
  it('accepts valid edge values', async () => {
    const { error } = await a.client.rpc('save_med', {
      p_med: med({ units_per_dose: 0.5, stock: 0 }),
      p_schedules: [
        { ...daily, kind: 'weekdays', weekdays: [1, 7] },
        { ...daily, kind: 'interval', interval_days: 1, start_date: '2026-01-01' },
      ],
    })
    expect(error).toBeNull()
  })
  it('direct table writes are checked too', async () => {
    const { error } = await a.client.from('medications').insert({ user_id: a.id, name: 'Direct', units_per_dose: 0 })
    expect(error?.code).toBe('23514')
  })
  it('updated_at is maintained on any update', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [] })
    await a.client.from('medications').update({ updated_at: '2000-01-01T00:00:00Z' }).eq('id', id)
    const row = (await admin().from('medications').select('updated_at').eq('id', id).single()).data!
    expect(new Date(row.updated_at).getFullYear()).toBeGreaterThan(2000)
  })
})
