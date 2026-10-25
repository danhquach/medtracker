import type { Schedule } from '../../lib/types'
import { invalidProps, type FieldErrors, type ScheduleDraft } from './validate'
import { Button } from '../../components/Button'
import { DateField, FieldError, NumberField, SelectField, TimeField } from '../../components/Field'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KINDS: { value: Schedule['kind']; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Specific days' },
  { value: 'interval', label: 'Every N days' },
  { value: 'prn', label: 'As needed' },
]

export default function ScheduleEditor({
  value,
  onChange,
  today,
  onRemove,
  errors,
  idPrefix,
}: {
  value: ScheduleDraft
  onChange: (s: ScheduleDraft) => void
  today: string
  onRemove?: () => void
  /** This schedule's errors, keyed without the index (`times`, `end_date`, …). */
  errors: FieldErrors
  idPrefix: string
}) {
  const set = (p: Partial<ScheduleDraft>) => onChange({ ...value, ...p })
  const timed = value.kind !== 'prn'
  const id = (field: string) => `${idPrefix}-${field}`

  function setKind(kind: Schedule['kind']) {
    set({
      kind,
      times: kind !== 'prn' && value.times.length === 0 ? ['09:00'] : value.times,
      start_date: kind === 'interval' && !value.start_date ? today : value.start_date,
    })
  }

  return (
    <fieldset className="stack">
      <legend>Schedule</legend>
      <SelectField label="How often" value={value.kind} onChange={(e) => setKind(e.target.value as Schedule['kind'])}>
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>
            {k.label}
          </option>
        ))}
      </SelectField>

      {value.kind === 'weekdays' && (
        <>
          <div className="row" role="group" aria-label="Days" {...invalidProps(errors.weekdays, id('weekdays'))}>
            {DAYS.map((d, i) => {
              const iso = i + 1
              const on = value.weekdays.includes(iso)
              return (
                <Button
                  key={d}
                  aria-pressed={on}
                  onClick={() => set({ weekdays: on ? value.weekdays.filter((x) => x !== iso) : [...value.weekdays, iso] })}
                >
                  {d}
                </Button>
              )
            })}
          </div>
          <FieldError id={id('weekdays')} message={errors.weekdays} />
        </>
      )}

      {value.kind === 'interval' && (
        <NumberField
          label="Every (days)"
          inputMode="numeric"
          step={undefined}
          min={2}
          value={value.interval_days}
          onChange={(e) => set({ interval_days: e.target.value })}
          error={errors.interval_days}
        />
      )}

      {timed &&
        value.times.map((t, i) => (
          <div className="row time-row" key={i}>
            <TimeField
              label={`Time ${i + 1}`}
              value={t}
              onChange={(e) => set({ times: value.times.map((x, j) => (j === i ? e.target.value : x)) })}
              // One message for the whole list, under the last time.
              error={i === value.times.length - 1 ? errors.times : undefined}
            />
            {value.times.length > 1 && (
              <Button aria-label={`Remove time ${i + 1}`} onClick={() => set({ times: value.times.filter((_, j) => j !== i) })}>
                ✕
              </Button>
            )}
          </div>
        ))}
      {timed && (
        <Button onClick={() => set({ times: [...value.times, ''] })}>
          Add time
        </Button>
      )}

      <details open={value.kind === 'interval' || !!value.end_date || undefined}>
        <summary>Start and end dates</summary>
        <div className="stack">
          <DateField
            label="Start date"
            value={value.start_date}
            onChange={(e) => set({ start_date: e.target.value })}
            error={errors.start_date}
          />
          <DateField label="End date" value={value.end_date} onChange={(e) => set({ end_date: e.target.value })} error={errors.end_date} />
        </div>
      </details>
      {onRemove && (
        <Button onClick={onRemove}>
          Remove schedule
        </Button>
      )}
    </fieldset>
  )
}
