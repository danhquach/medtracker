import { useState } from 'react'
import type { Medication } from '../../lib/types'
import type { Suggestion } from '../autocomplete/sources'
import { useSuggestions } from '../autocomplete/useSuggestions'

export default function NameAutocomplete({
  value,
  onChange,
  onPick,
  meds,
  remoteEnabled,
}: {
  value: string
  onChange: (v: string) => void
  onPick: (s: Suggestion) => void
  meds: Medication[]
  remoteEnabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const { mine, ca, us } = useSuggestions(value, meds, remoteEnabled)

  const groups = [
    { title: 'Your meds', items: mine, state: 'done' as const },
    { title: 'Canada', ...ca },
    { title: 'United States', ...us },
  ].filter((g) => g.items.length > 0 || g.state === 'error' || g.state === 'loading')

  return (
    <div className="autocomplete">
      <label>
        Name
        <input
          value={value}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
        />
      </label>
      {open && groups.length > 0 && (
        <div className="suggestions">
          {groups.map((g) => (
            <section key={g.title}>
              <h4>{g.title}</h4>
              {g.state === 'error' && <p className="muted">unavailable</p>}
              {g.state === 'loading' && g.items.length === 0 && (
                <p className="muted" aria-label={`${g.title} loading`}>
                  …
                </p>
              )}
              <ul>
                {g.items.map((s) => (
                  <li key={s.name}>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(s)
                        setOpen(false)
                      }}
                    >
                      {s.name}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
