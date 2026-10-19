import { describe, expect, it } from 'vitest'
import { shouldShowGuestBanner } from './guestBanner.ts'

const DAY = 24 * 60 * 60 * 1000
const now = Date.UTC(2026, 9, 19)

describe('shouldShowGuestBanner', () => {
  it('not guest → false', () => {
    expect(shouldShowGuestBanner(false, null, now)).toBe(false)
  })
  it('guest never dismissed → true', () => {
    expect(shouldShowGuestBanner(true, null, now)).toBe(true)
  })
  it('dismissed 6 days ago → false', () => {
    expect(shouldShowGuestBanner(true, now - 6 * DAY, now)).toBe(false)
  })
  it('dismissed 7 days ago → true', () => {
    expect(shouldShowGuestBanner(true, now - 7 * DAY, now)).toBe(true)
  })
})
