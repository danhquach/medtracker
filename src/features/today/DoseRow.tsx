import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'

export default function DoseRow({
  dose,
  med,
  onSet,
}: {
  dose: DoseEvent
  med: Medication | undefined
  onSet: (status: DoseStatus) => void
}) {
  const label = med ? `${med.name}${med.strength ? ` ${med.strength}` : ''}` : 'Unknown medication'
  return (
    <li className="dose-row">
      <div>
        <strong>{label}</strong>
        {dose.status !== 'pending' && <span className={`status status-${dose.status}`}>{dose.status}</span>}
      </div>
      <div className="row">
        <button aria-pressed={dose.status === 'taken'} onClick={() => onSet('taken')} aria-label={`Taken ${label}`}>
          Taken
        </button>
        <button aria-pressed={dose.status === 'skipped'} onClick={() => onSet('skipped')} aria-label={`Skip ${label}`}>
          Skip
        </button>
      </div>
    </li>
  )
}
