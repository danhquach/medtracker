import type { DoseEvent, Medication } from '../../lib/types'
import { dayHeading, dayOf, fmt, shownStatus } from './status'

export interface Counts {
  scheduled: number
  taken: number
  skipped: number
  missed: number
  pending: number
}

export interface MonthReport {
  month: string // 'YYYY-MM'
  /** Set for the current month: the report runs through this day. */
  through: string | null
  total: Counts
  perMed: { med: Medication; counts: Counts }[]
}

const zero = (): Counts => ({ scheduled: 0, taken: 0, skipped: 0, missed: 0, pending: 0 })

/** Taken share of the doses that are due and answered or missed (today's pending ones aren't counted yet). Null when none are. */
export const takenPct = (c: Counts): number | null => {
  const due = c.scheduled - c.pending
  return due ? Math.round((c.taken / due) * 100) : null
}

/**
 * The month's totals, built from the same doses and statuses as the month calendar.
 * The current month stops at today. Null when the month has no dose records.
 */
export function monthReport(doses: DoseEvent[], meds: Medication[], month: string, tz: string, today: string): MonthReport | null {
  const byMed = new Map<string, Counts>(meds.map((m) => [m.id, zero()]))
  const total = zero()
  for (const d of doses) {
    const c = byMed.get(d.medication_id)
    const day = dayOf(d.scheduled_for, tz)
    if (!c || day.slice(0, 7) !== month || day > today) continue
    const s = shownStatus(d, tz, today)
    for (const x of [c, total]) {
      x.scheduled++
      x[s]++
    }
  }
  if (!total.scheduled) return null
  return {
    month,
    through: month === today.slice(0, 7) ? today : null,
    total,
    perMed: meds.filter((m) => byMed.get(m.id)!.scheduled).map((med) => ({ med, counts: byMed.get(med.id)! })),
  }
}

export const reportTitle = (r: MonthReport) => fmt(`${r.month}-01`, { month: 'long', year: 'numeric' })

const line = (c: Counts) => {
  const pct = takenPct(c)
  return [
    `${c.scheduled} scheduled`,
    `${c.taken} taken`,
    `${c.skipped} skipped`,
    `${c.missed} missed`,
    ...(c.pending ? [`${c.pending} pending`] : []),
    ...(pct === null ? [] : [`${pct}% taken`]),
  ].join(', ')
}

/** Plain text for the share sheet. */
export function reportText(r: MonthReport): string {
  return [
    `MedTracker dose report: ${reportTitle(r)}`,
    ...(r.through ? [`Month to date, through ${dayHeading(r.through)}`] : []),
    '',
    `All meds: ${line(r.total)}`,
    ...r.perMed.map(({ med, counts }) => `${med.name}${med.paused ? ' (paused)' : ''}: ${line(counts)}`),
    '',
  ].join('\n')
}
