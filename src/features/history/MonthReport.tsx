import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Button } from '../../components/Button'
import { Empty } from '../../components/states'
import { Notice } from '../../components/layout'
import { canShareFile, shareFile } from '../../native/shareFile'
import type { DoseEvent, Medication } from '../../lib/types'
import { dayHeading, fmt } from './status'
import { type Counts, monthReport, reportText, reportTitle, takenPct } from './report'

const COLS = ['Scheduled', 'Taken', 'Skipped', 'Missed'] as const

function Cells({ c }: { c: Counts }) {
  const pct = takenPct(c)
  return (
    <>
      <td>{c.scheduled}</td>
      <td>{c.taken}</td>
      <td>{c.skipped}</td>
      <td>{c.missed}</td>
      <td>{pct === null ? '–' : `${pct}%`}</td>
    </>
  )
}

/** Totals for the month shown in the calendar, built on the device from its doses (MT-162). */
export default function MonthReport(props: {
  doses: DoseEvent[]
  meds: Medication[]
  month: string
  tz: string
  today: string
}) {
  const [error, setError] = useState<string | null>(null)
  const r = monthReport(props.doses, props.meds, props.month, props.tz, props.today)
  if (!r)
    return (
      <section aria-labelledby="report-title" className="stack month-report">
        <h3 id="report-title">Monthly report</h3>
        <Empty>No doses recorded in {fmt(`${props.month}-01`, { month: 'long', year: 'numeric' })}.</Empty>
      </section>
    )

  const title = reportTitle(r)
  const canNativeShare = canShareFile()
  const canWebShare = !canNativeShare && typeof navigator !== 'undefined' && typeof navigator.share === 'function'
  const share = async () => {
    setError(null)
    const text = reportText(r)
    try {
      if (canNativeShare) return await shareFile(`medtracker-report-${r.month}.txt`, text)
      await navigator.share({ title: `MedTracker dose report: ${title}`, text })
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return // share sheet closed
      setError(e instanceof Error ? e.message : 'Could not share the report')
    }
  }

  return (
    <section aria-labelledby="report-title" className="stack month-report">
      <h3 id="report-title">{r.through ? 'Month-to-date report' : 'Monthly report'}</h3>
      <p className="muted">
        {title}
        {r.through && `, through ${dayHeading(r.through)}`}
        {r.total.pending > 0 && `. ${r.total.pending} pending today, not counted in Taken %.`}
      </p>
      <div className="report-scroll">
        <table className="report-table" aria-labelledby="report-title">
          <thead>
            <tr>
              <th scope="col">Med</th>
              {COLS.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
              <th scope="col">Taken %</th>
            </tr>
          </thead>
          <tbody>
            <tr className="report-total">
              <th scope="row">All meds</th>
              <Cells c={r.total} />
            </tr>
            {r.perMed.map(({ med, counts }) => (
              <tr key={med.id}>
                <th scope="row">
                  {med.name}
                  {med.paused && <span className="muted"> (paused)</span>}
                </th>
                <Cells c={counts} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="row report-actions">
        {(canNativeShare || canWebShare) && <Button onClick={() => void share()}>Share report</Button>}
        {!Capacitor.isNativePlatform() && <Button onClick={() => window.print()}>Print report</Button>}
      </div>
    </section>
  )
}
