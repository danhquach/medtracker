import type { User } from '@supabase/supabase-js'
import { updateProfile } from '../../data/profile'
import { removeThisDeviceSubscription } from '../../push/subscribe'
import { appUrl } from '../../lib/basePath'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'

export const GUEST_LEFT_BEHIND = 'Your guest data on this device will be left behind.'

export async function continueAsGuest(): Promise<void> {
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw error
}

/**
 * Links email + password to the current anonymous user (same user id).
 * 'done': both applied (confirmations off). 'confirm': email must be confirmed first;
 * the password is then set from Settings (see needsPasswordFinish).
 */
export async function createProfile(email: string, password: string): Promise<'done' | 'confirm'> {
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: appUrl('settings?finish=1') })
  if (error) throw error
  const { error: pwError } = await supabase.auth.updateUser({ password })
  if (pwError) {
    if (isEmailPendingError(pwError)) return 'confirm'
    throw pwError
  }
  await updateProfile({ password_set: true })
  await revokeOtherSessions()
  return 'done'
}

/**
 * The only expected password failure right after an email link: the new email is not confirmed yet.
 * Matched on GoTrue error code `email_not_confirmed`, or a message that says the email must be
 * confirmed/verified. Anything else (weak password, network, rate limit) is rethrown.
 * NOTE: code/message not verified against the hosted project's pending-confirmation response.
 */
export function isEmailPendingError(e: { code?: string; message?: string }): boolean {
  return e.code === 'email_not_confirmed' || /email.*(confirm|verif)|(confirm|verif).*email/i.test(e.message ?? '')
}

/** Invalidate the old anonymous refresh tokens. Never undoes the already-successful password set. */
async function revokeOtherSessions(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'others' })
    if (error) console.error('could not revoke other sessions', error)
  } catch (e) {
    console.error('could not revoke other sessions', e)
  }
}

/** Returns true when a session exists (confirmations off); false when email confirmation is pending. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { password_set: true } } })
  if (error) throw error
  if (!data.session) return false
  await updateProfile({ password_set: true })
  return true
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
}

export async function signOut(): Promise<void> {
  // While the session is still valid. Best-effort and time-boxed: never blocks sign-out.
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([removeThisDeviceSubscription(), new Promise<void>((r) => (timer = setTimeout(r, 3500)))])
  } catch (e) {
    console.error('could not remove push subscription', e)
  } finally {
    clearTimeout(timer)
  }
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function setPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw error
  await updateProfile({ password_set: true })
  await revokeOtherSessions()
}

export const isGuest = (user: User | null | undefined): boolean => !!user?.is_anonymous

/** Confirmed email, not a guest, and no password yet (e.g. confirmed an upgrade link in prod). */
export function needsPasswordFinish(user: User | null | undefined, profile: Pick<Profile, 'password_set'> | null): boolean {
  if (!user || user.is_anonymous || !user.email_confirmed_at || !profile) return false
  return !profile.password_set && user.user_metadata?.password_set !== true
}
