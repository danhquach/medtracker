import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  profile: { user_id: 'u1', time_zone: 'America/Toronto' },
  update: vi.fn(),
  rpc: vi.fn(() => Promise.resolve({ error: null })),
}))

vi.mock('../lib/supabase', () => ({
  currentUserId: () => Promise.resolve('u1'),
  supabase: {
    rpc: db.rpc,
    from: () => ({
      select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: db.profile, error: null }) }) }),
      update: (patch: object) => {
        db.update(patch)
        return { eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { ...db.profile, ...patch }, error: null }) }) }) }
      },
    }),
  },
}))

import { detectTimeZone } from './profile'

let store: Map<string, string>
beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  db.update.mockClear()
  db.rpc.mockClear()
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
    () => ({ resolvedOptions: () => ({ timeZone: 'Asia/Tokyo' }) }) as Intl.DateTimeFormat,
  )
})
afterEach(() => vi.restoreAllMocks())

describe('detectTimeZone', () => {
  it('marker present → no update', async () => {
    store.set('tzDetected:u1', '1')
    await detectTimeZone()
    expect(db.update).not.toHaveBeenCalled()
  })
  it('marker absent + default zone → updates, regenerates, sets marker', async () => {
    await detectTimeZone()
    expect(db.update).toHaveBeenCalledWith({ time_zone: 'Asia/Tokyo' })
    expect(db.rpc).toHaveBeenCalledWith('regenerate_user_doses')
    expect(store.get('tzDetected:u1')).toBe('1')
  })
  it('does not run again after the marker is set', async () => {
    await detectTimeZone()
    db.update.mockClear()
    await detectTimeZone()
    expect(db.update).not.toHaveBeenCalled()
  })
})
