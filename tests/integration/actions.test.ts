import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from 'vite'
import { signActionToken } from '../../supabase/functions/_shared/actionToken'
import { admin, newUser } from './helpers'

const env = loadEnv('test', process.cwd(), '')
const fn = (name: string) => `${env.SUPABASE_URL}/functions/v1/${name}`
const tokenKey = env.ACTION_TOKEN_KEY

type U = { client: SupabaseClient; id: string }
let a: U
let b: U
const extra: U[] = []

beforeAll(async () => {
  a = await newUser()
  b = await newUser()
})

afterAll(async () => {
  for (const u of [a, b, ...extra]) if (u) await admin().auth.admin.deleteUser(u.id)
})

async function mkDose(u: U, medFields: Record<string, unknown> = {}) {
  const med = await admin()
    .from('medications')
    .insert({ user_id: u.id, name: 'Actmed', stock: 10, units_per_dose: 1, ...medFields })
    .select('id')
    .single()
  expect(med.error).toBeNull()
  const dose = await admin()
    .from('dose_events')
    .insert({ user_id: u.id, medication_id: med.data!.id, scheduled_for: new Date(Date.now() - 300_000).toISOString(), notified_at: new Date().toISOString() })
    .select('id')
    .single()
  expect(dose.error).toBeNull()
  return { medId: med.data!.id as string, doseId: dose.data!.id as string }
}

const tok = (doseId: string, userId: string, exp = Date.now() + 3600_000) => signActionToken({ doseId, userId, exp }, tokenKey)

function post(body: unknown, name = 'dose-action') {
  return fetch(fn(name), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const row = async (id: string) =>
  (await admin().from('dose_events').select('status, snoozed_until').eq('id', id).single()).data!

describe('dose-action', () => {
  it('taken via token updates status and stock', async () => {
    const { medId, doseId } = await mkDose(a)
    const r = await post({ token: await tok(doseId, a.id), action: 'taken' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'taken' })
    expect((await row(doseId)).status).toBe('taken')
    const m = await admin().from('medications').select('stock').eq('id', medId).single()
    expect(Number(m.data!.stock)).toBe(9)
  })

  it('snooze sets snoozed_until ~ now + snooze_minutes', async () => {
    expect((await admin().from('profiles').update({ snooze_minutes: 15 }).eq('user_id', a.id)).error).toBeNull()
    const { doseId } = await mkDose(a)
    const r = await post({ token: await tok(doseId, a.id), action: 'snooze' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'snoozed' })
    const until = Date.parse((await row(doseId)).snoozed_until) - Date.now()
    expect(until).toBeGreaterThan(14 * 60_000)
    expect(until).toBeLessThan(16 * 60_000)
  })

  it('expired token -> 401, tampered/garbage -> 401, dose unchanged', async () => {
    const { doseId } = await mkDose(a)
    const expired = await post({ token: await tok(doseId, a.id, Date.now() - 1000), action: 'taken' })
    expect(expired.status).toBe(401)
    const good = await tok(doseId, a.id)
    expect((await post({ token: good.slice(0, -2) + 'xx', action: 'taken' })).status).toBe(401)
    expect((await post({ token: 'garbage', action: 'taken' })).status).toBe(401)
    expect((await row(doseId)).status).toBe('pending')
  })

  it("token for user A on user B's dose id -> 404, B's dose unchanged", async () => {
    const { doseId } = await mkDose(b)
    for (const action of ['taken', 'snooze']) {
      const r = await post({ token: await tok(doseId, a.id), action })
      expect(r.status).toBe(404)
    }
    const d = await row(doseId)
    expect(d.status).toBe('pending')
    expect(d.snoozed_until).toBeNull()
  })

  it('missing dose -> 404', async () => {
    const r = await post({ token: await tok(crypto.randomUUID(), a.id), action: 'taken' })
    expect(r.status).toBe(404)
  })

  it('unknown action / bad shape -> 400, dose unchanged', async () => {
    const { doseId } = await mkDose(a)
    const t = await tok(doseId, a.id)
    expect((await post({ token: t, action: 'skipped' })).status).toBe(400)
    expect((await post({ token: t })).status).toBe(400)
    expect((await post({ action: 'taken' })).status).toBe(400)
    expect((await post({ token: 5, action: 'taken' })).status).toBe(400)
    expect((await post('not json')).status).toBe(400)
    expect((await post({ token: 'x'.repeat(5000), action: 'taken' })).status).toBe(400)
    expect((await row(doseId)).status).toBe('pending')
  })

  it('OPTIONS preflight and POST carry permissive CORS without credentials', async () => {
    const pre = await fetch(fn('dose-action'), {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'apikey, content-type' },
    })
    expect(pre.status).toBeLessThan(300)
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
    const allowed = (pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    expect(allowed).toContain('apikey')
    expect(allowed).toContain('content-type')
    expect(pre.headers.get('access-control-allow-credentials')).toBeNull()
    const r = await post({ token: 'garbage', action: 'taken' })
    expect(r.headers.get('access-control-allow-origin')).toBe('*')
  })
})

describe('delete-account', () => {
  it('without a valid JWT -> 401', async () => {
    expect((await post({}, 'delete-account')).status).toBe(401)
    const r = await fetch(fn('delete-account'), {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${env.SUPABASE_PUBLISHABLE_KEY}` },
    })
    expect(r.status).toBe(401)
  })

  it('removes auth user and all rows', async () => {
    const u = await newUser()
    extra.push(u)
    const { medId, doseId } = await mkDose(u)
    const { data } = await u.client.auth.getSession()
    const r = await fetch(fn('delete-account'), {
      method: 'POST',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${data.session!.access_token}` },
    })
    expect(r.status).toBe(200)
    expect((await admin().auth.admin.getUserById(u.id)).data.user).toBeNull()
    expect((await admin().from('medications').select('id').eq('id', medId)).data).toEqual([])
    expect((await admin().from('dose_events').select('id').eq('id', doseId)).data).toEqual([])
    expect((await admin().from('profiles').select('user_id').eq('user_id', u.id)).data).toEqual([])
  })

  it('with body {user_id: B} called by A deletes A only; B intact', async () => {
    const victim = await newUser()
    const attacker = await newUser()
    extra.push(victim, attacker)
    const { doseId } = await mkDose(victim)
    const { data } = await attacker.client.auth.getSession()
    const r = await fetch(fn('delete-account'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: env.SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${data.session!.access_token}` },
      body: JSON.stringify({ user_id: victim.id, userId: victim.id, id: victim.id }),
    })
    expect(r.status).toBe(200)
    expect((await admin().auth.admin.getUserById(attacker.id)).data.user).toBeNull()
    expect((await admin().auth.admin.getUserById(victim.id)).data.user).not.toBeNull()
    expect((await admin().from('dose_events').select('id').eq('id', doseId)).data).toHaveLength(1)
  })

  it('OPTIONS preflight allows authorization header', async () => {
    const pre = await fetch(fn('delete-account'), {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, apikey, content-type' },
    })
    expect(pre.status).toBeLessThan(300)
    expect(pre.headers.get('access-control-allow-origin')).toBe('*')
    expect((pre.headers.get('access-control-allow-headers') ?? '').toLowerCase()).toContain('authorization')
  })
})
