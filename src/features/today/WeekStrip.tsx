import { weekAround } from './dayRange'

const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' })
const fullName = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
const at = (date: string) => new Date(`${date}T12:00:00Z`)

export default function WeekStrip({
  today,
  selected,
  onSelect,
}: {
  today: string
  selected: string
  onSelect: (date: string) => void
}) {
  return (
    <div className="week-strip" role="group" aria-label="Week">
      {weekAround(today).map((d) => (
        <button
          key={d}
          className={d === today ? 'day is-today' : 'day'}
          aria-pressed={d === selected}
          aria-label={fullName.format(at(d))}
          onClick={() => onSelect(d)}
        >
          <span>{dayName.format(at(d))}</span>
          <strong>{Number(d.slice(8))}</strong>
        </button>
      ))}
    </div>
  )
}
