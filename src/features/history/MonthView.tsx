import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading } from '../../components/states'
import { listDoses } from '../../data/doses'
import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import { addDays, localDayRange, timeLabel } from '../today/dayRange'
import { Button } from '../../components/Button'
import { Notice, Row, RowGroup } from '../../components/layout'
import StatusIcon from './StatusIcon'
import { dayHeading, dayOf, fmt, LEGEND, shownStatus, STATUS } from './status'

/** 'YYYY-MM' n months from `month`. */
function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}

export default function MonthView({ meds, tz, today }: { meds: Medication[]; tz: string; today: string }) {
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
        <Button aria-label="Previous month" onClick={() => go(-1)}>
          ‹
        </Button>
        <h2 id="month-title">{title}</h2>
        <Button aria-label="Next month" disabled={month >= current} onClick={() => go(1)}>
          ›
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
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
                      <Button
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
                      </Button>
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
            <RowGroup as="ul" className="history-list">
              {pickedDoses.map((d) => {
                const shown = shownStatus(d, tz, today)
                return (
                  <Row
                    key={d.id}
                    as="li"
                    name={
                      <>
                        <Link to={`/history/${d.medication_id}`}>{names.get(d.medication_id)}</Link>{' '}
                        <span>{timeLabel(d.scheduled_for, tz)}</span> <StatusIcon status={shown} />{' '}
                        <span className={`status-${shown}`}>{STATUS[shown].label}</span>
                      </>
                    }
                  />
                )
              })}
            </RowGroup>
          )}
        </section>
      )}
    </>
  )
}
