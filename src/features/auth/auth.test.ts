import type { User } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sb = vi.hoisted(() => ({
  updateUser: vi.fn(),
  signOut: vi.fn(),
  signIn: vi.fn(() => Promise.resolve({ error: null })),
  getSession: vi.fn(() => Promise.resolve({ data: { session: { user: { id: 'guest' } } } })),
}))
vi.mock('../../lib/supabase', () => ({
  sessionUser: () => sb.getSession().then((r) => r.data.session?.user ?? null),
  supabase: { auth: { updateUser: sb.updateUser, signOut: sb.signOut, signInWithPassword: sb.signIn, getSession: sb.getSession } },
}))
const offline = vi.hoisted(() => ({ reset: vi.fn((_id?: string) => Promise.resolve()), flush: vi.fn(() => Promise.resolve()), pending: vi.fn(() => Promise.resolve(0)) }))
vi.mock('../../data/offline/sync', () => ({ resetForSignOut: offline.reset, flush: offline.flush, pendingCount: offline.pending }))
vi.mock('../../data/profile', () => ({ markPasswordSet: vi.fn() }))

const push = vi.hoisted(() => ({ remove: vi.fn() }))
vi.mock('../../push/subscribe', () => ({ removeThisDeviceSubscription: push.remove }))

import { createProfile, isGuest, needsPasswordFinish, setPassword, signIn, signOut, unsyncedBeforeSignOut } from './auth'

const user = (extra: Partial<User> = {}) =>
  ({ id: 'u1', is_anonymous: false, email_confirmed_at: '2026-10-19T00:00:00Z', ...extra }) as User

describe('needsPasswordFinish', () => {
  it('confirmed email, not guest, password_set false → true', () => {
    expect(needsPasswordFinish(user(), { password_set: false })).toBe(true)
  })
  it('password_set true → false', () => {
    expect(needsPasswordFinish(user(), { password_set: true })).toBe(false)
  })
  it('anonymous → false', () => {
    expect(needsPasswordFinish(user({ is_anonymous: true }), { password_set: false })).toBe(false)
  })
  it('unconfirmed email → false', () => {
    expect(needsPasswordFinish(user({ email_confirmed_at: undefined }), { password_set: false })).toBe(false)
  })
  it('signUp metadata flag → false', () => {
    expect(needsPasswordFinish(user({ user_metadata: { password_set: true } }), { password_set: false })).toBe(false)
  })
  it('no profile yet → false', () => {
    expect(needsPasswordFinish(user(), null)).toBe(false)
  })
})

describe('isGuest', () => {
  it('reflects is_anonymous', () => {
    expect(isGuest(user({ is_anonymous: true }))).toBe(true)
    expect(isGuest(user())).toBe(false)
    expect(isGuest(null)).toBe(false)
  })
})

beforeEach(() => {
  sb.updateUser.mockReset()
  sb.signOut.mockReset()
  sb.signOut.mockResolvedValue({ error: null })
  push.remove.mockReset()
  push.remove.mockResolvedValue(undefined)
})

describe('signOut', () => {
  it('removes this device subscription before ending the session', async () => {
    const order: string[] = []
    push.remove.mockImplementation(async () => void order.push('remove'))
    sb.signOut.mockImplementation(async () => (order.push('signOut'), { error: null }))
    offline.reset.mockImplementation(async (id?: string) => void order.push(`reset:${id}`))
    await signOut()
    // Session cleared first, so other tabs can't reopen the store between the wipe and sign-out.
    expect(order).toEqual(['remove', 'signOut', 'reset:guest'])
  })
  it('still signs out when the offline reset fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    offline.reset.mockRejectedValueOnce(new Error('idb'))
    sb.signOut.mockResolvedValue({ error: null })
    await signOut()
    expect(sb.signOut).toHaveBeenCalled()
  })
  it('still signs out when removal rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    push.remove.mockRejectedValue(new Error('boom'))
    await signOut()
    expect(sb.signOut).toHaveBeenCalled()
  })
  it('still signs out when removal hangs', async () => {
    vi.useFakeTimers()
    try {
      push.remove.mockReturnValue(new Promise(() => {}))
      const p = signOut()
      await vi.advanceTimersByTimeAsync(4000)
      await p
      expect(sb.signOut).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('offline data on account changes', () => {
  it('unsyncedBeforeSignOut tries to sync, then counts what is left', async () => {
    offline.pending.mockResolvedValueOnce(2)
    expect(await unsyncedBeforeSignOut()).toBe(2)
    expect(offline.flush).toHaveBeenCalled()
  })
  it('signIn over a guest session wipes the guest’s offline data after signing in', async () => {
    const order: string[] = []
    offline.reset.mockImplementation(async (id?: string) => void order.push(`reset:${id}`))
    sb.signIn.mockImplementation(async () => (order.push('signIn'), { data: { user: { id: 'other' } }, error: null }))
    await signIn('a@example.com', 'pw')
    expect(order).toEqual(['signIn', 'reset:guest'])
  })
  it('a failed signIn leaves the guest’s offline data alone', async () => {
    sb.signIn.mockResolvedValueOnce({ data: { user: null }, error: { message: 'Invalid login credentials' } } as never)
    await expect(signIn('a@example.com', 'bad')).rejects.toMatchObject({ message: 'Invalid login credentials' })
    expect(offline.reset).not.toHaveBeenCalled()
  })
})

describe('createProfile', () => {
  it("returns 'confirm' only for the email-not-confirmed error", async () => {
    sb.updateUser
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { code: 'email_not_confirmed', message: 'x' } })
    expect(await createProfile('a@example.com', 'password123')).toBe('confirm')
    expect(sb.signOut).not.toHaveBeenCalled()
  })
  it('rethrows other password errors (weak password)', async () => {
    const weak = { code: 'weak_password', message: 'Password should be longer' }
    sb.updateUser.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: weak })
    await expect(createProfile('a@example.com', 'x')).rejects.toBe(weak)
  })
  it('emailRedirectTo includes the deploy base', async () => {
    vi.stubEnv('BASE_URL', '/medtracker/')
    sb.updateUser.mockResolvedValue({ error: null })
    await createProfile('a@example.com', 'password123')
    expect(sb.updateUser.mock.calls[0]?.[1]).toEqual({ emailRedirectTo: `${location.origin}/medtracker/settings?finish=1` })
    vi.unstubAllEnvs()
  })
  it('revokes other sessions after an immediate success', async () => {
    sb.updateUser.mockResolvedValue({ error: null })
    expect(await createProfile('a@example.com', 'password123')).toBe('done')
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'others' })
  })
})

describe('setPassword', () => {
  it('revokes other sessions, and a revoke failure does not undo success', async () => {
    sb.updateUser.mockResolvedValue({ error: null })
    sb.signOut.mockRejectedValue(new Error('network'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(setPassword('password123')).resolves.toBeUndefined()
    expect(sb.signOut).toHaveBeenCalledWith({ scope: 'others' })
  })
})
