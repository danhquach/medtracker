import { describe, expect, it } from 'vitest'
import { shouldRing } from './reminderCheck'

const now = Date.parse('2026-11-03T15:00:00Z')
const med = { notify: true, paused: false }
const pending = { status: 'pending', snoozed_until: null }

describe('shouldRing', () => {
  it('rings for a pending dose, or one with no row yet', () => {
    expect(shouldRing(med, pending, now)).toBe(true)
    expect(shouldRing(med, null, now)).toBe(true)
  })
  it('stays quiet once the dose is marked on any device', () => {
    for (const status of ['taken', 'skipped', 'missed']) expect(shouldRing(med, { status, snoozed_until: null }, now)).toBe(false)
  })
  it('stays quiet while a snooze made elsewhere runs, and rings when it ends', () => {
    expect(shouldRing(med, { status: 'pending', snoozed_until: '2026-11-03T15:10:00Z' }, now)).toBe(false)
    expect(shouldRing(med, { status: 'pending', snoozed_until: '2026-11-03T15:00:30Z' }, now)).toBe(true)
    expect(shouldRing(med, { status: 'pending', snoozed_until: '2026-11-03T15:01:00Z' }, now)).toBe(true) // exactly the slack
    expect(shouldRing(med, { status: 'pending', snoozed_until: '2026-11-03T15:01:01Z' }, now)).toBe(false)
    expect(shouldRing(med, { status: 'pending', snoozed_until: '2026-11-03T14:50:00Z' }, now)).toBe(true)
  })
  it('stays quiet when the med was deleted, paused or had reminders turned off', () => {
    expect(shouldRing(null, null, now)).toBe(false)
    expect(shouldRing({ notify: true, paused: true }, pending, now)).toBe(false)
    expect(shouldRing({ notify: false, paused: false }, pending, now)).toBe(false)
  })
})
