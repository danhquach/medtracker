import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SNOOZE_MINUTES } from '../../data/doses'
import type { DoseEvent, DoseStatus, Medication, Profile } from '../../lib/types'
import { timeLabel } from './dayRange'
import { Button } from '../../components/Button'
import { Card } from '../../components/layout'

const medLabel = (med: Medication | undefined) =>
  med ? `${med.name}${med.strength ? ` ${med.strength}` : ''}` : 'Unknown medication'

/** Bold name, strength muted on its own line so a long ingredient list can't read as part of the name (MT-128). */
const MedName = ({ med }: { med: Medication | undefined }) => (
  <>
    <strong>{med?.name ?? 'Unknown medication'}</strong>
    {med?.strength && <> <span className="dose-strength">{med.strength}</span></>}
  </>
)

/** A dose on a day not generated yet: shown so the day isn't empty, nothing to mark. */
export function UpcomingRow({ med }: { med: Medication }) {
  return (
    <Card className="dose-row is-done">
      <Link className="dose-name" to={`/history/${med.id}`}>
        <MedName med={med} />
        <span className="status status-pending">Upcoming</span>
      </Link>
    </Card>
  )
}

export default function DoseRow({
  dose,
  med,
  tz,
  onSet,
  snooze,
}: {
  dose: DoseEvent
  med: Medication | undefined
  tz: string
  onSet: (status: DoseStatus) => void
  /** Absent: no Snooze (guest, or not a due pending dose). */
  snooze?: { now: number; online: boolean; preset: Profile['snooze_minutes']; onSnooze: (minutes: Profile['snooze_minutes']) => void }
}) {
  const label = medLabel(med)
  const [picking, setPicking] = useState(false)

  // Done for the day: stays in place, dimmed. Undo puts a wrong tap back to due.
  if (dose.status === 'taken' || dose.status === 'skipped') {
    const word = dose.status === 'taken' ? 'Taken' : 'Skipped'
    const at = dose.acted_at ? ` ${timeLabel(dose.acted_at, tz)}` : ''
    return (
      <Card className="dose-row is-done">
        <Link className="dose-name" to={`/history/${dose.medication_id}`}>
          <MedName med={med} />
          <span className={`status status-${dose.status}`}>
            {dose.status === 'taken' && <span aria-hidden="true">✓ </span>}
            {word}
            {at}
          </span>
        </Link>
        <Button variant="quiet" onClick={() => onSet('pending')} aria-label={`Undo ${word} ${label}`}>
          Undo
        </Button>
      </Card>
    )
  }

  const canSnooze = !!snooze && dose.status === 'pending' && Date.parse(dose.scheduled_for) <= snooze.now
  const snoozedUntil = snooze && dose.snoozed_until && Date.parse(dose.snoozed_until) > snooze.now ? dose.snoozed_until : null

  return (
    <Card className="dose-row is-due">
      <div className="dose-info">
        <Link className="dose-name" to={`/history/${dose.medication_id}`}>
          <MedName med={med} />
        </Link>
        {dose.status === 'missed' && <span className="status status-missed">Missed</span>}
        {dose.status === 'pending' && snoozedUntil && (
          <span className="status status-pending">Snoozed · reminds you at {timeLabel(snoozedUntil, tz)}</span>
        )}
      </div>
      {/* Quiet Skip at one edge, Taken at the other, so a thumb can't land on the wrong one. Snooze only opens a picker. */}
      <div className="dose-actions">
        <Button variant="quiet" onClick={() => onSet('skipped')} aria-label={`Skip ${label}`}>
          Skip
        </Button>
        {canSnooze && (
          <Button
            variant="quiet"
            disabled={!snooze.online}
            onClick={() => setPicking((p) => !p)}
            aria-expanded={picking}
            aria-label={snooze.online ? `Snooze ${label}` : `Snooze ${label} (needs a connection)`}
            title={snooze.online ? undefined : 'Needs a connection'}
          >
            Snooze
          </Button>
        )}
        <Button variant="primary" onClick={() => onSet('taken')} aria-label={`Taken ${label}`}>
          Taken
        </Button>
      </div>
      {canSnooze && picking && snooze.online && (
        <div
          className="snooze-picker"
          role="group"
          aria-label={`Snooze ${label} for`}
          onKeyDown={(e) => e.key === 'Escape' && setPicking(false)}
        >
          <span className="snooze-label" aria-hidden="true">
            Remind me again in
          </span>
          <div className="segmented">
            {SNOOZE_MINUTES.map((m) => (
              <Button
                key={m}
                className={m === snooze.preset ? 'is-preset' : undefined}
                autoFocus={m === snooze.preset}
                aria-label={`${m} minutes`}
                onClick={() => {
                  setPicking(false)
                  snooze.onSnooze(m)
                }}
              >
                {m} min
              </Button>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
