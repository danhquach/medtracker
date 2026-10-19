import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CheckIcon, CircleIcon, CrossIcon, SkipIcon } from '../../components/icons'
import { Empty, Loading } from '../../components/states'
import { listDoses, setDoseStatus } from '../../data/doses'
import { listMeds } from '../../data/meds'
import { DEFAULT_TIME_ZONE } from '../../data/profile'
import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import LoadError from '../auth/LoadError'
import { useProfileState } from '../auth/useProfile'
import { addDays, localDayRange, timeLabel, todayIn } from '../today/dayRange'

const STATUS: Record<DoseStatus, { Icon: typeof CheckIcon; label: string }> = {
  taken: { Icon: CheckIcon, label: 'Taken' },
  skipped: { Icon: SkipIcon, label: 'Skipped' },
  missed: { Icon: CrossIcon, label: 'Missed' },
  pending: { Icon: CircleIcon, label: 'Pending' },
}
const LEGEND: DoseStatus[] = ['taken', 'skipped', 'missed', 'pending']

// What the user can set a dose to. "Not taken" goes back to pending; on a past day that reads as Missed.
const CHOICES: { status: DoseStatus; label: string }[] = [
  { status: 'taken', label: 'Taken' },
  { status: 'skipped', label: 'Skipped' },
  { status: 'pending', label: 'Not taken' },
]

const dayOf = (iso: string, tz: string): string => todayIn(tz, new Date(iso).getTime())

/** Pending on a past day becomes Missed on the next background run; show it that way now. */
const shownStatus = (d: DoseEvent, tz: string, today: string): DoseStatus =>
  d.status === 'pending' && dayOf(d.scheduled_for, tz) < today ? 'missed' : d.status

function StatusIcon({ status }: { status: DoseStatus }) {
  const { Icon, label } = STATUS[status]
  return (
    <span role="img" aria-label={label} className={`status-icon dose-${status}`}>
      <Icon />
    </span>
  )
}

const fmt = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(new Date(`${date}T00:00:00Z`))
const dayHeading = (date: string) => fmt(date, { weekday: 'short', month: 'short', day: 'numeric' })

export default function History() {
  const { profile, error: profileError, retry: retryProfile } = useProfileState()
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE
  const [meds, setMeds] = useState<Medication[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const { medId: selected } = useParams()

  const hasProfile = !!profile
  const today = todayIn(tz)
  useEffect(() => {
    if (!hasProfile) return
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
  }, [hasProfile, tz, today])

  // Active meds first; paused ones keep their past doses, marked as paused.
  const ordered = useMemo(() => [...meds].sort((a, b) => Number(a.paused) - Number(b.paused)), [meds])
  const byMedDay = useMemo(() => {
    const map = new Map<string, DoseEvent[]>()
    for (const d of doses) {
      const key = `${d.medication_id}|${dayOf(d.scheduled_for, tz)}`
      map.set(key, [...(map.get(key) ?? []), d])
    }
    return map
  }, [doses, tz])

  const change = async (dose: DoseEvent, status: DoseStatus) => {
    setBusy(dose.id)
    setSaveError(null)
    try {
      const row = await setDoseStatus(dose.id, status)
      setDoses((ds) => (row ? ds.map((d) => (d.id === row.id ? row : d)) : ds.filter((d) => d.id !== dose.id)))
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save that change')
    } finally {
      setBusy(null)
    }
  }

  if (profileError && !profile)
    return (
      <main>
        <LoadError message={profileError} onRetry={retryProfile} />
      </main>
    )
  if (!loaded)
    return (
      <main>
        <Loading />
      </main>
    )

  const detail = meds.find((m) => m.id === selected)
  if (selected && !detail) return <Navigate to="/history" replace />
  if (detail) {
    const list = doses
      .filter((d) => d.medication_id === detail.id)
      .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for))
    return (
      <main className="stack">
        <h2>
          {detail.name} — last 30 days
          {detail.paused && <span className="chip chip-inline">Paused</span>}
        </h2>
        {saveError && <p role="alert">{saveError}</p>}
        {list.length === 0 ? (
          <p className="muted">No doses in the last 30 days.</p>
        ) : (
          <ul className="history-list">
            {list.map((d) => {
              const shown = shownStatus(d, tz, today)
              const when = `${dayHeading(dayOf(d.scheduled_for, tz))} ${timeLabel(d.scheduled_for, tz)}`
              return (
                <li key={d.id} className="history-item">
                  <div>
                    <span>{when}</span> <StatusIcon status={shown} />{' '}
                    <span className={`status-${shown}`}>{STATUS[shown].label}</span>
                  </div>
                  <div className="row" role="group" aria-label={`Change dose ${when}`}>
                    {CHOICES.map((c) => (
                      <button
                        key={c.status}
                        type="button"
                        aria-pressed={c.status === 'pending' ? shown === 'pending' || shown === 'missed' : shown === c.status}
                        disabled={busy === d.id}
                        onClick={() => void change(d, c.status)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    )
  }

  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  return (
    <main className="stack">
      {error && <p role="alert">{error}</p>}
      {!error && ordered.length === 0 && <Empty>No medications yet.</Empty>}
      {ordered.length > 0 && (
        <>
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
              {ordered.map((m) => (
                <tr key={m.id} className={m.paused ? 'is-paused' : undefined}>
                  <th scope="row">
                    <Link to={`/history/${m.id}`}>{m.name}</Link>
                    {m.paused && <span className="chip chip-inline">Paused</span>}
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
          <ul className="legend" aria-label="Legend">
            {LEGEND.map((s) => {
              const { Icon, label } = STATUS[s]
              return (
                <li key={s}>
                  <span aria-hidden="true" className={`status-icon dose-${s}`}>
                    <Icon />
                  </span>
                  {label}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </main>
  )
}
