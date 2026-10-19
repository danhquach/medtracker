import { useEffect, useMemo, useState } from 'react'
import { listDoses } from '../../data/doses'
import { listMeds } from '../../data/meds'
import { DEFAULT_TIME_ZONE } from '../../data/profile'
import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import { useProfile } from '../auth/useProfile'
import { addDays, localDayRange, timeLabel, todayIn } from '../today/dayRange'

const ICON: Record<DoseStatus, { glyph: string; label: string }> = {
  taken: { glyph: '✓', label: 'Taken' },
  skipped: { glyph: '–', label: 'Skipped' },
  missed: { glyph: '✗', label: 'Missed' },
  pending: { glyph: '·', label: 'Pending' },
}

const dayOf = (iso: string, tz: string): string => todayIn(tz, new Date(iso).getTime())

function StatusIcon({ status }: { status: DoseStatus }) {
  const { glyph, label } = ICON[status]
  return (
    <span role="img" aria-label={label} className={`dose-${status}`}>
      {glyph}
    </span>
  )
}

const dayHeading = (date: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(
    new Date(`${date}T00:00:00Z`),
  )

export default function History() {
  const profile = useProfile()
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE
  const [meds, setMeds] = useState<Medication[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const today = todayIn(tz)
  useEffect(() => {
    if (!profile) return
    let alive = true
    Promise.all([listMeds(), listDoses(localDayRange(addDays(today, -29), tz).from, localDayRange(today, tz).to)]).then(
      ([m, d]) => {
        if (!alive) return
        setMeds(m)
        setDoses(d)
        setLoaded(true)
      },
      (e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load history')
        setLoaded(true)
      },
    )
    return () => {
      alive = false
    }
  }, [profile, tz, today])

  const active = useMemo(() => meds.filter((m) => !m.paused), [meds])
  const byMedDay = useMemo(() => {
    const map = new Map<string, DoseEvent[]>()
    for (const d of doses) {
      const key = `${d.medication_id}|${dayOf(d.scheduled_for, tz)}`
      map.set(key, [...(map.get(key) ?? []), d])
    }
    return map
  }, [doses, tz])

  if (!loaded) return <main aria-busy="true" />

  const detail = active.find((m) => m.id === selected)
  if (detail) {
    const list = doses
      .filter((d) => d.medication_id === detail.id)
      .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for))
    return (
      <main className="stack">
        <button type="button" onClick={() => setSelected(null)}>
          Back
        </button>
        <h2>{detail.name} — last 30 days</h2>
        {list.length === 0 ? (
          <p className="muted">No doses in the last 30 days.</p>
        ) : (
          <ul className="history-list">
            {list.map((d) => (
              <li key={d.id}>
                <span>{dayHeading(dayOf(d.scheduled_for, tz))}</span> <span>{timeLabel(d.scheduled_for, tz)}</span>{' '}
                <StatusIcon status={d.status} /> <span className="muted">{ICON[d.status].label}</span>
              </li>
            ))}
          </ul>
        )}
      </main>
    )
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  return (
    <main className="stack">
      <h2>History</h2>
      {error && <p role="alert">{error}</p>}
      {!error && active.length === 0 && <p className="muted">No active medications.</p>}
      {active.length > 0 && (
        <table className="history-grid">
          <thead>
            <tr>
              <th scope="col">Medication</th>
              {days.map((d) => (
                <th key={d} scope="col">
                  {new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'narrow' }).format(new Date(`${d}T00:00:00Z`))}
                  <span className="sr-only">{dayHeading(d)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.id}>
                <th scope="row">
                  <button type="button" onClick={() => setSelected(m.id)}>
                    {m.name}
                  </button>
                </th>
                {days.map((d) => (
                  <td key={d}>
                    {(byMedDay.get(`${m.id}|${d}`) ?? []).map((x) => (
                      <StatusIcon key={x.id} status={x.status} />
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
