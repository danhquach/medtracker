import { describe, expect, it } from 'vitest'
import type { DoseEvent, DoseStatus } from '../../lib/types'
import { dayHeading, dayOf, shownStatus } from './status'

const dose = (scheduled_for: string, status: DoseStatus): DoseEvent => ({
  id: 'd1',
  user_id: 'u1',
  medication_id: 'm1',
  scheduled_for,
  status,
  acted_at: null,
  notified_at: null,
  snoozed_until: null,
})

describe('history status', () => {
  it('dayOf puts a dose on its local day', () => {
    expect(dayOf('2026-10-20T02:00:00Z', 'America/Toronto')).toBe('2026-10-19')
  })

  it('shows a pending dose from a past day as missed', () => {
    expect(shownStatus(dose('2026-10-18T13:00:00Z', 'pending'), 'America/Toronto', '2026-10-19')).toBe('missed')
  })

  it('keeps today’s pending dose and any answered dose as they are', () => {
    expect(shownStatus(dose('2026-10-19T13:00:00Z', 'pending'), 'America/Toronto', '2026-10-19')).toBe('pending')
    expect(shownStatus(dose('2026-10-18T13:00:00Z', 'skipped'), 'America/Toronto', '2026-10-19')).toBe('skipped')
  })

  it('dayHeading reads as a short weekday and date', () => {
    expect(dayHeading('2026-10-19')).toBe('Mon, Oct 19')
  })
})
