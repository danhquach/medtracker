import { Link } from 'react-router-dom'
import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import { timeLabel } from './dayRange'

export default function DoseRow({
  dose,
  med,
  tz,
  onSet,
}: {
  dose: DoseEvent
  med: Medication | undefined
  tz: string
  onSet: (status: DoseStatus) => void
}) {
  const label = med ? `${med.name}${med.strength ? ` ${med.strength}` : ''}` : 'Unknown medication'

  // Done for the day: stays in place, dimmed. Undo puts a wrong tap back to due.
  if (dose.status === 'taken' || dose.status === 'skipped') {
    const word = dose.status === 'taken' ? 'Taken' : 'Skipped'
    const at = dose.acted_at ? ` ${timeLabel(dose.acted_at, tz)}` : ''
    return (
      <li className="dose-row is-done">
        <Link className="dose-name" to={`/history/${dose.medication_id}`}>
          <strong>{label}</strong>
          <span className={`status status-${dose.status}`}>
            {dose.status === 'taken' && <span aria-hidden="true">✓ </span>}
            {word}
            {at}
          </span>
        </Link>
        <button className="quiet" onClick={() => onSet('pending')} aria-label={`Undo ${word} ${label}`}>
          Undo
        </button>
      </li>
    )
  }

  return (
    <li className="dose-row">
      <div>
        <Link className="dose-name" to={`/history/${dose.medication_id}`}>
          <strong>{label}</strong>
        </Link>
        {dose.status === 'missed' && <span className="status status-missed">Missed</span>}
      </div>
      {/* Wide gap and a quiet Skip so a thumb can't land on the wrong one. */}
      <div className="dose-actions">
        <button className="quiet" onClick={() => onSet('skipped')} aria-label={`Skip ${label}`}>
          Skip
        </button>
        <button className="primary" onClick={() => onSet('taken')} aria-label={`Taken ${label}`}>
          Taken
        </button>
      </div>
    </li>
  )
}
