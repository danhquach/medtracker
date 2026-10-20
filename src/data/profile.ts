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

/**
 * Until the account has a chosen zone, adopt this device's (saving marks it chosen, server-side, so
 * no other device overrides it). Unknown (a profile cached before 0013) counts as chosen.
 */
export async function detectTimeZone(): Promise<void> {
  const profile = await getProfile()
  if (profile.time_zone_chosen !== false) return
  const browser = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (browser) await updateProfile({ time_zone: browser })
}
