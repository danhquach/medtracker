import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  // Offline with an expired token: getSession has no session, but the stored user is still known.
  sessionUser: () => Promise.resolve({ id: 'u1' }),
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      // supabase-js reports INITIAL_SESSION from getSession too, so it is null in the same case.
      onAuthStateChange: (cb: (event: string, session: null) => void) => {
        setTimeout(() => cb('INITIAL_SESSION', null), 0)
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  },
}))
import { useSession } from './useSession'

describe('useSession', () => {
  it('starts from sessionUser, so an offline expired session still opens the app', async () => {
    const { result } = renderHook(() => useSession())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await new Promise((r) => setTimeout(r, 10))
    expect(result.current.user?.id).toBe('u1')
  })
})
