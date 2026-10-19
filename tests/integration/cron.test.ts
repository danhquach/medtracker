import { afterAll, describe, expect, it } from 'vitest'
import { admin, anon, newGuest, newUser } from './helpers'

const created: string[] = []
afterAll(async () => {
  for (const id of created) await admin().auth.admin.deleteUser(id)
})

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()
const exists = async (id: string) => (await admin().auth.admin.getUserById(id)).data.user !== null

describe('purge_stale_guests', () => {
  it('deletes a guest unseen 91 days, keeps 89 days, keeps non-anonymous users', async () => {
    const old = await newGuest()
    const recent = await newGuest()
    const member = await newUser()
    created.push(old.id, recent.id, member.id)
    await admin().from('profiles').update({ last_seen_at: daysAgo(91) }).eq('user_id', old.id)
    await admin().from('profiles').update({ last_seen_at: daysAgo(89) }).eq('user_id', recent.id)
    await admin().from('profiles').update({ last_seen_at: daysAgo(400) }).eq('user_id', member.id)

    const { error } = await admin().rpc('purge_stale_guests')
    expect(error).toBeNull()

    expect(await exists(old.id)).toBe(false)
    expect(await exists(recent.id)).toBe(true)
    expect(await exists(member.id)).toBe(true)
    const prof = await admin().from('profiles').select('user_id').eq('user_id', old.id)
    expect(prof.data).toHaveLength(0)
  })

  it('is not callable by signed-in users or anon', async () => {
    const u = await newUser()
    created.push(u.id)
    expect((await u.client.rpc('purge_stale_guests')).error).not.toBeNull()
    expect((await anon().rpc('purge_stale_guests')).error).not.toBeNull()
  })
})

describe('cron_send_reminders', () => {
  it('is not callable by signed-in users', async () => {
    const u = await newUser()
    created.push(u.id)
    expect((await u.client.rpc('cron_send_reminders')).error).not.toBeNull()
  })

  it('is a no-op without Vault secrets (admin call returns, nothing posted)', async () => {
    const { error } = await admin().rpc('cron_send_reminders')
    expect(error).toBeNull()
  })
})
