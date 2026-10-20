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

describe('save_med keeps stock on edit (MT-11)', () => {
  it('an edit without a stock key keeps a refill made meanwhile', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ stock: 10 }), p_schedules: [daily] })
    await a.client.rpc('add_stock', { p_med: id, p_qty: 5 })
    const { stock: _stale, ...edit } = med({ id, notes: 'edited' })
    expect((await a.client.rpc('save_med', { p_med: edit, p_schedules: [daily] })).error).toBeNull()
    const row = (await admin().from('medications').select('stock, notes').eq('id', id).single()).data!
    expect(row).toEqual({ stock: 15, notes: 'edited' })
  })

  it('an edit with a stock key still sets it, including null', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ stock: 10 }), p_schedules: [] })
    await a.client.rpc('save_med', { p_med: med({ id, stock: 3 }), p_schedules: [] })
    expect((await admin().from('medications').select('stock').eq('id', id).single()).data!.stock).toBe(3)
    await a.client.rpc('save_med', { p_med: med({ id, stock: null }), p_schedules: [] })
    expect((await admin().from('medications').select('stock').eq('id', id).single()).data!.stock).toBeNull()
  })
})

describe('add_stock', () => {
  it('adds, treats null as 0, rejects qty <= 0, rejects foreign med', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ stock: null }), p_schedules: [] })
    expect((await a.client.rpc('add_stock', { p_med: id, p_qty: 4 })).data).toBe(4)
    expect((await a.client.rpc('add_stock', { p_med: id, p_qty: 0 })).error).not.toBeNull()
    expect((await b.client.rpc('add_stock', { p_med: id, p_qty: 1 })).error).not.toBeNull()
  })

  it('rejects NaN and Infinity (MT-11)', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med({ stock: 1 }), p_schedules: [] })
    for (const p_qty of ['NaN', 'Infinity']) {
      expect((await a.client.rpc('add_stock', { p_med: id, p_qty })).error?.code).toBe('22023')
    }
    expect((await admin().from('medications').select('stock').eq('id', id).single()).data!.stock).toBe(1)
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

describe('save_med backfills earlier today (MT-39)', () => {
  // A zone where it's mid-day, so "1 hour ago" and "in 1 hour" are both today.
  const zone = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles'].find((tz) => {
    const h = Number(new Date().toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }))
    return h >= 2 && h <= 21
  })!
  const hm = (msFromNow: number) =>
    new Date(Date.now() + msFromNow).toLocaleTimeString('en-GB', { timeZone: zone, hour12: false, hour: '2-digit', minute: '2-digit' })
  const at = (times: string[]) => ({ ...daily, times })
  const doses = async (id: string) =>
    (await admin().from('dose_events').select('*').eq('medication_id', id).order('scheduled_for')).data!
  const todayDoses = async (id: string) => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: zone })
    return (await doses(id)).filter((r) => new Date(r.scheduled_for).toLocaleDateString('en-CA', { timeZone: zone }) === today)
  }
  const earlier = hm(-3600_000)
  const later = hm(3600_000)

  beforeAll(async () => {
    expect((await a.client.from('profiles').update({ time_zone: zone }).eq('user_id', a.id)).error).toBeNull()
  })

  it('a new med gets its already-passed dose today, pending and with no reminder', async () => {
    const { data: id, error } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [at([earlier, later])] })
    expect(error).toBeNull()
    const rows = await todayDoses(id as string)
    expect(rows).toHaveLength(2)
    const [past, future] = rows
    expect(new Date(past.scheduled_for) < new Date()).toBe(true)
    expect(past.status).toBe('pending')
    expect(past.notified_at).not.toBeNull()
    expect(future.notified_at).toBeNull()
  })

  it('an edit that adds an earlier time backfills only that time', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [at([later])] })
    expect(await todayDoses(id as string)).toHaveLength(1)
    const { error } = await a.client.rpc('save_med', { p_med: med({ id }), p_schedules: [at([earlier, later])] })
    expect(error).toBeNull()
    expect(await todayDoses(id as string)).toHaveLength(2)
  })

  it('an edit that adds no time does not bring back a missing earlier dose', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [at([earlier])] })
    // Same state as a med paused before its dose time and resumed after it.
    await admin().from('dose_events').delete().eq('medication_id', id)
    const { error } = await a.client.rpc('save_med', { p_med: med({ id, name: 'Renamed' }), p_schedules: [at([earlier])] })
    expect(error).toBeNull()
    expect(await todayDoses(id as string)).toHaveLength(0)
  })

  it("backfill_today_doses does nothing for another user's med", async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [at([earlier])] })
    await admin().from('dose_events').delete().eq('medication_id', id)
    const r = await b.client.rpc('backfill_today_doses', { p_med: id })
    expect(r.error).toBeNull()
    expect(r.data).toBe(0)
    expect(await doses(id as string)).toHaveLength(0)
  })
})
