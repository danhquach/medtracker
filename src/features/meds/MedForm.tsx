import { useEffect, useId, useRef, useState } from 'react'
import type { Medication, MedForm as MedFormKind, Schedule } from '../../lib/types'
import type { MedInput, ScheduleInput } from '../../data/meds'
import type { Suggestion } from '../autocomplete/sources'
import type { Product } from '../dinLookup/types'
import DinNpnField from './DinNpnField'
import NameAutocomplete from './NameAutocomplete'
import ScheduleEditor from './ScheduleEditor'
import { isStopped, stockUnit } from './summary'
import { toMedInput, toScheduleInput, validateMed, type FieldErrors, type ScheduleDraft } from './validate'
import { Button } from '../../components/Button'
import { NumberField, SelectField, TextField } from '../../components/Field'
import { Notice } from '../../components/layout'

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

/** A form filled from a DIN/NPN match, with the values as filled. */
type LabelFill = Pick<Product, 'number' | 'kind' | 'discontinued'> & {
  filled: { name: string; strength: string; form: string }
  /** The number was read from a label photo (MT-105). */
  viaScan: boolean
}

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
  manage,
}: {
  med?: Medication
  schedules?: Schedule[]
  meds: Medication[]
  remoteSuggestions: boolean
  today: string
  onSave: (med: MedInput, schedules: ScheduleInput[]) => Promise<void>
  onCancel: () => void
  /** Editing an existing med: pause, stop and delete it from here too. */
  manage?: { onPause: () => void; onStop: () => void; onDelete: () => void }
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
  const [din, setDin] = useState('')
  const [labelFill, setLabelFill] = useState<LabelFill | null>(null)
  const [checked, setChecked] = useState(false)
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
  // A filled form can't be saved until the user ticks that they checked it against the label.
  const needsTick = labelFill !== null && !checked
  /** A field still holding the value the match put there. */
  const fromLabel = (field: keyof LabelFill['filled'], v: string) => !!labelFill && v !== '' && v === labelFill.filled[field]
  const fromLabelProps = (field: keyof LabelFill['filled'], v: string) =>
    fromLabel(field, v) ? { className: 'from-label', hint: 'from label' } : {}

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

  // A new match overwrites name, strength and form even if hand-edited; safe because the tick resets.
  function fillFrom(p: Product, viaScan: boolean) {
    setName(p.name)
    setStrength(p.strength)
    setForm(p.form)
    setChips([])
    if (moreRef.current) moreRef.current.open = true
    setLabelFill({ number: p.number, kind: p.kind, discontinued: p.discontinued, filled: { name: p.name, strength: p.strength, form: p.form }, viaScan })
    setChecked(false)
  }

  // Any change to the number drops the fill: untouched label fields clear, the user's own edits stay.
  // So product A's details can't be saved under number B, and the banner never shows another number.
  function changeDin(digits: string) {
    setDin(digits)
    if (!labelFill || digits === labelFill.number) return
    if (fromLabel('name', name)) setName('')
    if (fromLabel('strength', strength)) setStrength('')
    if (fromLabel('form', form)) setForm('')
    setLabelFill(null)
    setChecked(false)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    // Holds for every way of submitting (Enter in a field too), not just the disabled button.
    if (needsTick) return
    setSaveError(null)
    setAttempt((n) => n + 1)
    if (Object.keys(validateMed(draft, drafts)).length > 0) return
    setSaving(true)
    // Untouched stock on edit is left out, so a refill or dose taken while the form was open isn't overwritten.
    const { stock: newStock, ...input } = toMedInput(draft)
    const stockChanged = !med || stock !== (med.stock?.toString() ?? '')
    try {
      await onSave(
        { ...input, ...(stockChanged ? { stock: newStock } : {}), ...(med ? { id: med.id } : {}) },
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
      {/* New meds only. */}
      {!med && <DinNpnField value={din} onChange={changeDin} onMatch={fillFrom} />}
      {!med && (
        <Notice tone="warning">
          {labelFill && (
            <>
              <strong className="label-fill-warn">⚠️ Check every detail against your label before saving.</strong>
              <span className="label-fill-from">
                Filled from {labelFill.kind} <span className="label-number">{labelFill.number}</span>
              </span>
              <ul className="label-fill-notes">
                <li>The number or the product details may be wrong or out of date.</li>
                {labelFill.discontinued && <li>This product is marked discontinued by Health Canada.</li>}
                {labelFill.viaScan && <li>The number was read by the camera, so compare the digits with the label too.</li>}
              </ul>
            </>
          )}
        </Notice>
      )}
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
        fromLabel={fromLabel('name', name)}
      />
      {chips.length > 0 && (
        <div className="row" role="group" aria-label="Strengths">
          {chips.map((c) => (
            <Button
              key={c}
              className="chip"
              aria-pressed={strength === c}
              onClick={() => {
                setStrength(c)
                if (moreRef.current) moreRef.current.open = true
              }}
            >
              {c}
            </Button>
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
      <Button onClick={() => setDrafts([...drafts, newSchedule()])}>
        Add schedule
      </Button>

      <details className="more" ref={moreRef} open={!!med || undefined}>
        <summary>More details</summary>
        <div className="stack">
          <TextField
            label="Strength"
            value={strength}
            onChange={(e) => setStrength(e.target.value)}
            placeholder="e.g. 200 mg"
            {...fromLabelProps('strength', strength)}
          />
          <SelectField label="Form" value={form} onChange={(e) => setForm(e.target.value)} {...fromLabelProps('form', form)}>
            <option value="">—</option>
            {FORMS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </SelectField>
          <TextField label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <NumberField
            label={`Amount per dose (${unit})`}
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            error={errors.units_per_dose}
          />
          <NumberField
            label={`Stock (${unit})`}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="Leave empty to not track"
            error={errors.stock}
          />
          <NumberField
            label="Refill threshold (days)"
            inputMode="numeric"
            step={undefined}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            error={errors.refill_threshold_days}
          />
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
        {labelFill && (
          <div className={needsTick ? 'label-check needs-tick' : 'label-check'}>
            <label>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                aria-describedby={needsTick ? id('tick-hint') : undefined}
              />
              <span>I've checked these details against the label.</span>
            </label>
            {needsTick && (
              <p id={id('tick-hint')} className="muted hint">
                Tick to confirm before saving
              </p>
            )}
          </div>
        )}
        <div className="row">
          <Button type="submit" variant="primary" disabled={saving || needsTick}>
            Save
          </Button>
          <Button onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      {med && manage && (
        <div className="row" role="group" aria-label="Manage medication">
          <Button onClick={manage.onPause}>
            {med.paused ? 'Resume' : 'Pause'}
          </Button>
          {schedules?.some((s) => s.kind !== 'prn') && !isStopped(schedules, today) && (
            <Button onClick={manage.onStop}>
              Stop…
            </Button>
          )}
          <Button variant="danger" onClick={manage.onDelete}>
            Delete…
          </Button>
        </div>
      )}
    </form>
  )
}
