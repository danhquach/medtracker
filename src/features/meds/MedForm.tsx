import { useEffect, useId, useRef, useState } from 'react'
import type { Medication, MedForm as MedFormKind, Schedule } from '../../lib/types'
import type { MedInput, ScheduleInput } from '../../data/meds'
import type { Suggestion } from '../autocomplete/sources'
import { FieldError } from './FieldError'
import NameAutocomplete from './NameAutocomplete'
import ScheduleEditor from './ScheduleEditor'
import { stockUnit } from './summary'
import { invalidProps, toMedInput, toScheduleInput, validateMed, type FieldErrors, type ScheduleDraft } from './validate'

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

/** This schedule's errors with the `<index>.` prefix stripped. */
const scheduleErrors = (errors: FieldErrors, i: number): FieldErrors =>
  Object.fromEntries(
    Object.entries(errors)
      .filter(([k]) => k.startsWith(`${i}.`))
      .map(([k, v]) => [k.slice(`${i}.`.length), v]),
  )

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
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const moreRef = useRef<HTMLDetailsElement>(null)
  const uid = useId()
  const id = (field: string) => `${uid}-${field}`
  const unit = stockUnit((FORMS as string[]).includes(form) ? (form as MedFormKind) : null, 2)
  const draft = { name, strength, form, notes, notify, units_per_dose: units, stock, refill_threshold_days: threshold }
  // Errors show from the first Save on and update as the user fixes them.
  const errors: FieldErrors = attempt > 0 ? validateMed(draft, drafts) : {}

  // After a failed Save: reveal every invalid field (open its collapsed sections) and focus the first.
  useEffect(() => {
    if (attempt === 0) return
    const invalid = [...(formRef.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? [])]
    for (const el of invalid) {
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) d.open = true
    }
    invalid[0]?.focus()
  }, [attempt])

  function pick(s: Suggestion) {
    setName(s.name)
    setChips(s.strengths ?? [])
    if (s.form && (FORMS as string[]).includes(s.form)) setForm(s.form)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaveError(null)
    setAttempt((n) => n + 1)
    if (Object.keys(validateMed(draft, drafts)).length > 0) return
    setSaving(true)
    try {
      await onSave(
        { ...toMedInput(draft), ...(med ? { id: med.id } : {}) },
        drafts.map(toScheduleInput),
      )
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save medication')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="stack med-form" onSubmit={submit} noValidate ref={formRef}>
      <NameAutocomplete
        value={name}
        onChange={(v) => {
          setName(v)
          setChips([])
        }}
        onPick={pick}
        meds={meds}
        remoteEnabled={remoteSuggestions}
        error={errors.name}
      />
      {chips.length > 0 && (
        <div className="row" role="group" aria-label="Strengths">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              className="chip"
              aria-pressed={strength === c}
              onClick={() => {
                setStrength(c)
                if (moreRef.current) moreRef.current.open = true
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {drafts.map((d, i) => (
        <ScheduleEditor
          key={i}
          value={d}
          today={today}
          errors={scheduleErrors(errors, i)}
          idPrefix={id(`s${i}`)}
          onChange={(s) => setDrafts(drafts.map((x, j) => (j === i ? s : x)))}
          onRemove={drafts.length > 1 ? () => setDrafts(drafts.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      <button type="button" onClick={() => setDrafts([...drafts, newSchedule()])}>
        Add schedule
      </button>

      <details className="more" ref={moreRef} open={!!med || undefined}>
        <summary>More details</summary>
        <div className="stack">
          <label>
            Strength
            <input value={strength} onChange={(e) => setStrength(e.target.value)} placeholder="e.g. 200 mg" />
          </label>
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
            Amount per dose ({unit})
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              {...invalidProps(errors.units_per_dose, id('units'))}
            />
          </label>
          <FieldError id={id('units')} message={errors.units_per_dose} />
          <label>
            Stock ({unit})
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              placeholder="Leave empty to not track"
              {...invalidProps(errors.stock, id('stock'))}
            />
          </label>
          <FieldError id={id('stock')} message={errors.stock} />
          <label>
            Refill threshold (days)
            <input
              type="number"
              inputMode="numeric"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              {...invalidProps(errors.refill_threshold_days, id('threshold'))}
            />
          </label>
          <FieldError id={id('threshold')} message={errors.refill_threshold_days} />
          <label>
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} style={{ display: 'inline', width: 'auto' }} /> Remind me
          </label>
        </div>
      </details>

      <div className="form-actions">
        {saveError && (
          <p role="alert" className="field-error">
            {saveError}
          </p>
        )}
        <div className="row">
          <button type="submit" className="primary" disabled={saving}>
            Save
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  )
}
