import { currentUserId, supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

export const DEFAULT_TIME_ZONE = 'America/Toronto'

export async function getProfile(): Promise<Profile> {
  const id = await currentUserId()
  const { data, error } = await supabase.from('profiles').select('*').eq('user_id', id).single()
  if (error) throw error
  return data as Profile
}

export type ProfilePatch = Partial<Pick<Profile, 'nickname' | 'time_zone' | 'snooze_minutes' | 'suggestions_enabled' | 'password_set'>>

export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  const id = await currentUserId()
  const before = patch.time_zone !== undefined ? await getProfile() : null
  const { data, error } = await supabase.from('profiles').update(patch).eq('user_id', id).select().single()
  if (error) throw error
  if (before && patch.time_zone !== before.time_zone) {
    const { error: rpcError } = await supabase.rpc('regenerate_user_doses')
    if (rpcError) throw rpcError
  }
  return data as Profile
}

export async function touchLastSeen(): Promise<void> {
  const id = await currentUserId()
  const { error } = await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('user_id', id)
  if (error) throw error
}

/** First load: if the zone is still the default, adopt the browser's. */
export async function detectTimeZone(): Promise<void> {
  const profile = await getProfile()
  if (profile.time_zone !== DEFAULT_TIME_ZONE) return
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (browser && browser !== DEFAULT_TIME_ZONE) await updateProfile({ time_zone: browser })
}
