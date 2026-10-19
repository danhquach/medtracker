import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, newUser } from './helpers'

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
        expect(error).not.toBeNull()
      })
    })
  }
})
