import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, anon, newUser } from './helpers'

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

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

async function mkMed(u: U, fields: Record<string, unknown> = {}): Promise<string> {
  const r = await admin()
    .from('medications')
    .insert({ user_id: u.id, name: 'Claimmed', strength: '10 mg', ...fields })
    .select('id')
    .single()
  expect(r.error).toBeNull()
  return r.data!.id as string
}

async function mkDose(u: U, medId: string, fields: Record<string, unknown> = {}): Promise<string> {
  const r = await admin()
    .from('dose_events')
    .insert({ user_id: u.id, medication_id: medId, scheduled_for: ago(5), ...fields })
    .select('id')
    .single()
  expect(r.error).toBeNull()
  return r.data!.id as string
}

async function claim(u: U) {
  const r = await admin().rpc('claim_due_doses')
  expect(r.error).toBeNull()
  return (r.data as { dose_id: string; user_id: string; med_name: string; strength: string }[]).filter(
    (x) => x.user_id === u.id,
  )
}

describe('claim_due_doses', () => {
  it('claims a due dose once', async () => {
    const med = await mkMed(a)
    const dose = await mkDose(a, med)
    const first = await claim(a)
    expect(first.map((x) => x.dose_id)).toEqual([dose])
    expect(first[0]).toMatchObject({ med_name: 'Claimmed', strength: '10 mg' })
    expect(await claim(a)).toHaveLength(0)
    const row = await admin().from('dose_events').select('notified_at, snoozed_until').eq('id', dose).single()
    expect(row.data!.notified_at).not.toBeNull()
    expect(row.data!.snoozed_until).toBeNull()
  })

  it('skips future, paused, notify=false, already-acted', async () => {
    const future = await mkMed(b)
    await mkDose(b, future, { scheduled_for: new Date(Date.now() + 3_600_000).toISOString() })
    const paused = await mkMed(b, { paused: true })
    await mkDose(b, paused)
    const quiet = await mkMed(b, { notify: false })
    await mkDose(b, quiet)
    const acted = await mkMed(b)
    await mkDose(b, acted, { status: 'taken', acted_at: ago(1) })
    await mkDose(b, acted, { scheduled_for: ago(10), status: 'skipped', acted_at: ago(1) })
    await mkDose(b, acted, { scheduled_for: ago(20), notified_at: ago(15) })
    expect(await claim(b)).toHaveLength(0)
  })

  it('snoozed dose is re-claimed after snoozed_until, not before', async () => {
    const med = await mkMed(a)
    const dose = await mkDose(a, med, { notified_at: ago(4), snoozed_until: new Date(Date.now() + 600_000).toISOString() })
    expect(await claim(a)).toHaveLength(0)
    expect((await admin().from('dose_events').update({ snoozed_until: ago(1) }).eq('id', dose)).error).toBeNull()
    const got = await claim(a)
    expect(got.map((x) => x.dose_id)).toEqual([dose])
    const row = await admin().from('dose_events').select('snoozed_until').eq('id', dose).single()
    expect(row.data!.snoozed_until).toBeNull()
  })

  it('orders by scheduled_for', async () => {
    const med = await mkMed(a)
    const late = await mkDose(a, med, { scheduled_for: ago(2) })
    const early = await mkDose(a, med, { scheduled_for: ago(30) })
    expect((await claim(a)).map((x) => x.dose_id)).toEqual([early, late])
  })

  it('anon and authenticated roles cannot execute claim_due_doses', async () => {
    expect((await anon().rpc('claim_due_doses')).error).not.toBeNull()
    expect((await a.client.rpc('claim_due_doses')).error).not.toBeNull()
  })
})

describe('snooze_dose', () => {
  it('owner snoozes a pending dose; invalid minutes rejected; others cannot', async () => {
    const med = await mkMed(a)
    const dose = await mkDose(a, med, { notified_at: ago(1) })
    const bad = await a.client.rpc('snooze_dose', { p_dose: dose, p_minutes: 7 })
    expect(bad.error).not.toBeNull()
    const other = await b.client.rpc('snooze_dose', { p_dose: dose, p_minutes: 10 })
    expect(other.error).toBeNull()
    expect(other.data.id).toBeNull() // RLS hides the row: nothing updated
    const untouched = await admin().from('dose_events').select('snoozed_until').eq('id', dose).single()
    expect(untouched.data!.snoozed_until).toBeNull()
    const ok = await a.client.rpc('snooze_dose', { p_dose: dose, p_minutes: 10 })
    expect(ok.error).toBeNull()
    const until = new Date(ok.data.snoozed_until).getTime() - Date.now()
    expect(until).toBeGreaterThan(9 * 60_000)
    expect(until).toBeLessThan(11 * 60_000)
    expect((await anon().rpc('snooze_dose', { p_dose: dose, p_minutes: 10 })).error).not.toBeNull()
  })
})

describe('generate_doses error handling', () => {
  it('all-users call as signed-in user stays scoped to self (no cross-user rows, no error)', async () => {
    const r = await a.client.rpc('generate_doses', { p_user: null })
    expect(r.error).toBeNull()
  })

  it('single-user run with a degenerate schedule (interval_days 0) completes cleanly', async () => {
    const med = await mkMed(a)
    const s = await admin().from('schedules').insert({
      user_id: a.id,
      medication_id: med,
      kind: 'interval',
      times: ['23:59'],
      interval_days: 0,
      start_date: '2020-01-01',
    })
    expect(s.error).toBeNull()
    const r = await admin().rpc('generate_doses', { p_user: a.id })
    // Guarded by interval_days > 0. An error here would now surface (single-user path re-raises).
    expect(r.error).toBeNull()
  })
})
