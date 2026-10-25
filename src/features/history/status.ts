import { CheckIcon, CircleIcon, CrossIcon, SkipIcon } from '../../components/icons'
import type { DoseEvent, DoseStatus } from '../../lib/types'
import { todayIn } from '../today/dayRange'

export const STATUS: Record<DoseStatus, { Icon: typeof CheckIcon; label: string }> = {
  taken: { Icon: CheckIcon, label: 'Taken' },
  skipped: { Icon: SkipIcon, label: 'Skipped' },
  missed: { Icon: CrossIcon, label: 'Missed' },
  pending: { Icon: CircleIcon, label: 'Pending' },
}
export const LEGEND: DoseStatus[] = ['taken', 'skipped', 'missed', 'pending']

export const dayOf = (iso: string, tz: string): string => todayIn(tz, new Date(iso).getTime())

/** Pending on a past day becomes Missed on the next background run; show it that way now. */
export const shownStatus = (d: DoseEvent, tz: string, today: string): DoseStatus =>
  d.status === 'pending' && dayOf(d.scheduled_for, tz) < today ? 'missed' : d.status

export const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T00:00:00Z`))
export const dayHeading = (date: string) => fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })
