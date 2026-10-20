import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  profile: { user_id: 'u1', time_zone: 'America/Toronto', time_zone_chosen: false as boolean },
  update: vi.fn(),
  rpc: vi.fn(() => Promise.resolve({ error: null })),
}))

vi.mock('../lib/supabase', () => ({
  currentUserId: () => Promise.resolve('u1'),
  supabase: {
    rpc: db.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: db.profile, error: null }) }) }),
    }),
  },
}))
// updateProfile is an offline op; the time zone regeneration happens server-side in update_profile.
vi.mock('./offline/sync', () => ({
  readThrough: (f: () => unknown) => f(),
  submit: (op: { patch: object }, local: (c: object) => unknown) => {
    db.update(op.patch)
    return Promise.resolve(local({ profile: { ...db.profile, ...op.patch } }))
  },
}))

import { detectTimeZone } from './profile'

beforeEach(() => {
  db.profile = { user_id: 'u1', time_zone: 'America/Toronto', time_zone_chosen: false }
  db.update.mockClear()
  db.rpc.mockClear()
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Tokyo' }) }) as Intl.DateTimeFormat,
  )
})
afterEach(() => vi.restoreAllMocks())

describe('detectTimeZone', () => {
  it('zone not chosen yet → adopts the device zone', async () => {
    await detectTimeZone()
    expect(db.update).toHaveBeenCalledWith({ time_zone: 'Asia/Tokyo' })
  })
  it('zone chosen on another device → leaves it, even when it is the default', async () => {
    db.profile.time_zone_chosen = true
    await detectTimeZone()
    expect(db.update).not.toHaveBeenCalled()
  })
  it('profile without the flag (cached before 0013) → leaves the zone', async () => {
    db.profile = { user_id: 'u1', time_zone: 'America/Toronto' } as typeof db.profile
    await detectTimeZone()
    expect(db.update).not.toHaveBeenCalled()
  })
})
