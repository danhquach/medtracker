import type { MedForm, Schedule } from '../../lib/types'
import { addDays, dayTitle } from '../today/dayRange'

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Unit stock and doses are counted in, e.g. "tablets", "mL". */
export function stockUnit(form: MedForm | null, n: number): string {
  if (form === 'liquid') return 'mL'
  const word = form === 'tablet' || form === 'capsule' ? form : 'unit'
  return n === 1 ? word : `${word}s`
}

type NextSchedule = Pick<Schedule, 'kind' | 'times' | 'weekdays' | 'interval_days' | 'start_date' | 'end_date'>

const isoDow = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000)

function fallsOn(s: NextSchedule, date: string): boolean {
  if (s.start_date && date < s.start_date) return false
  if (s.end_date && date > s.end_date) return false
  switch (s.kind) {
    case 'daily':
      return true
    case 'weekdays':
      return (s.weekdays ?? []).includes(isoDow(date))
    case 'interval':
      return !!s.start_date && !!s.interval_days && dayDiff(date, s.start_date) % s.interval_days === 0
    default:
      return false
  }
}

/**
 * When the next scheduled dose falls, mirroring the server's generator: "today 9:00 AM",
 * "tomorrow 8:00 PM" or "Mon, Oct 26 9:00 AM". Null for as-needed only, or nothing within a year.
 * `today` and `nowTime` ('HH:MM') are local to the user's time zone.
 */
export function nextDoseText(schedules: NextSchedule[], today: string, nowTime: string): string | null {
  for (let i = 0; i <= 366; i++) {
    const date = addDays(today, i)
    const times = schedules
      .filter((s) => fallsOn(s, date))
      .flatMap((s) => s.times.map((t) => t.slice(0, 5)))
      .filter((t) => i > 0 || t > nowTime)
      .sort()
    if (times.length === 0) continue
    const day = i === 0 ? 'today' : i === 1 ? 'tomorrow' : dayTitle(date)
    return `${day} ${timeText(times[0])}`
  }
  return null
}

function timeText(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}

export function scheduleSummary(schedules: Schedule[]): string {
  if (schedules.length === 0) return 'No schedule'
  return schedules
    .map((s) => {
      const times = [...(s.times ?? [])].sort().map(timeText).join(', ')
      switch (s.kind) {
        case 'daily':
          return `Daily — ${times}`
        case 'weekdays':
          return `${[...(s.weekdays ?? [])].sort((a, b) => a - b).map((d) => DAY[d - 1]).join(', ')} — ${times}`
        case 'interval':
          return `Every ${s.interval_days} days — ${times}`
        default:
          return 'As needed'
      }
    })
    .join(' · ')
}
