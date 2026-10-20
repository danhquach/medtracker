import { currentUserId, supabase } from '../lib/supabase'
import type { Profile } from '../lib/types'
import { opMeta } from './offline/ops'
import { readThrough, submit } from './offline/sync'

export const DEFAULT_TIME_ZONE = 'America/Toronto'

async function selectProfile(id: string) {
  return supabase.from('profiles').select('*').eq('user_id', id).single()
}

export async function getProfile(): Promise<Profile> {
  return readThrough(
    async () => {
      const { data, error } = await selectProfile(await currentUserId())
      if (error) throw error
      return data as Profile
    },
    (c) => {
      if (!c.profile) throw new Error('Could not load your profile')
      return c.profile
    },
    (c, profile) => ({ ...c, profile }),
  )
}

export type ProfilePatch = Partial<Pick<Profile, 'nickname' | 'time_zone' | 'snooze_minutes' | 'suggestions_enabled'>>

/** One update_profile call; a time zone change also regenerates future doses (server-side). */
export async function updateProfile(patch: ProfilePatch): Promise<Profile> {
  return submit({ ...opMeta(), kind: 'updateProfile', patch }, (c) => {
    if (!c.profile) throw new Error('Could not load your profile')
    return c.profile
  })
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
