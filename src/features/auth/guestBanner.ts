const KEY = 'guestBannerDismissedAt'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export function shouldShowGuestBanner(isGuest: boolean, dismissedAt: number | null, now: number): boolean {
  if (!isGuest) return false
  return dismissedAt === null || now - dismissedAt >= WEEK_MS
}

export function readGuestBannerDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(KEY)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function writeGuestBannerDismissedAt(at: number): void {
  try {
    localStorage.setItem(KEY, String(at))
  } catch {
    // storage unavailable: banner will simply reappear
  }
}
