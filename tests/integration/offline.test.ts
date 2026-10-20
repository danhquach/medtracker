// Offline sync (0012): every RPC the outbox replays must be safe to send twice.
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
  name: 'Offmed', strength: null, form: 'tablet', notes: null, units_per_dose: 1, stock: 5,
  refill_threshold_days: 7, notify: true, ...over,
})
const at = (minutesFromNow: number) => {
  const d = new Date(Date.now() + minutesFromNow * 60_000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`
}
const stock = async (id: string) => (await admin().from('medications').select('stock').eq('id', id).single()).data!.stock
const count = async (table: string, col: string, val: string) =>
  (await admin().from(table).select('*', { count: 'exact', head: true }).eq(col, val)).count

async function utcProfile(u: U) {
  await admin().from('profiles').update({ time_zone: 'UTC' }).eq('user_id', u.id)
}

/** A med with one daily dose a few hours ahead (UTC profile), returning its id and that dose. */
async function medWithDose(u: U) {
  await utcProfile(u)
  const { data: id } = await u.client.rpc('save_med', {
    p_med: med(),
    p_schedules: [{ kind: 'daily', times: [at(120)], weekdays: null, interval_days: null, start_date: null, end_date: null }],
  })
  const dose = (await admin().from('dose_events').select('*').eq('medication_id', id).order('scheduled_for').limit(1).single()).data!
  return { id: id as string, dose }
}

describe('save_med create replay', () => {
  it('save_med create replay returns same id and one row', async () => {
    const id = crypto.randomUUID()
    const args = { p_med: med({ id }), p_schedules: [], p_create: true }
    const first = await a.client.rpc('save_med', args)
    const second = await a.client.rpc('save_med', args)
    expect(first.error).toBeNull()
    expect(second.error).toBeNull()
    expect(first.data).toBe(id)
    expect(second.data).toBe(id)
    expect(await count('medications', 'id', id)).toBe(1)
  })

  it("save_med create with another user's id raises 42501", async () => {
    const id = crypto.randomUUID()
    await a.client.rpc('save_med', { p_med: med({ id }), p_schedules: [], p_create: true })
    const { error } = await b.client.rpc('save_med', { p_med: med({ id }), p_schedules: [], p_create: true })
    expect(error?.code).toBe('42501')
  })

  it('save_med edit of deleted med raises P0002', async () => {
    const id = crypto.randomUUID()
    await a.client.rpc('save_med', { p_med: med({ id }), p_schedules: [], p_create: true })
    await a.client.from('medications').delete().eq('id', id)
    const { error } = await a.client.rpc('save_med', { p_med: med({ id }), p_schedules: [] })
    expect(error?.code).toBe('P0002')
  })
})

describe('set_dose_status_at', () => {
  it('set_dose_status_at taken twice decrements stock once', async () => {
    const { id, dose } = await medWithDose(a)
    const args = { p_med: id, p_scheduled_for: dose.scheduled_for, p_status: 'taken', p_acted_at: new Date().toISOString() }
    expect((await a.client.rpc('set_dose_status_at', args)).error).toBeNull()
    expect((await a.client.rpc('set_dose_status_at', args)).error).toBeNull()
    expect(await stock(id)).toBe(4)
  })

  it('set_dose_status_at returns null when no dose at that time', async () => {
    const { id } = await medWithDose(a)
    const { data, error } = await a.client.rpc('set_dose_status_at', {
      p_med: id, p_scheduled_for: '2000-01-01T00:00:00Z', p_status: 'taken',
    })
    expect(error).toBeNull()
    expect(data?.id ?? null).toBeNull()
  })

  it('acted_at is clamped to now for a future client time', async () => {
    const { id, dose } = await medWithDose(a)
    const future = new Date(Date.now() + 86_400_000).toISOString()
    await a.client.rpc('set_dose_status_at', { p_med: id, p_scheduled_for: dose.scheduled_for, p_status: 'skipped', p_acted_at: future })
    const row = (await admin().from('dose_events').select('acted_at').eq('id', dose.id).single()).data!
    expect(Date.parse(row.acted_at)).toBeLessThanOrEqual(Date.now() + 5_000)
  })

  it('acted_at keeps an earlier client time', async () => {
    const { id, dose } = await medWithDose(a)
    const earlier = new Date(Date.now() - 3 * 3_600_000).toISOString()
    await a.client.rpc('set_dose_status_at', { p_med: id, p_scheduled_for: dose.scheduled_for, p_status: 'taken', p_acted_at: earlier })
    const row = (await admin().from('dose_events').select('acted_at').eq('id', dose.id).single()).data!
    expect(Date.parse(row.acted_at)).toBe(Date.parse(earlier))
  })
})

describe('log_prn_dose replay', () => {
  it('log_prn_dose replay with same p_id adds one row and decrements once', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [] })
    const args = { p_med: id, p_id: crypto.randomUUID(), p_at: new Date(Date.now() - 3_600_000).toISOString() }
    await a.client.rpc('log_prn_dose', args)
    await a.client.rpc('log_prn_dose', args)
    expect(await count('dose_events', 'medication_id', id as string)).toBe(1)
    expect(await stock(id as string)).toBe(4)
  })
})

describe('add_stock replay', () => {
  it('add_stock replay with same p_op adds once', async () => {
    const { data: id } = await a.client.rpc('save_med', { p_med: med(), p_schedules: [] })
    const args = { p_med: id, p_qty: 10, p_op: crypto.randomUUID() }
    expect((await a.client.rpc('add_stock', args)).data).toBe(15)
    expect((await a.client.rpc('add_stock', args)).data).toBe(15)
    expect(await stock(id as string)).toBe(15)
  })
})

describe('set_paused / update_profile', () => {
  it('set_paused pauses and removes future pending doses', async () => {
    const { id } = await medWithDose(a)
    expect((await a.client.rpc('set_paused', { p_med: id, p_paused: true })).error).toBeNull()
    expect(await count('dose_events', 'medication_id', id)).toBe(0)
  })

  it('update_profile time zone change regenerates future doses', async () => {
    const { id, dose } = await medWithDose(a)
    const { error } = await a.client.rpc('update_profile', { p_patch: { time_zone: 'Asia/Tokyo' } })
    expect(error).toBeNull()
    const rows = (await admin().from('dose_events').select('scheduled_for').eq('medication_id', id)).data!
    expect(rows.map((r) => r.scheduled_for)).not.toContain(dose.scheduled_for)
  })

  it('update_profile ignores keys outside the allowed list', async () => {
    const before = (await admin().from('profiles').select('password_set').eq('user_id', a.id).single()).data!
    const { error } = await a.client.rpc('update_profile', { p_patch: { password_set: !before.password_set, nickname: 'N' } })
    expect(error).toBeNull()
    const p = (await admin().from('profiles').select('password_set, nickname').eq('user_id', a.id).single()).data!
    expect(p.nickname).toBe('N')
    expect(p.password_set).toBe(before.password_set)
  })
})
