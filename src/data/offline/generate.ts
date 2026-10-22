import { addDays, localWallTimeUtc, todayIn } from '../../features/today/dayRange'
import type { DoseEvent, Medication, Schedule } from '../../lib/types'

const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t)

/** Every scheduled dose time (past or future) on `days` in `tz`, for meds that are not paused; prn has none. */
export function doseTimes(
  meds: Medication[],
  schedules: Schedule[],
  days: string[],
  tz: string,
): { med: Medication; day: string; time: string; at: number }[] {
  const out: { med: Medication; day: string; time: string; at: number }[] = []
  for (const day of days) {
    const isoDow = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
    for (const s of schedules) {
      const m = meds.find((x) => x.id === s.medication_id)
      if (!m || m.paused || s.kind === 'prn') continue
      if ((s.start_date && day < s.start_date) || (s.end_date && day > s.end_date)) continue
      if (s.kind === 'weekdays' && !s.weekdays?.includes(isoDow)) continue
      if (s.kind === 'interval') {
        if (!s.start_date || !s.interval_days) continue
        const gap = (Date.parse(day) - Date.parse(s.start_date)) / 86_400_000
        if (gap % s.interval_days !== 0) continue
      }
      for (const t of s.times) out.push({ med: m, day, time: t, at: localWallTimeUtc(day, t, tz) })
    }
  }
  return out
}

/**
 * Client copy of generate_doses_for (0011): pending doses for today and tomorrow in the user's
 * time zone, future times only. `backfill` (as save_med does) also adds today's passed times for
 * one med, except skipTimes, already marked notified. Returns only rows not in `existing`.
 */
export function generateLocalDoses(input: {
  meds: Medication[]
  schedules: Schedule[]
  existing: Pick<DoseEvent, 'medication_id' | 'scheduled_for'>[]
  timeZone: string
  nowMs: number
  backfill?: { medId: string; skipTimes: string[] }
}): DoseEvent[] {
  const { meds, schedules, timeZone: tz, nowMs, backfill } = input
  const today = todayIn(tz, nowMs)
  const taken = new Set(input.existing.map((d) => `${d.medication_id}|${Date.parse(d.scheduled_for)}`))
  const out: DoseEvent[] = []
  for (const { med: m, day, time: t, at } of doseTimes(meds, schedules, [today, addDays(today, 1)], tz)) {
    const backfillToday = day === today && backfill?.medId === m.id
    if (at <= nowMs && !(backfillToday && !backfill.skipTimes.map(hhmmss).includes(hhmmss(t)))) continue
    const key = `${m.id}|${at}`
    if (taken.has(key)) continue
    taken.add(key)
    const scheduled_for = new Date(at).toISOString()
    out.push({
      id: `local:${m.id}:${scheduled_for}`,
      user_id: m.user_id,
      medication_id: m.id,
      scheduled_for,
      status: 'pending',
      acted_at: null,
      notified_at: at <= nowMs ? new Date(nowMs).toISOString() : null,
      snoozed_until: null,
    })
  }
  return out.sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
}
