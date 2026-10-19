import { useState } from 'react'
import type { Medication, MedForm as MedFormKind, Schedule } from '../../lib/types'
import type { MedInput, ScheduleInput } from '../../data/meds'
import type { Suggestion } from '../autocomplete/sources'
import NameAutocomplete from './NameAutocomplete'
import ScheduleEditor from './ScheduleEditor'
import { toMedInput, toScheduleInput, validateMed, type ScheduleDraft } from './validate'

const FORMS: MedFormKind[] = ['tablet', 'capsule', 'liquid', 'other']

const hhmm = (t: string) => t.slice(0, 5)
const draftOf = (s: Schedule): ScheduleDraft => ({
  kind: s.kind,
  times: (s.times ?? []).map(hhmm),
  weekdays: s.weekdays ?? [],
  interval_days: s.interval_days?.toString() ?? '',
  start_date: s.start_date ?? '',
  end_date: s.end_date ?? '',
})
const newSchedule = (): ScheduleDraft => ({
  kind: 'daily',
  times: ['09:00'],
  weekdays: [],
  interval_days: '',
  start_date: '',
  end_date: '',
})

export default function MedForm({
  med,
  schedules,
  meds,
  remoteSuggestions,
  today,
  onSave,
  onCancel,
}: {
  med?: Medication
  schedules?: Schedule[]
  meds: Medication[]
  remoteSuggestions: boolean
  today: string
  onSave: (med: MedInput, schedules: ScheduleInput[]) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(med?.name ?? '')
  const [strength, setStrength] = useState(med?.strength ?? '')
  const [form, setForm] = useState<string>(med?.form ?? '')
  const [notes, setNotes] = useState(med?.notes ?? '')
  const [units, setUnits] = useState((med?.units_per_dose ?? 1).toString())
  const [stock, setStock] = useState(med?.stock?.toString() ?? '')
  const [threshold, setThreshold] = useState((med?.refill_threshold_days ?? 7).toString())
  const [notify, setNotify] = useState(med?.notify ?? true)
  const [drafts, setDrafts] = useState<ScheduleDraft[]>(schedules && schedules.length > 0 ? schedules.map(draftOf) : [newSchedule()])
  const [chips, setChips] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function pick(s: Suggestion) {
    setName(s.name)
    setChips(s.strengths ?? [])
    if (s.form && (FORMS as string[]).includes(s.form)) setForm(s.form)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const draft = { name, strength, form, notes, notify, units_per_dose: units, stock, refill_threshold_days: threshold }
    const found = validateMed(draft, drafts)
    setErrors(found)
    if (found.length > 0) return
    setSaving(true)
    try {
      await onSave(
        { ...toMedInput(draft), ...(med ? { id: med.id } : {}) },
        drafts.map(toScheduleInput),
      )
    } catch (err) {
      setErrors([err instanceof Error ? err.message : 'Could not save medication'])
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <h3>{med ? 'Edit medication' : 'Add medication'}</h3>
      <NameAutocomplete
        value={name}
        onChange={(v) => {
          setName(v)
          setChips([])
        }}
        onPick={pick}
        meds={meds}
        remoteEnabled={remoteSuggestions}
      />
      <label>
        Strength
        <input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 200 mg" />
      </label>
      {chips.length > 0 && (
        <div className="row" aria-label="Strengths">
          {chips.map((c) => (
            <button key={c} type="button" className="chip" onClick={() => setStrength(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      <label>
        Form
        <select value={form} onChange={(e) => setForm(e.target.value)}>
          <option value="">—</option>
          {FORMS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      <label>
        Notes
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label>
        Units per dose
        <input type="number" inputMode="decimal" step="any" value={units} onChange={(e) => setUnits(e.target.value)} />
      </label>
      <label>
        Stock
        <input type="number" inputMode="decimal" step="any" value={stock} onChange={(e) => setStock(e.target.value)} placeholder="Leave empty to not track" />
      </label>
      <label>
        Refill threshold (days)
        <input type="number" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} style={{ display: 'inline', width: 'auto' }} /> Remind me
      </label>

      {drafts.map((d, i) => (
        <ScheduleEditor
          key={i}
          value={d}
          today={today}
          onChange={(s) => setDrafts(drafts.map((x, j) => (j === i ? s : x)))}
          onRemove={drafts.length > 1 ? () => setDrafts(drafts.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      <button type="button" onClick={() => setDrafts([...drafts, newSchedule()])}>
        Add schedule
      </button>

      {errors.length > 0 && (
        <div role="alert">
          {errors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}
      <div className="row">
        <button type="submit" className="primary" disabled={saving}>
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
