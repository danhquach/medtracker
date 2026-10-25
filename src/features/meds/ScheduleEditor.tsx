import type { Schedule } from '../../lib/types'
import { FieldError } from './FieldError'
import { invalidProps, type FieldErrors, type ScheduleDraft } from './validate'
import { Button } from '../../components/Button'

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
      <label>
        How often
        <select value={value.kind} onChange={(e) => setKind(e.target.value as Schedule['kind'])}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

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
        <>
          <label>
            Every (days)
            <input
              type="number"
              inputMode="numeric"
              min={2}
              value={value.interval_days}
              onChange={(e) => set({ interval_days: e.target.value })}
              {...invalidProps(errors.interval_days, id('interval_days'))}
            />
          </label>
          <FieldError id={id('interval_days')} message={errors.interval_days} />
        </>
      )}

      {timed &&
        value.times.map((t, i) => (
          <div className="row" key={i}>
            <input
              type="time"
              aria-label={`Time ${i + 1}`}
              value={t}
              onChange={(e) => set({ times: value.times.map((x, j) => (j === i ? e.target.value : x)) })}
              {...invalidProps(errors.times, id('times'))}
            />
            {value.times.length > 1 && (
              <Button aria-label={`Remove time ${i + 1}`} onClick={() => set({ times: value.times.filter((_, j) => j !== i) })}>
                ✕
              </Button>
            )}
          </div>
        ))}
      {timed && <FieldError id={id('times')} message={errors.times} />}
      {timed && (
        <Button onClick={() => set({ times: [...value.times, ''] })}>
          Add time
        </Button>
      )}

      <details open={value.kind === 'interval' || !!value.end_date || undefined}>
        <summary>Start and end dates</summary>
        <div className="stack">
          <label>
            Start date
            <input
              type="date"
              value={value.start_date}
              onChange={(e) => set({ start_date: e.target.value })}
              {...invalidProps(errors.start_date, id('start_date'))}
            />
          </label>
          <FieldError id={id('start_date')} message={errors.start_date} />
          <label>
            End date
            <input
              type="date"
              value={value.end_date}
              onChange={(e) => set({ end_date: e.target.value })}
              {...invalidProps(errors.end_date, id('end_date'))}
            />
          </label>
          <FieldError id={id('end_date')} message={errors.end_date} />
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
