import { landingUrl } from '../../lib/supabase'

export type EmailLink = 'verified' | 'failed' | null

const ERROR_KEYS = ['error', 'error_code', 'error_description']

/** What an email confirmation link reported: Supabase puts the result in the hash (or errors in the query). */
export function readEmailLink(href: string): EmailLink {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  if (ERROR_KEYS.some((k) => hash.has(k) || url.searchParams.has(k))) return 'failed'
  const type = hash.get('type')
  return hash.has('access_token') && (type === 'signup' || type === 'email_change' || type === 'email') ? 'verified' : null
}

// One notice per page load: moving from Welcome into the app must not show it again.
let shown = false

/** The link the app opened with, unless its notice was already shown. */
export const pendingEmailLink = (): EmailLink => (shown ? null : readEmailLink(landingUrl))

/** Marks the notice shown; supabase-js leaves a failed link's error in the address, so drop it too. */
export function markEmailLinkShown(link: EmailLink): void {
  shown = true
  if (link !== 'failed') return
  const url = new URL(location.href)
  ERROR_KEYS.forEach((k) => url.searchParams.delete(k))
  url.hash = ''
  history.replaceState(history.state, '', url.href)
}

export const resetEmailLinkForTest = () => (shown = false)
