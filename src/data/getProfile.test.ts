import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn() }))

vi.mock('../lib/supabase', () => ({
  currentUserId: () => Promise.resolve('u1'),
  supabase: {
    rpc: db.rpc,
    from: () => ({ select: () => ({ eq: () => ({ single: db.single }) }) }),
  },
}))

vi.mock('./offline/sync', () => ({ readThrough: (f: () => unknown) => f() }))
import { getProfile, markPasswordSet, touchLastSeen } from './profile'

beforeEach(() => {
  db.single.mockReset()
  db.rpc.mockReset()
  db.rpc.mockResolvedValue({ error: null })
})

describe('getProfile', () => {
  it('returns the row', async () => {
    db.single.mockResolvedValueOnce({ data: { user_id: 'u1', time_zone: 'America/Toronto' }, error: null })
    expect((await getProfile()).user_id).toBe('u1')
  })

  it('throws select errors', async () => {
    db.single.mockResolvedValueOnce({ data: null, error: { code: 'PGRST116', message: '0 rows' } })
    await expect(getProfile()).rejects.toMatchObject({ code: 'PGRST116' })
  })
})

describe('bookkeeping RPCs', () => {
  it('touchLastSeen and markPasswordSet go through RPCs', async () => {
    await touchLastSeen()
    await markPasswordSet()
    expect(db.rpc.mock.calls).toEqual([['touch_last_seen'], ['mark_password_set']])
  })

  it('throws RPC errors', async () => {
    db.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'denied' } })
    await expect(markPasswordSet()).rejects.toMatchObject({ code: '42501' })
  })
})
