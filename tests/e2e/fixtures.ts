import type { BrowserContext } from '@playwright/test'

// Local test value for throwaway users on the TEST project; never a real credential.
export const PASSWORD = 'Test-pass-123!'
export const EMAIL_PREFIX = 'e2e-'
export const EMAIL_DOMAIN = '@example.com'

export const randomEmail = () => `${EMAIL_PREFIX}${crypto.randomUUID()}${EMAIL_DOMAIN}`

/** The specs run with timezoneId America/Toronto (see playwright.config.ts). */
const TZ = 'America/Toronto'

export function torontoParts(offsetMinutes = 0): { time: string; hour: number } {
  const d = new Date(Date.now() + offsetMinutes * 60_000)
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
  const time = fmt.format(d)
  return { time, hour: Number(time.slice(0, 2)) }
}

/** Keep the specs independent of the public drug-name APIs. */
export async function blockRemoteSuggestions(context: BrowserContext): Promise<void> {
  await context.route(/health-products\.canada\.ca|clinicaltables\.nlm\.nih\.gov/, (r) => r.abort())
}
