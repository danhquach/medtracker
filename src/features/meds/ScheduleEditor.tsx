import type { Schedule } from '../../lib/types'
import type { ScheduleDraft } from './validate'

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
}: {
  value: ScheduleDraft
  onChange: (s: ScheduleDraft) => void
  today: string
  onRemove?: () => void
}) {
  const set = (p: Partial<ScheduleDraft>) => onChange({ ...value, ...p })
  const timed = value.kind !== 'prn'

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
        Repeat
        <select value={value.kind} onChange={(e) => setKind(e.target.value as Schedule['kind'])}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>

      {value.kind === 'weekdays' && (
        <div className="row" role="group" aria-label="Days">
          {DAYS.map((d, i) => {
            const iso = i + 1
            const on = value.weekdays.includes(iso)
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => set({ weekdays: on ? value.weekdays.filter((x) => x !== iso) : [...value.weekdays, iso] })}
              >
                {d}
              </button>
            )
          })}
        </div>
      )}

      {value.kind === 'interval' && (
        <label>
          Every (days)
          <input type="number" inputMode="numeric" min={2} value={value.interval_days} onChange={(e) => set({ interval_days: e.target.value })} />
        </label>
      )}

      {timed &&
        value.times.map((t, i) => (
          <div className="row" key={i}>
            <input
              type="time"
              aria-label={`Time ${i + 1}`}
              value={t}
              onChange={(e) => set({ times: value.times.map((x, j) => (j === i ? e.target.value : x)) })}
            />
            {value.times.length > 1 && (
              <button type="button" aria-label={`Remove time ${i + 1}`} onClick={() => set({ times: value.times.filter((_, j) => j !== i) })}>
                ✕
              </button>
            )}
          </div>
        ))}
      {timed && (
        <button type="button" onClick={() => set({ times: [...value.times, ''] })}>
          Add time
        </button>
      )}

      <label>
        Start date
        <input type="date" value={value.start_date} onChange={(e) => set({ start_date: e.target.value })} />
      </label>
      <label>
        End date
        <input type="date" value={value.end_date} onChange={(e) => set({ end_date: e.target.value })} />
      </label>
      {onRemove && (
        <button type="button" onClick={onRemove}>
          Remove schedule
        </button>
      )}
    </fieldset>
  )
}
