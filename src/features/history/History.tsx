import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { CheckIcon, CircleIcon, CrossIcon, SkipIcon } from '../../components/icons'
import { Empty, Loading } from '../../components/states'
import { listDoses, setDoseStatus, STALE_DOSE } from '../../data/doses'
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

type View = 'week' | 'month'
const VIEW_KEY = 'historyView'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week'
  } catch {
    return 'week'
  }
}

function writeView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // storage unavailable: the week view comes back next time
  }
}

/** 'YYYY-MM' n months from `month`. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

function MonthView({ meds, tz, today }: { meds: Medication[]; tz: string; today: string }) {
  const current = today.slice(0, 7)
  const [month, setMonth] = useState(current)
  const [result, setResult] = useState<{ key: string; doses?: DoseEvent[]; error?: string } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const first = `${month}-01`
  const days = useMemo(() => {
    const next = `${addMonths(month, 1)}-01`
    const out: string[] = []
    for (let d = first; d < next; d = addDays(d, 1)) out.push(d)
    return out
  }, [first, month])

  // Keyed by month and zone, so a stale month never shows while the next one loads.
  const key = `${first}|${tz}`
  useEffect(() => {
    let alive = true
    listDoses(localDayRange(first, tz).from, localDayRange(days[days.length - 1], tz).to).then(
      (d) => alive && setResult({ key, doses: d }),
      (e: unknown) => alive && setResult({ key, error: e instanceof Error ? e.message : 'Could not load this month' }),
    )
    return () => {
      alive = false
    }
  }, [key, first, days, tz])
  const doses = result?.key === key ? (result.doses ?? null) : null
  const error = result?.key === key ? (result.error ?? null) : null

  const names = useMemo(() => new Map(meds.map((m) => [m.id, m.name])), [meds])
  const byDay = useMemo(() => {
    const map = new Map<string, DoseEvent[]>()
    for (const d of doses ?? []) {
      if (!names.has(d.medication_id)) continue
      const key = dayOf(d.scheduled_for, tz)
      map.set(key, [...(map.get(key) ?? []), d])
    }
    for (const list of map.values())
      list.sort(
        (a, b) =>
          a.scheduled_for.localeCompare(b.scheduled_for) ||
          names.get(a.medication_id)!.localeCompare(names.get(b.medication_id)!),
      )
    return map
  }, [doses, names, tz])

  const title = fmt(first, { month: 'long', year: 'numeric' })
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay()
  const cells: (string | null)[] = [...Array<null>(lead).fill(null), ...days]
  while (cells.length % 7) cells.push(null)
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7))

  const countsOf = (date: string) => {
    const counts = new Map<DoseStatus, number>()
    for (const d of byDay.get(date) ?? []) {
      const s = shownStatus(d, tz, today)
      counts.set(s, (counts.get(s) ?? 0) + 1)
    }
    return LEGEND.filter((s) => counts.has(s)).map((s) => ({ status: s, n: counts.get(s)! }))
  }
  const go = (n: number) => {
    setPicked(null)
    setMonth((m) => addMonths(m, n))
  }
  const pickedDoses = picked ? (byDay.get(picked) ?? []) : []

  return (
    <>
      <div className="month-nav">
        <button type="button" aria-label="Previous month" onClick={() => go(-1)}>
          ‹
        </button>
        <h2 id="month-title">{title}</h2>
        <button type="button" aria-label="Next month" disabled={month >= current} onClick={() => go(1)}>
          ›
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!error && !doses && <Loading />}
      {doses && (
        <table className="month-grid" aria-labelledby="month-title">
          <thead>
            <tr>
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(first, i - lead)
                return (
                  <th key={i} scope="col" abbr={fmt(d, { weekday: 'long' })}>
                    {fmt(d, { weekday: 'narrow' })}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, w) => (
              <tr key={w}>
                {week.map((d, i) => {
                  if (!d) return <td key={i} />
                  const counts = countsOf(d)
                  const summary = counts.length
                    ? counts.map((c) => `${c.n} ${STATUS[c.status].label}`).join(', ')
                    : 'no doses'
                  return (
                    <td key={i}>
                      <button
                        type="button"
                        className={d === today ? 'month-day is-today' : 'month-day'}
                        aria-label={`${dayHeading(d)}: ${summary}`}
                        aria-pressed={d === picked}
                        aria-current={d === today ? 'date' : undefined}
                        onClick={() => setPicked(d)}
                      >
                        <span>{Number(d.slice(8))}</span>
                        <span className="month-day-marks" aria-hidden="true">
                          {counts.map((c) => {
                            const { Icon } = STATUS[c.status]
                            return (
                              <span key={c.status} className={`status-icon dose-${c.status}`}>
                                <Icon />
                              </span>
                            )
                          })}
                        </span>
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {doses && picked && (
        <section aria-labelledby="picked-day" className="stack">
          <h3 id="picked-day">{dayHeading(picked)}</h3>
          {pickedDoses.length === 0 ? (
            <p className="muted">No doses on this day.</p>
          ) : (
            <ul className="history-list">
              {pickedDoses.map((d) => {
                const shown = shownStatus(d, tz, today)
                return (
                  <li key={d.id} className="history-item">
                    <div>
                      <Link to={`/history/${d.medication_id}`}>{names.get(d.medication_id)}</Link>{' '}
                      <span>{timeLabel(d.scheduled_for, tz)}</span> <StatusIcon status={shown} />{' '}
                      <span className={`status-${shown}`}>{STATUS[shown].label}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}
    </>
  )
}

export default function History() {
  const { profile, error: profileError, retry: retryProfile } = useProfileState()
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE
  const [meds, setMeds] = useState<Medication[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<View>(readView)
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
      if (!row) setSaveError(STALE_DOSE)
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
  const pickView = (v: View) => {
    setView(v)
    writeView(v)
  }
  return (
    <main className="stack">
      {error && <p role="alert">{error}</p>}
      {!error && ordered.length === 0 && <Empty>No medications yet.</Empty>}
      {ordered.length > 0 && (
        <>
          <div className="row" role="group" aria-label="View">
            {(['week', 'month'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => pickView(v)}>
                {v === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          {view === 'month' ? (
            <MonthView meds={ordered} tz={tz} today={today} />
          ) : (
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
          )}
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
