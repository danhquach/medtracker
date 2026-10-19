import { useState } from 'react'
import { refillState } from '../../../supabase/functions/_shared/refill'
import type { Medication, Schedule } from '../../lib/types'
import { scheduleSummary } from './summary'

export default function MedCard({
  med,
  schedules,
  onEdit,
  onDelete,
  onPause,
  onLogDose,
  onRefill,
}: {
  med: Medication
  schedules: Schedule[]
  onEdit: () => void
  onDelete: () => void
  onPause: (paused: boolean) => void
  onLogDose: () => void
  onRefill: (qty: number) => void
}) {
  const [refilling, setRefilling] = useState(false)
  const [qty, setQty] = useState('')
  const low = refillState(med, schedules) === 'low'
  const qtyNum = Number(qty)
  const isPrn = schedules.some((s) => s.kind === 'prn')

  return (
    <li className={`med-card${med.paused ? ' is-paused' : ''}`}>
      <div>
        <strong>{med.name}</strong>
        {med.strength && <span className="muted"> {med.strength}</span>}
      </div>
      <div className="muted">{scheduleSummary(schedules)}</div>
      {med.stock !== null && (
        <span className={`chip${low ? ' chip-low' : ''}`}>
          {med.stock} {med.stock === 1 ? 'pill' : 'pills'} left
        </span>
      )}
      {med.paused && <span className="chip">Paused</span>}
      <div className="row">
        <button type="button" aria-pressed={med.paused} onClick={() => onPause(!med.paused)}>
          {med.paused ? 'Resume' : 'Pause'}
        </button>
        {isPrn && !med.paused && (
          <button type="button" onClick={onLogDose}>
            Log dose
          </button>
        )}
        <button type="button" onClick={() => setRefilling(true)}>
          Refilled
        </button>
        <button type="button" onClick={onEdit}>
          Edit
        </button>
        <button type="button" onClick={onDelete}>
          Delete
        </button>
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
          <input type="number" inputMode="decimal" step="any" min={0} aria-label="Quantity added" value={qty} onChange={(e) => setQty(e.target.value)} />
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
