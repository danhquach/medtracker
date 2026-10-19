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

type Sched = {
  kind: 'daily' | 'weekdays' | 'interval' | 'prn'
  times?: string[]
  weekdays?: number[]
  interval_days?: number
  start_date?: string
  end_date?: string
}

async function mkMed(
  u: U,
  fields: Record<string, unknown> = {},
  sched: Sched | null = { kind: 'daily', times: ['08:00'] },
): Promise<string> {
  const med = await u.client
    .from('medications')
    .insert({ user_id: u.id, name: 'Med', ...fields })
    .select('id')
    .single()
  expect(med.error).toBeNull()
  const id = med.data!.id as string
  if (sched) {
    const s = await u.client.from('schedules').insert({ user_id: u.id, medication_id: id, ...sched })
    expect(s.error).toBeNull()
  }
  return id
}

async function doses(medId: string) {
  const r = await admin()
    .from('dose_events')
    .select('*')
    .eq('medication_id', medId)
    .order('scheduled_for')
  expect(r.error).toBeNull()
  return r.data!
}

const utc = (rows: { scheduled_for: string }[]) => rows.map((r) => new Date(r.scheduled_for).toISOString())

function localHm(iso: string, tz: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function gen(u: U, from: string, to: string) {
  const r = await admin().rpc('generate_doses_for', { p_user: u.id, p_from: from, p_to: to })
  expect(r.error).toBeNull()
  return r.data as number
}

async function stockOf(medId: string) {
  const r = await admin().from('medications').select('stock').eq('id', medId).single()
  expect(r.error).toBeNull()
  return r.data!.stock as number | null
}

async function seedDose(u: U, medId: string, whenMsFromNow = 0) {
  const r = await u.client
    .from('dose_events')
    .insert({
      user_id: u.id,
      medication_id: medId,
      scheduled_for: new Date(Date.now() + whenMsFromNow).toISOString(),
    })
    .select('id')
    .single()
  expect(r.error).toBeNull()
  return r.data!.id as string
}

const setStatus = (u: U, id: string, status: string) =>
  u.client.rpc('set_dose_status', { p_dose: id, p_status: status })

describe('generation', () => {
  it('daily 08:00 and 20:00 -> 4 rows for today+tomorrow', async () => {
    const med = await mkMed(a, {}, { kind: 'daily', times: ['08:00', '20:00'] })
    const r = await a.client.rpc('generate_doses', { p_user: a.id })
    expect(r.error).toBeNull()
    const rows = await doses(med)
    // tomorrow's 2 rows always; today's only if still in the future (no backfill)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows.length).toBeLessThanOrEqual(4)
    expect(r.data).toBeGreaterThanOrEqual(rows.length)
    const all = await gen(a, '2099-01-01', '2099-01-01')
    expect(all).toBeGreaterThanOrEqual(2)
  })

  it('weekdays [1,3] only on Mon/Wed', async () => {
    const med = await mkMed(a, {}, { kind: 'weekdays', times: ['08:00'], weekdays: [1, 3] })
    await gen(a, '2026-11-02', '2026-11-08') // Mon..Sun
    expect(utc(await doses(med))).toEqual(['2026-11-02T13:00:00.000Z', '2026-11-04T13:00:00.000Z'])
  })

  it('interval 3 from start_date', async () => {
    const med = await mkMed(
      a,
      {},
      { kind: 'interval', times: ['08:00'], interval_days: 3, start_date: '2026-11-02' },
    )
    await gen(a, '2026-11-01', '2026-11-10')
    expect(utc(await doses(med))).toEqual([
      '2026-11-02T13:00:00.000Z',
      '2026-11-05T13:00:00.000Z',
      '2026-11-08T13:00:00.000Z',
    ])
  })

  it('interval_days = 0 never raises and generates nothing', async () => {
    const med = await mkMed(
      a,
      {},
      { kind: 'interval', times: ['08:00'], interval_days: 0, start_date: '2026-11-02' },
    )
    expect(await gen(a, '2026-11-01', '2026-11-10')).toBeGreaterThanOrEqual(0)
    expect(await doses(med)).toHaveLength(0)
  })

  it('end_date excludes later days; start_date excludes earlier', async () => {
    const med = await mkMed(
      a,
      {},
      { kind: 'daily', times: ['08:00'], start_date: '2026-11-03', end_date: '2026-11-04' },
    )
    await gen(a, '2026-11-01', '2026-11-06')
    expect(utc(await doses(med))).toEqual(['2026-11-03T13:00:00.000Z', '2026-11-04T13:00:00.000Z'])
  })

  it('paused med -> 0 rows', async () => {
    const med = await mkMed(a, { paused: true })
    expect(await gen(a, '2026-11-02', '2026-11-03')).toBeGreaterThanOrEqual(0)
    expect(await doses(med)).toHaveLength(0)
  })

  it('prn -> 0 rows', async () => {
    const med = await mkMed(a, {}, { kind: 'prn' })
    await gen(a, '2026-11-02', '2026-11-03')
    expect(await doses(med)).toHaveLength(0)
  })

  it('idempotent: second call inserts 0', async () => {
    await mkMed(a, {}, { kind: 'daily', times: ['07:00'] })
    expect(await gen(a, '2026-12-01', '2026-12-02')).toBeGreaterThan(0)
    expect(await gen(a, '2026-12-01', '2026-12-02')).toBe(0)
  })

  it('DST: Toronto 2026-11-01 08:00 -> 13:00Z (EST), 2026-10-31 08:00 -> 12:00Z (EDT)', async () => {
    const med = await mkMed(a, {}, { kind: 'daily', times: ['08:00'] })
    await gen(a, '2026-10-31', '2026-11-01')
    expect(utc(await doses(med))).toEqual(['2026-10-31T12:00:00.000Z', '2026-11-01T13:00:00.000Z'])
  })

  it('generate_doses(null) as user B does not create rows for user A', async () => {
    const med = await mkMed(a)
    const r = await b.client.rpc('generate_doses', { p_user: null })
    expect(r.error).toBeNull()
    expect(await doses(med)).toHaveLength(0)
  })

  it('authenticated cannot execute generate_doses_for', async () => {
    const r = await a.client.rpc('generate_doses_for', {
      p_user: a.id,
      p_from: '2026-01-01',
      p_to: '2026-01-02',
    })
    expect(r.error).not.toBeNull()
    expect(r.error!.code).toBe('42501')
  })

  it('generate_doses never creates a past pending row (time now-1h Toronto)', async () => {
    const c = await newUser()
    try {
      const past = new Date(Date.now() - 3600_000)
      const hm = localHm(past.toISOString(), 'America/Toronto')
      const med = await mkMed(c, {}, { kind: 'daily', times: [hm] })
      expect((await c.client.rpc('generate_doses', { p_user: c.id })).error).toBeNull()
      const rows = await doses(med)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.filter((r) => new Date(r.scheduled_for) <= new Date())).toHaveLength(0)
    } finally {
      await admin().auth.admin.deleteUser(c.id)
    }
  })

  it('invalid time_zone is rejected', async () => {
    const r = await a.client.from('profiles').update({ time_zone: 'Not/AZone' }).eq('user_id', a.id)
    expect(r.error).not.toBeNull()
    const p = await admin().from('profiles').select('time_zone').eq('user_id', a.id).single()
    expect(p.data!.time_zone).toBe('America/Toronto')
  })

  it('anon cannot execute', async () => {
    const { anon } = await import('./helpers')
    const r = await anon().rpc('mark_missed')
    expect(r.error).not.toBeNull()
  })
})

describe('status changes and stock', () => {
  it('taken decrements stock by units_per_dose', async () => {
    const med = await mkMed(a, { stock: 10, units_per_dose: 2 }, null)
    const d = await seedDose(a, med)
    const r = await setStatus(a, d, 'taken')
    expect(r.error).toBeNull()
    expect(r.data.status).toBe('taken')
    expect(r.data.acted_at).not.toBeNull()
    expect(await stockOf(med)).toBe(8)
  })

  it('taken twice decrements once', async () => {
    const med = await mkMed(a, { stock: 10, units_per_dose: 2 }, null)
    const d = await seedDose(a, med)
    expect((await setStatus(a, d, 'taken')).error).toBeNull()
    expect((await setStatus(a, d, 'taken')).error).toBeNull()
    expect(await stockOf(med)).toBe(8)
  })

  it('un-taking restores stock', async () => {
    const med = await mkMed(a, { stock: 10, units_per_dose: 2 }, null)
    const d = await seedDose(a, med)
    await setStatus(a, d, 'taken')
    const r = await setStatus(a, d, 'pending')
    expect(r.error).toBeNull()
    expect(r.data.status).toBe('pending')
    expect(await stockOf(med)).toBe(10)
    const s = await setStatus(a, d, 'taken')
    expect(s.error).toBeNull()
    await setStatus(a, d, 'skipped')
    expect(await stockOf(med)).toBe(10)
  })

  it('stock clamps at 0', async () => {
    const med = await mkMed(a, { stock: 1, units_per_dose: 3 }, null)
    const d = await seedDose(a, med)
    await setStatus(a, d, 'taken')
    expect(await stockOf(med)).toBe(0)
  })

  it('stock null stays null', async () => {
    const med = await mkMed(a, { stock: null }, null)
    const d = await seedDose(a, med)
    await setStatus(a, d, 'taken')
    expect(await stockOf(med)).toBeNull()
    await setStatus(a, d, 'pending')
    expect(await stockOf(med)).toBeNull()
  })

  it('snoozed -> taken -> pending on a past dose is not due', async () => {
    const med = await mkMed(a, {}, null)
    const d = await seedDose(a, med, -3600_000)
    const sn = await a.client
      .from('dose_events')
      .update({ snoozed_until: new Date(Date.now() + 600_000).toISOString() })
      .eq('id', d)
    expect(sn.error).toBeNull()
    const t = await setStatus(a, d, 'taken')
    expect(t.error).toBeNull()
    expect(t.data.snoozed_until).toBeNull()
    const p = await setStatus(a, d, 'pending')
    expect(p.error).toBeNull()
    expect(p.data.notified_at).not.toBeNull()
    expect(p.data.snoozed_until).toBeNull()
  })

  it('snoozed -> skipped clears snooze; future dose un-taken stays un-notified', async () => {
    const med = await mkMed(a, {}, null)
    const d1 = await seedDose(a, med, -3600_000)
    await a.client
      .from('dose_events')
      .update({ snoozed_until: new Date(Date.now() + 600_000).toISOString() })
      .eq('id', d1)
    const s1 = await setStatus(a, d1, 'skipped')
    expect(s1.data.snoozed_until).toBeNull()
    const d2 = await seedDose(a, med, 3600_000)
    await setStatus(a, d2, 'taken')
    const p = await setStatus(a, d2, 'pending')
    expect(p.data.notified_at).toBeNull()
  })

  it("'missed' is rejected as a manual target", async () => {
    const med = await mkMed(a, {}, null)
    const d = await seedDose(a, med)
    const r = await setStatus(a, d, 'missed')
    expect(r.error).not.toBeNull()
  })

  it('a missed dose can still be marked taken', async () => {
    const med = await mkMed(a, { stock: 5 }, null)
    const d = await seedDose(a, med, -30 * 3600_000)
    expect((await a.client.rpc('mark_missed')).error).toBeNull()
    expect((await doses(med))[0].status).toBe('missed')
    const r = await setStatus(a, d, 'taken')
    expect(r.error).toBeNull()
    expect(r.data.status).toBe('taken')
    expect(await stockOf(med)).toBe(4)
  })

  it("user B calling set_dose_status on A's dose -> no row, A's dose unchanged", async () => {
    const med = await mkMed(a, { stock: 5 }, null)
    const d = await seedDose(a, med)
    const r = await setStatus(b, d, 'taken')
    expect(r.error).toBeNull()
    expect(r.data?.id ?? null).toBeNull()
    const rows = await doses(med)
    expect(rows[0].status).toBe('pending')
    expect(rows[0].acted_at).toBeNull()
    expect(await stockOf(med)).toBe(5)
  })

  it('log_prn_dose inserts a taken row and decrements stock', async () => {
    const med = await mkMed(a, { stock: 4, units_per_dose: 1 }, { kind: 'prn' })
    const r = await a.client.rpc('log_prn_dose', { p_med: med })
    expect(r.error).toBeNull()
    expect(r.data.status).toBe('taken')
    expect(await stockOf(med)).toBe(3)
    expect(await doses(med)).toHaveLength(1)
  })

  it("log_prn_dose on another user's med -> no row", async () => {
    const med = await mkMed(a, { stock: 4 }, { kind: 'prn' })
    const r = await b.client.rpc('log_prn_dose', { p_med: med })
    expect(r.error).toBeNull()
    expect(r.data?.id ?? null).toBeNull()
    expect(await doses(med)).toHaveLength(0)
    expect(await stockOf(med)).toBe(4)
  })
})

describe('regeneration and rollover', () => {
  it('regenerate keeps taken and notified rows', async () => {
    const med = await mkMed(a, {}, { kind: 'daily', times: ['00:30', '06:00', '12:00', '18:00'] })
    expect((await a.client.rpc('generate_doses', { p_user: a.id })).error).toBeNull()
    const before = await doses(med)
    expect(before.length).toBeGreaterThanOrEqual(2)
    const taken = before[before.length - 1] // tomorrow 18:00
    const notified = before[before.length - 2] // tomorrow 12:00
    expect((await setStatus(a, taken.id, 'taken')).error).toBeNull()
    const n = await a.client
      .from('dose_events')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', notified.id)
    expect(n.error).toBeNull()
    const snapAll = await doses(med)
    const snapTaken = snapAll[snapAll.length - 1]
    const snapNotified = snapAll[snapAll.length - 2]

    const u = await a.client.from('schedules').update({ times: ['09:15'] }).eq('medication_id', med)
    expect(u.error).toBeNull()
    expect((await a.client.rpc('regenerate_future_doses', { p_med: med })).error).toBeNull()

    const after = await doses(med)
    const beforeIds = new Set(before.map((r) => r.id))
    const spurious = after.filter((r) => !beforeIds.has(r.id) && new Date(r.scheduled_for) <= new Date())
    expect(spurious).toHaveLength(0)
    expect(after.find((r) => r.id === taken.id)).toEqual(snapTaken)
    expect(after.find((r) => r.id === notified.id)).toEqual(snapNotified)
    const futurePending = after.filter(
      (r) => r.status === 'pending' && r.notified_at === null && new Date(r.scheduled_for) > new Date(),
    )
    expect(futurePending.length).toBeGreaterThan(0)
    for (const r of futurePending) expect(localHm(r.scheduled_for, 'America/Toronto')).toBe('09:15')
  })

  it("mark_missed flips yesterday's pending, leaves today's", async () => {
    const med = await mkMed(a, {}, null)
    const old = await seedDose(a, med, -30 * 3600_000)
    const today = await seedDose(a, med, 0)
    const r = await a.client.rpc('mark_missed')
    expect(r.error).toBeNull()
    expect(r.data).toBeGreaterThanOrEqual(1)
    const rows = await doses(med)
    expect(rows.find((x) => x.id === old)!.status).toBe('missed')
    expect(rows.find((x) => x.id === today)!.status).toBe('pending')
  })

  it('mark_missed skips a yesterday dose that is snoozed into the future', async () => {
    const med = await mkMed(a, {}, null)
    const snoozed = await seedDose(a, med, -30 * 3600_000)
    const plain = await seedDose(a, med, -31 * 3600_000)
    const up = await admin()
      .from('dose_events')
      .update({ snoozed_until: new Date(Date.now() + 3_600_000).toISOString() })
      .eq('id', snoozed)
    expect(up.error).toBeNull()
    expect((await a.client.rpc('mark_missed')).error).toBeNull()
    const rows = await doses(med)
    expect(rows.find((x) => x.id === snoozed)!.status).toBe('pending')
    expect(rows.find((x) => x.id === plain)!.status).toBe('missed')
  })

  it("mark_missed by user B does not change A's rows", async () => {
    const med = await mkMed(a, {}, null)
    await seedDose(a, med, -30 * 3600_000)
    expect((await b.client.rpc('mark_missed')).error).toBeNull()
    expect((await doses(med))[0].status).toBe('pending')
  })

  it('pausing then regenerate_user_doses removes future pending rows; resume restores them', async () => {
    const med = await mkMed(a, {}, { kind: 'daily', times: ['00:30', '18:00'] })
    await a.client.rpc('generate_doses', { p_user: a.id })
    const future = async () =>
      (await doses(med)).filter((r) => r.status === 'pending' && new Date(r.scheduled_for) > new Date())

    expect((await future()).length).toBeGreaterThan(0)
    expect((await a.client.from('medications').update({ paused: true }).eq('id', med)).error).toBeNull()
    expect((await a.client.rpc('regenerate_user_doses')).error).toBeNull()
    expect(await future()).toHaveLength(0)

    expect((await a.client.from('medications').update({ paused: false }).eq('id', med)).error).toBeNull()
    expect((await a.client.rpc('regenerate_user_doses')).error).toBeNull()
    expect((await future()).length).toBeGreaterThan(0)
  })

  it('time_zone change regenerates future pending rows at the new wall-clock', async () => {
    const c = await newUser()
    try {
      const med = await mkMed(c, {}, { kind: 'daily', times: ['08:00'] })
      await c.client.rpc('generate_doses', { p_user: c.id })
      const p = await c.client.from('profiles').update({ time_zone: 'America/Vancouver' }).eq('user_id', c.id)
      expect(p.error).toBeNull()
      expect((await c.client.rpc('regenerate_user_doses')).error).toBeNull()
      const future = (await doses(med)).filter(
        (r) => r.status === 'pending' && new Date(r.scheduled_for) > new Date(),
      )
      expect(future.length).toBeGreaterThan(0)
      for (const r of future) expect(localHm(r.scheduled_for, 'America/Vancouver')).toBe('08:00')
    } finally {
      await admin().auth.admin.deleteUser(c.id)
    }
  })
})

describe('cascade', () => {
  it('deleting a med cascades its schedules and dose_events', async () => {
    const med = await mkMed(a, {}, { kind: 'daily', times: ['08:00'] })
    await gen(a, '2026-11-02', '2026-11-03')
    expect(await doses(med)).toHaveLength(2)
    expect((await a.client.from('medications').delete().eq('id', med)).error).toBeNull()
    expect(await doses(med)).toHaveLength(0)
    const s = await admin().from('schedules').select('id').eq('medication_id', med)
    expect(s.error).toBeNull()
    expect(s.data).toHaveLength(0)
  })
})
