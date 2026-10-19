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

  // Done for the day: stays in place, dimmed; corrections happen in the med's History.
  if (dose.status === 'taken' || dose.status === 'skipped') {
    const word = dose.status === 'taken' ? 'Taken' : 'Skipped'
    const at = dose.acted_at ? ` ${timeLabel(dose.acted_at, tz)}` : ''
    return (
      <li>
        <Link className="dose-row is-done" to={`/history/${dose.medication_id}`}>
          <strong>{label}</strong>
          <span className={`status status-${dose.status}`}>
            {dose.status === 'taken' && <span aria-hidden="true">✓ </span>}
            {word}
            {at}
          </span>
        </Link>
      </li>
    )
  }

  return (
    <li className="dose-row">
      <div>
        <strong>{label}</strong>
        {dose.status === 'missed' && <span className="status status-missed">Missed</span>}
      </div>
      <div className="row">
        <button className="primary" onClick={() => onSet('taken')} aria-label={`Taken ${label}`}>
          Taken
        </button>
        <button onClick={() => onSet('skipped')} aria-label={`Skip ${label}`}>
          Skip
        </button>
      </div>
    </li>
  )
}
