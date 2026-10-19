import type { Schedule } from '../../lib/types'

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

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
