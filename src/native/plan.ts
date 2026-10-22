// Which dose reminders the Android app schedules on the phone (pure, unit-tested).
import { doseTimes } from '../data/offline/generate'
import { sameTime } from '../data/offline/ops'
import { addDays, timeLabel, todayIn } from '../features/today/dayRange'
import type { DoseEvent, Medication, Schedule } from '../lib/types'

export type PlannedReminder = { id: number; at: number; medId: string; scheduledFor: string; title: string; body: string }

/** Stable notification id for one dose: a positive 31-bit FNV-1a hash of med + time. */
export function reminderId(medId: string, scheduledFor: string): number {
  let h = 0x811c9dc5
  for (const c of `${medId}|${Date.parse(scheduledFor)}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return (h >>> 1) || 1
}

/**
 * Pending doses from now through `days` days in the user's zone, soonest first, at most `max`
 * (Android caps the alarms an app can hold). A snooze moves a dose to its snooze time; `snoozes`
 * (by reminder id) are ones made on this phone that the cache may not know about yet.
 */
export function planReminders(input: {
  meds: Medication[]
  schedules: Schedule[]
  doses: DoseEvent[]
  timeZone: string
  nowMs: number
  days?: number
  max?: number
  snoozes?: Record<number, number>
}): PlannedReminder[] {
  const { meds, schedules, doses, timeZone: tz, nowMs, days = 7, max = 64, snoozes = {} } = input
  const today = todayIn(tz, nowMs)
  // From yesterday: a late-evening dose snoozed past midnight still needs its reminder.
  const window = Array.from({ length: days + 1 }, (_, i) => addDays(today, i - 1))
  const out: PlannedReminder[] = []
  for (const { med, at: due } of doseTimes(meds, schedules, window, tz)) {
    if (!med.notify) continue
    const scheduledFor = new Date(due).toISOString()
    const row = doses.find((d) => d.medication_id === med.id && sameTime(d.scheduled_for, scheduledFor))
    if (row && row.status !== 'pending') continue
    const id = reminderId(med.id, scheduledFor)
    const at = Math.max(due, row?.snoozed_until ? Date.parse(row.snoozed_until) : 0, snoozes[id] ?? 0)
    if (at <= nowMs) continue
    const when = timeLabel(scheduledFor, tz)
    out.push({
      id,
      at,
      medId: med.id,
      scheduledFor,
      title: `Time for ${med.name}`,
      body: med.strength ? `${med.strength}, due ${when}` : `Due ${when}`,
    })
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max)
}
