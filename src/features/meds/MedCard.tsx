import { useRef, useState } from 'react'
import { refillState } from '../../../supabase/functions/_shared/refill'
import type { Medication, Schedule } from '../../lib/types'
import { scheduleSummary, stockUnit } from './summary'

export default function MedCard({
  med,
  schedules,
  onEdit,
  onDelete,
  onPause,
  onLogDose,
  onRefill,
  onHistory,
  stopped,
  onStop,
}: {
  med: Medication
  schedules: Schedule[]
  onEdit: () => void
  onDelete: () => void
  onPause: (paused: boolean) => void
  onLogDose: () => void
  onRefill: (qty: number) => void
  onHistory: () => void
  /** Every recurring schedule has ended (see isStopped). */
  stopped: boolean
  onStop: () => void
}) {
  const [refilling, setRefilling] = useState(false)
  const [qty, setQty] = useState('')
  const menu = useRef<HTMLDetailsElement>(null)
  const low = refillState(med, schedules) === 'low'
  const qtyNum = Number(qty)
  // As-needed meds lead with Log dose; everything else leads with Edit.
  const logFirst = schedules.some((s) => s.kind === 'prn') && !med.paused
  const canStop = !stopped && schedules.some((s) => s.kind !== 'prn')
  const unit = stockUnit(med.form, 2)

  /** Run a menu item and close the menu. */
  const choose = (action: () => void) => () => {
    if (menu.current) menu.current.open = false
    action()
  }

  return (
    <li className={`med-card${med.paused ? ' is-paused' : ''}`}>
      <div>
        <strong>{med.name}</strong>
        {med.strength && <span className="muted"> {med.strength}</span>}
      </div>
      <div className="muted">{scheduleSummary(schedules)}</div>
      {(med.stock !== null || med.paused || stopped) && (
        <div>
          {med.stock !== null && (
            <span className={`chip${low ? ' chip-low' : ''}`}>
              {med.stock} {stockUnit(med.form, med.stock)} left
            </span>
          )}
          {med.paused && <span className="chip">Paused</span>}
          {stopped && <span className="chip">Stopped</span>}
        </div>
      )}
      <div className="row card-actions">
        {logFirst ? (
          <button type="button" onClick={onLogDose}>
            Log dose
          </button>
        ) : (
          <button type="button" onClick={onEdit}>
            Edit
          </button>
        )}
        <details className="menu" ref={menu}>
          <summary aria-label={`More actions for ${med.name}`}>More</summary>
          <div className="menu-items">
            {logFirst && (
              <button type="button" onClick={choose(onEdit)}>
                Edit
              </button>
            )}
            <button type="button" onClick={choose(() => onPause(!med.paused))}>
              {med.paused ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={choose(() => setRefilling(true))}>
              Refilled
            </button>
            <button type="button" onClick={choose(onHistory)}>
              History
            </button>
            {canStop && (
              <button type="button" onClick={choose(onStop)}>
                Stop…
              </button>
            )}
            <hr />
            <button type="button" className="danger" onClick={choose(onDelete)}>
              Delete…
            </button>
          </div>
        </details>
      </div>
      {refilling && (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!(qtyNum > 0)) return
            onRefill(qtyNum)
            setRefilling(false)
            setQty('')
          }}
        >
          <input
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            aria-label={`Quantity added (${unit})`}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <button type="submit" className="primary" disabled={!(qtyNum > 0)}>
            Add
          </button>
          <button type="button" onClick={() => setRefilling(false)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  )
}
