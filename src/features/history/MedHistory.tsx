import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import { timeLabel } from '../today/dayRange'
import { Button } from '../../components/Button'
import { Chip, Notice, Row, RowGroup } from '../../components/layout'
import StatusIcon from './StatusIcon'
import { dayHeading, dayOf, shownStatus, STATUS } from './status'

// What the user can set a dose to. "Not taken" goes back to pending; on a past day that reads as Missed.
const CHOICES: { status: DoseStatus; label: string }[] = [
  { status: 'taken', label: 'Taken' },
  { status: 'skipped', label: 'Skipped' },
  { status: 'pending', label: 'Not taken' },
]

/** One med's last 30 days, newest first, where each dose can be corrected. */
export default function MedHistory({
  med,
  doses,
  tz,
  today,
  saveError,
  busy,
  onChange,
}: {
  med: Medication
  doses: DoseEvent[]
  tz: string
  today: string
  saveError: string | null
  /** The dose being saved, if any. */
  busy: string | null
  onChange: (dose: DoseEvent, status: DoseStatus) => void
}) {
  const list = doses
    .filter((d) => d.medication_id === med.id)
    .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for))
  return (
    <main className="stack">
      <h2>
        {med.name} — last 30 days
        {med.paused && <Chip inline>Paused</Chip>}
      </h2>
      {saveError && <Notice tone="error">{saveError}</Notice>}
      {list.length === 0 ? (
        <p className="muted">No doses in the last 30 days.</p>
      ) : (
        <RowGroup as="ul" className="history-list">
          {list.map((d) => {
            const shown = shownStatus(d, tz, today)
            const when = `${dayHeading(dayOf(d.scheduled_for, tz))} ${timeLabel(d.scheduled_for, tz)}`
            return (
              <Row
                key={d.id}
                as="li"
                wide
                name={
                  <>
                    <span>{when}</span> <StatusIcon status={shown} />{' '}
                    <span className={`status-${shown}`}>{STATUS[shown].label}</span>
                  </>
                }
              >
                <div className="row" role="group" aria-label={`Change dose ${when}`}>
                  {CHOICES.map((c) => (
                    <Button
                      key={c.status}
                      aria-pressed={c.status === 'pending' ? shown === 'pending' || shown === 'missed' : shown === c.status}
                      disabled={busy === d.id}
                      onClick={() => onChange(d, c.status)}
                    >
                      {c.label}
                    </Button>
                  ))}
                </div>
              </Row>
            )
          })}
        </RowGroup>
      )}
    </main>
  )
}
