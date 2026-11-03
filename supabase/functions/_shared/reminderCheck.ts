// Whether a reminder the Android app set earlier should still ring (MT-152). Dependency-free.

export type CheckMed = { notify: boolean; paused: boolean } | null
export type CheckDose = { status: string; snoozed_until: string | null } | null

// A repeat set for the snooze time may ring a little before the snooze ends.
const SNOOZE_SLACK_MS = 60_000

/** False when the dose was dealt with elsewhere: marked, snoozed past now, or its med gone or quiet. */
export function shouldRing(med: CheckMed, dose: CheckDose, now: number): boolean {
  if (!med || !med.notify || med.paused) return false
  if (!dose) return true
  if (dose.status !== 'pending') return false
  return !dose.snoozed_until || Date.parse(dose.snoozed_until) <= now + SNOOZE_SLACK_MS
}
