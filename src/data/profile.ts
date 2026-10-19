import { currentUserId, supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'

export const DEFAULT_TIME_ZONE = 'America/Toronto'

async function selectProfile(id: string) {
  return supabase.from('profiles').select('*').eq('user_id', id).single()
}

export async function getProfile(): Promise<Profile> {
  const { data, error } = await selectProfile(await currentUserId())
  if (error) throw error
  return data as Profile
}

export type ProfilePatch = Partial<Pick<Profile, 'nickname' | 'time_zone' | 'snooze_minutes' | 'suggestions_enabled'>>

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
  const { error } = await supabase.rpc('touch_last_seen')
  if (error) throw error
}

/** Server checks that auth really holds a password before setting the flag. */
export async function markPasswordSet(): Promise<void> {
  const { error } = await supabase.rpc('mark_password_set')
  if (error) throw error
}

const tzKey = (userId: string) => `tzDetected:${userId}`

function isTimeZoneMarked(userId: string): boolean {
  try {
    return localStorage.getItem(tzKey(userId)) !== null
  } catch {
    return false
  }
}

/** Settings calls this when the user saves a zone, so auto-detect never overrides it. */
export function markTimeZoneChosen(userId: string): void {
  try {
    localStorage.setItem(tzKey(userId), '1')
  } catch {
    // storage unavailable
  }
}

/** Once per user per device: if the zone is still the default, adopt the browser's. */
export async function detectTimeZone(): Promise<void> {
  const id = await currentUserId()
  if (isTimeZoneMarked(id)) return
  const profile = await getProfile()
  if (profile.time_zone === DEFAULT_TIME_ZONE) {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (browser && browser !== DEFAULT_TIME_ZONE) await updateProfile({ time_zone: browser })
  }
  markTimeZoneChosen(id)
}
