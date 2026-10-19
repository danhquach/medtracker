import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ single: vi.fn(), insert: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  currentUserId: () => Promise.resolve('u1'),
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ single: db.single }) }),
      insert: db.insert,
    }),
  },
}))

import { getProfile } from './profile'

const missing = { data: null, error: { code: 'PGRST116', message: '0 rows' } }
const row = { data: { user_id: 'u1', time_zone: 'America/Toronto' }, error: null }

beforeEach(() => {
  db.single.mockReset()
  db.insert.mockReset()
  db.insert.mockResolvedValue({ error: null })
})

describe('getProfile', () => {
  it('returns an existing row without inserting', async () => {
    db.single.mockResolvedValueOnce(row)
    expect((await getProfile()).user_id).toBe('u1')
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('inserts a default row once when missing, then reloads', async () => {
    db.single.mockResolvedValueOnce(missing).mockResolvedValueOnce(row)
    expect((await getProfile()).user_id).toBe('u1')
    expect(db.insert).toHaveBeenCalledTimes(1)
    expect(db.insert).toHaveBeenCalledWith({ user_id: 'u1' })
  })

  it('ignores a unique violation from a concurrent insert', async () => {
    db.single.mockResolvedValueOnce(missing).mockResolvedValueOnce(row)
    db.insert.mockResolvedValue({ error: { code: '23505', message: 'dup' } })
    expect((await getProfile()).user_id).toBe('u1')
  })

  it('throws other insert errors', async () => {
    db.single.mockResolvedValueOnce(missing)
    db.insert.mockResolvedValue({ error: { code: '42501', message: 'denied' } })
    await expect(getProfile()).rejects.toMatchObject({ code: '42501' })
  })

  it('throws other select errors without inserting', async () => {
    db.single.mockResolvedValueOnce({ data: null, error: { code: '500', message: 'down' } })
    await expect(getProfile()).rejects.toMatchObject({ code: '500' })
    expect(db.insert).not.toHaveBeenCalled()
  })
})
