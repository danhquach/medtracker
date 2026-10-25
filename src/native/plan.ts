// Which dose reminders the Android app schedules on the phone (pure, unit-tested).
import { doseTimes } from '../data/offline/generate'
import { sameTime } from '../data/offline/ops'
import { addDays, timeLabel, todayIn } from '../features/today/dayRange'
import type { DoseEvent, Medication, Schedule } from '../lib/types'

// repeat: 0 = the reminder at the dose (or snooze) time, 1..REPEATS = re-alerts after it.
export type PlannedReminder = { id: number; at: number; repeat: number; medId: string; scheduledFor: string; title: string; body: string }

/** Re-alerts for a dose nobody answers, one per Snooze length (same as send-reminders). */
export const REPEATS = 5

/** Stable notification id for one dose (or one of its repeats): a positive 31-bit FNV-1a hash. */
export function reminderId(medId: string, scheduledFor: string, repeat = 0): number {
  let h = 0x811c9dc5
  for (const c of `${medId}|${Date.parse(scheduledFor)}${repeat ? `|${repeat}` : ''}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193)
  return (h >>> 1) || 1
}

/**
 * Pending doses from now through `days` days in the user's zone, soonest first, at most `max`
 * (Android caps the alarms an app can hold). A snooze moves a dose to its snooze time; `snoozes`
 * (by reminder id) are ones made on this phone that the cache may not know about yet.
 * With `repeatMinutes`, each reminder rings again that often, REPEATS times, while the dose is
 * pending. A reminder already in the past only gets its repeats if `rung` (reminder id -> time it
 * was set for) says this phone set it, so a dose added after its time stays quiet. When over
 * `max`, reminders at dose times come before repeats.
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
  repeatMinutes?: number
  rung?: Record<number, number>
}): PlannedReminder[] {
  const { meds, schedules, doses, timeZone: tz, nowMs, days = 7, max = 64, snoozes = {}, repeatMinutes, rung = {} } = input
  const today = todayIn(tz, nowMs)
  // From yesterday: a late-evening dose snoozed past midnight still needs its reminder.
  const window = Array.from({ length: days + 1 }, (_, i) => addDays(today, i - 1))
  const out: PlannedReminder[] = []
  const repeats: PlannedReminder[] = []
  for (const { med, at: due } of doseTimes(meds, schedules, window, tz)) {
    if (!med.notify) continue
    const scheduledFor = new Date(due).toISOString()
    const row = doses.find((d) => d.medication_id === med.id && sameTime(d.scheduled_for, scheduledFor))
    if (row && row.status !== 'pending') continue
    const id = reminderId(med.id, scheduledFor)
    const at = Math.max(due, row?.snoozed_until ? Date.parse(row.snoozed_until) : 0, snoozes[id] ?? 0)
    if (at <= nowMs && rung[id] !== at) continue
    const when = timeLabel(scheduledFor, tz)
    const reminder = (repeat: number, ringAt: number): PlannedReminder => ({
      id: reminderId(med.id, scheduledFor, repeat),
      at: ringAt,
      repeat,
      medId: med.id,
      scheduledFor,
      title: `Time for ${med.name}`,
      body: med.strength ? `${med.strength}, due ${when}` : `Due ${when}`,
    })
    if (at > nowMs) out.push(reminder(0, at))
    for (let k = 1; repeatMinutes && k <= REPEATS; k++) {
      const ringAt = at + k * repeatMinutes * 60_000
      if (ringAt > nowMs) repeats.push(reminder(k, ringAt))
    }
  }
  const byTime = (a: PlannedReminder, b: PlannedReminder) => a.at - b.at
  const first = out.sort(byTime).slice(0, max)
  return [...first, ...repeats.sort(byTime).slice(0, max - first.length)].sort(byTime)
}
