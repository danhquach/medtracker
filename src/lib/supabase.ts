import { createClient, isAuthRetryableFetchError, type User } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)

function storedUser(): User | null {
  try {
    const key = (supabase.auth as unknown as { storageKey: string }).storageKey
    const raw = localStorage.getItem(key)
    return raw ? ((JSON.parse(raw) as { user?: User }).user ?? null) : null
  } catch {
    return null
  }
}

/**
 * The signed-in user. Offline with an expired access token, supabase-js retries the refresh for
 * ~25 s and then reports no session although it is still stored; keep that user (without waiting
 * more than 1.5 s) so the app works offline: requests fail as network errors and queued changes
 * wait. A real sign-out or a rejected refresh token clears the stored session.
 */
export async function sessionUser(): Promise<User | null> {
  const slow = Symbol('slow')
  let timer: ReturnType<typeof setTimeout> | undefined
  const r = await Promise.race([
    supabase.auth.getSession(),
    new Promise<typeof slow>((resolve) => (timer = setTimeout(() => resolve(slow), 1500))),
  ])
  clearTimeout(timer)
  if (r === slow) return storedUser()
  if (r.data.session) return r.data.session.user
  return isAuthRetryableFetchError(r.error) ? storedUser() : null
}

export async function currentUserId(): Promise<string> {
  const id = (await sessionUser())?.id
  if (!id) throw new Error('Not signed in')
  return id
}
