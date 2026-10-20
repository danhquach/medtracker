import { AuthRetryableFetchError, AuthApiError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', async (orig) => ({
  ...(await orig<typeof import('@supabase/supabase-js')>()),
  createClient: () => ({ auth: { getSession, storageKey: 'sb-test-auth-token' } }),
}))
const mem = vi.hoisted(() => new Map<string, string>())
vi.hoisted(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) },
  })
})
import { currentUserId, sessionUser } from './supabase'

const stored = { access_token: 'a', refresh_token: 'r', expires_at: 1, user: { id: 'u1', is_anonymous: false } }

beforeEach(() => {
  mem.clear()
  getSession.mockReset()
})

describe('sessionUser', () => {
  it('returns the live session user', async () => {
    getSession.mockResolvedValue({ data: { session: { user: { id: 'u2' } } }, error: null })
    expect((await sessionUser())?.id).toBe('u2')
  })

  it('offline with an expired token keeps the stored user', async () => {
    mem.set('sb-test-auth-token', JSON.stringify(stored))
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    expect((await sessionUser())?.id).toBe('u1')
    expect(await currentUserId()).toBe('u1')
  })

  it('a rejected refresh (not a network error) means signed out', async () => {
    mem.set('sb-test-auth-token', JSON.stringify(stored))
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found') })
    expect(await sessionUser()).toBeNull()
  })

  it('a refresh stuck retrying offline does not block: the stored user answers', async () => {
    vi.useFakeTimers()
    try {
      mem.set('sb-test-auth-token', JSON.stringify(stored))
      getSession.mockReturnValue(new Promise(() => {})) // supabase-js backs off for ~25 s offline
      const user = sessionUser()
      await vi.advanceTimersByTimeAsync(1500)
      expect((await user)?.id).toBe('u1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('signed out (nothing stored) stays signed out', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) })
    expect(await sessionUser()).toBeNull()
    await expect(currentUserId()).rejects.toThrow('Not signed in')
  })
})
