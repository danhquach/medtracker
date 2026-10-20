import { createClient, isAuthRetryableFetchError, type User } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)

/**
 * The signed-in user. Offline with an expired access token, supabase-js can't refresh and reports
 * no session although it is still stored; keep that user so the app works offline (requests fail as
 * network errors and queued changes wait). A real sign-out or a rejected refresh token clears it.
 */
export async function sessionUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession()
  if (data.session) return data.session.user
  if (!isAuthRetryableFetchError(error)) return null
  try {
    const key = (supabase.auth as unknown as { storageKey: string }).storageKey
    const raw = localStorage.getItem(key)
    return raw ? ((JSON.parse(raw) as { user?: User }).user ?? null) : null
  } catch {
    return null
  }
}

export async function currentUserId(): Promise<string> {
  const id = (await sessionUser())?.id
  if (!id) throw new Error('Not signed in')
  return id
}
