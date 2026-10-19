import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, anon, newGuest, newUser } from './helpers'

type Ctx = { a: { client: SupabaseClient; id: string }; b: { client: SupabaseClient; id: string } }
const ctx = {} as Ctx
const medId: { v?: string } = {}

beforeAll(async () => {
  ctx.a = await newUser()
  ctx.b = await newUser()
})

afterAll(async () => {
  for (const u of [ctx.a, ctx.b]) if (u) await admin().auth.admin.deleteUser(u.id)
})

type Spec = {
  table: string
  pk: string
  // returns the insert payload for the given user id
  row: (uid: string) => Record<string, unknown>
  update: Record<string, unknown>
  preExisting?: boolean // row created by trigger, not by insert
}

const specs: Spec[] = [
  {
    table: 'profiles',
    pk: 'user_id',
    row: (uid) => ({ user_id: uid, nickname: 'x' }),
    update: { nickname: 'hacked' },
    preExisting: true,
  },
  {
    table: 'medications',
    pk: 'id',
    row: (uid) => ({ user_id: uid, name: 'Med A' }),
    update: { name: 'hacked' },
  },
  {
    table: 'schedules',
    pk: 'id',
    row: (uid) => ({ user_id: uid, medication_id: medId.v, kind: 'daily', times: ['08:00'] }),
    update: { kind: 'prn' },
  },
  {
    table: 'dose_events',
    pk: 'id',
    row: (uid) => ({
      user_id: uid,
      medication_id: medId.v,
      scheduled_for: '2026-01-01T08:00:00Z',
    }),
    update: { status: 'taken' },
  },
  {
    table: 'push_subscriptions',
    pk: 'id',
    row: (uid) => ({ user_id: uid, endpoint: `https://push.example.test/${crypto.randomUUID()}`, p256dh: 'p', auth: 'a' }),
    update: { enabled: false },
  },
]

describe('RLS isolation', () => {
  for (const s of specs) {
    describe(s.table, () => {
      let rowId: string

      beforeAll(async () => {
        if (s.table === 'schedules' || s.table === 'dose_events') {
          if (!medId.v) {
            const { data, error } = await ctx.a.client
              .from('medications')
              .insert({ user_id: ctx.a.id, name: 'Parent Med' })
              .select('id')
              .single()
            expect(error).toBeNull()
            medId.v = data!.id
          }
        }
        if (s.preExisting) {
          const { data, error } = await ctx.a.client.from(s.table).select('*').eq(s.pk, ctx.a.id)
          expect(error).toBeNull()
          expect(data).toHaveLength(1)
          rowId = ctx.a.id
        } else {
          const { data, error } = await ctx.a.client.from(s.table).insert(s.row(ctx.a.id)).select('*').single()
          expect(error).toBeNull()
          rowId = (data as Record<string, string>)[s.pk]
        }
      })

      it('owner can read own row', async () => {
        const { data, error } = await ctx.a.client.from(s.table).select('*').eq(s.pk, rowId)
        expect(error).toBeNull()
        expect(data).toHaveLength(1)
      })

      it('other user selects 0 rows', async () => {
        const { data, error } = await ctx.b.client.from(s.table).select('*').eq(s.pk, rowId)
        expect(error).toBeNull()
        expect(data).toHaveLength(0)
      })

      it('other user updates 0 rows', async () => {
        const { data, error } = await ctx.b.client.from(s.table).update(s.update).eq(s.pk, rowId).select()
        expect(error).toBeNull()
        expect(data).toHaveLength(0)
      })

      it('other user deletes 0 rows', async () => {
        const { data, error } = await ctx.b.client.from(s.table).delete().eq(s.pk, rowId).select()
        expect(error).toBeNull()
        expect(data).toHaveLength(0)
        const { data: still } = await admin().from(s.table).select('*').eq(s.pk, rowId)
        expect(still).toHaveLength(1)
      })

      it('other user cannot insert with user_id = A', async () => {
        const payload = s.table === 'profiles' ? { user_id: ctx.a.id } : s.row(ctx.a.id)
        const { error } = await ctx.b.client.from(s.table).insert(payload)
        expect(error?.code).toBe('42501')
      })

      it('owner cannot reassign row to another user', async () => {
        const { error } = await ctx.a.client.from(s.table).update({ user_id: ctx.b.id }).eq(s.pk, rowId)
        expect(error?.code).toBe('42501')
      })

      it('unauthenticated client selects 0 rows', async () => {
        const { data, error } = await anon().from(s.table).select('*')
        expect(error).toBeNull()
        expect(data).toHaveLength(0)
      })
    })
  }
})

describe('integrity', () => {
  let med: string
  beforeAll(async () => {
    const { data, error } = await ctx.a.client
      .from('medications').insert({ user_id: ctx.a.id, name: 'Integrity Med' }).select('id, refill_threshold_days').single()
    expect(error).toBeNull()
    expect(data!.refill_threshold_days).toBe(7)
    med = data!.id
  })

  it('B cannot attach schedule to A medication', async () => {
    const { error } = await ctx.b.client
      .from('schedules').insert({ user_id: ctx.b.id, medication_id: med, kind: 'daily' })
    expect(error?.code).toBe('23503')
  })

  it('B cannot attach dose_event to A medication', async () => {
    const { error } = await ctx.b.client
      .from('dose_events').insert({ user_id: ctx.b.id, medication_id: med, scheduled_for: '2026-02-01T08:00:00Z' })
    expect(error?.code).toBe('23503')
  })

  it('duplicate (medication_id, scheduled_for) rejected', async () => {
    const row = { user_id: ctx.a.id, medication_id: med, scheduled_for: '2026-03-01T08:00:00Z' }
    expect((await ctx.a.client.from('dose_events').insert(row)).error).toBeNull()
    expect((await ctx.a.client.from('dose_events').insert(row)).error?.code).toBe('23505')
  })

  it('bad CHECK values rejected', async () => {
    const r1 = await ctx.a.client.from('profiles').update({ snooze_minutes: 7 }).eq('user_id', ctx.a.id)
    expect(r1.error?.code).toBe('23514')
    const r2 = await ctx.a.client.from('dose_events')
      .insert({ user_id: ctx.a.id, medication_id: med, scheduled_for: '2026-04-01T08:00:00Z', status: 'bogus' })
    expect(r2.error?.code).toBe('23514')
  })

  it('http push endpoint rejected', async () => {
    const { error } = await ctx.a.client
      .from('push_subscriptions').insert({ user_id: ctx.a.id, endpoint: 'http://push.example.test/x', p256dh: 'p', auth: 'a' })
    expect(error?.code).toBe('23514')
  })
})

describe('trigger and cascades', () => {
  it('guest gets default profile', async () => {
    const g = await newGuest()
    try {
      const { data, error } = await g.client.from('profiles').select('*').eq('user_id', g.id).single()
      expect(error).toBeNull()
      expect(data).toMatchObject({ time_zone: 'America/Toronto', password_set: false, snooze_minutes: 10 })
    } finally {
      await admin().auth.admin.deleteUser(g.id)
    }
  })

  it('deleting medication cascades; deleting user cascades all tables', async () => {
    const u = await newUser()
    const { data: m } = await u.client.from('medications').insert({ user_id: u.id, name: 'C' }).select('id').single()
    await u.client.from('schedules').insert({ user_id: u.id, medication_id: m!.id, kind: 'daily' })
    await u.client.from('dose_events').insert({ user_id: u.id, medication_id: m!.id, scheduled_for: '2026-05-01T08:00:00Z' })
    await u.client.from('push_subscriptions').insert({ user_id: u.id, endpoint: `https://push.example.test/${u.id}`, p256dh: 'p', auth: 'a' })

    await u.client.from('medications').delete().eq('id', m!.id)
    for (const t of ['schedules', 'dose_events']) {
      const { data } = await admin().from(t).select('id').eq('user_id', u.id)
      expect(data).toHaveLength(0)
    }

    const { data: m2 } = await u.client.from('medications').insert({ user_id: u.id, name: 'C2' }).select('id').single()
    await u.client.from('schedules').insert({ user_id: u.id, medication_id: m2!.id, kind: 'daily' })
    await admin().auth.admin.deleteUser(u.id)
    for (const t of ['profiles', 'medications', 'schedules', 'dose_events', 'push_subscriptions']) {
      const { data } = await admin().from(t).select('*').eq('user_id', u.id)
      expect(data, t).toHaveLength(0)
    }
  })
})
