import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { DoseEvent, Medication } from '../../lib/types'
import { addDays } from '../today/dayRange'
import { Chip } from '../../components/layout'
import StatusIcon from './StatusIcon'
import { dayHeading, dayOf, fmt, shownStatus } from './status'

/** The last 7 days: one row per med, one column per day. */
export default function WeekView({
  meds,
  doses,
  tz,
  today,
}: {
  meds: Medication[]
  doses: DoseEvent[]
  tz: string
  today: string
}) {
  const byMedDay = useMemo(() => {
    const map = new Map<string, DoseEvent[]>()
    for (const d of doses) {
      const key = `${d.medication_id}|${dayOf(d.scheduled_for, tz)}`
      map.set(key, [...(map.get(key) ?? []), d])
    }
    return map
  }, [doses, tz])
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))

  return (
    <table className="history-grid">
      <thead>
        <tr>
          <th scope="col">Medication</th>
          {days.map((d) => (
            <th key={d} scope="col">
              <span aria-hidden="true" className="day-head">
                <span>{fmt(d, { weekday: 'short' })}</span>
                <span>{fmt(d, { day: 'numeric' })}</span>
              </span>
              <span className="sr-only">{dayHeading(d)}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {meds.map((m) => (
          <tr key={m.id} className={m.paused ? 'is-paused' : undefined}>
            <th scope="row">
              <Link to={`/history/${m.id}`}>{m.name}</Link>
              {m.paused && <Chip inline>Paused</Chip>}
            </th>
            {days.map((d) => (
              <td key={d}>
                {(byMedDay.get(`${m.id}|${d}`) ?? []).map((x) => (
                  <StatusIcon key={x.id} status={shownStatus(x, tz, today)} />
                ))}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
