import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { admin, anon, newUser } from './helpers'

type U = { client: SupabaseClient; id: string }
let a: U
let b: U
const endpoint = () => `https://push.example.test/${crypto.randomUUID()}`
const claim = (c: SupabaseClient, e: string) =>
  c.rpc('claim_push_endpoint', { p_endpoint: e, p_p256dh: 'p', p_auth: 'a', p_label: 'Test device' })

beforeAll(async () => {
  a = await newUser()
  b = await newUser()
})

afterAll(async () => {
  for (const u of [a, b]) if (u) await admin().auth.admin.deleteUser(u.id)
})

describe('claim_push_endpoint', () => {
  it('creates an enabled row for the caller', async () => {
    const e = endpoint()
    const { data, error } = await claim(a.client, e)
    expect(error).toBeNull()
    const row = await admin().from('push_subscriptions').select('id, user_id, enabled').eq('endpoint', e).single()
    expect(row.data).toMatchObject({ id: data, user_id: a.id, enabled: true })
  })

  it('B claiming A endpoint removes A row and gives B the row', async () => {
    const e = endpoint()
    expect((await claim(a.client, e)).error).toBeNull()
    expect((await claim(b.client, e)).error).toBeNull()
    const rows = await admin().from('push_subscriptions').select('user_id').eq('endpoint', e)
    expect(rows.data).toEqual([{ user_id: b.id }])
  })

  it('re-claiming own disabled endpoint re-enables it', async () => {
    const e = endpoint()
    await claim(a.client, e)
    await admin().from('push_subscriptions').update({ enabled: false }).eq('endpoint', e)
    expect((await claim(a.client, e)).error).toBeNull()
    const row = await admin().from('push_subscriptions').select('enabled').eq('endpoint', e).single()
    expect(row.data?.enabled).toBe(true)
  })

  it('anon cannot call it', async () => {
    const { error } = await claim(anon(), endpoint())
    expect(error).not.toBeNull()
  })

  it('rejects a non-https endpoint', async () => {
    const { error } = await claim(a.client, 'http://push.example.test/x')
    expect(error).not.toBeNull()
  })
})
