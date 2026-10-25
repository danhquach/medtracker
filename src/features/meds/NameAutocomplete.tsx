import { useId, useState } from 'react'
import type { Medication } from '../../lib/types'
import type { Suggestion } from '../autocomplete/sources'
import { useSuggestions } from '../autocomplete/useSuggestions'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'

export default function NameAutocomplete({
  value,
  onChange,
  onPick,
  meds,
  remoteEnabled,
  error,
  fromLabel,
}: {
  value: string
  onChange: (v: string) => void
  onPick: (s: Suggestion) => void
  meds: Medication[]
  remoteEnabled: boolean
  error?: string
  /** The name still holds the value a DIN/NPN match filled in. */
  fromLabel?: boolean
}) {
  const [open, setOpen] = useState(false)
  // Only text the user typed is searched; stored or picked names are never sent anywhere.
  const [typed, setTyped] = useState('')
  const { mine, ca, us } = useSuggestions(typed, meds, remoteEnabled)
  const listId = useId()

  const groups = [
    { title: 'Your meds', items: mine, state: 'done' as const },
    { title: 'Canada', ...ca },
    { title: 'United States', ...us },
  ].filter((g) => g.items.length > 0 || g.state === 'error' || g.state === 'loading')
  const showing = open && groups.length > 0

  return (
    <div
      className="autocomplete"
      // Leaving the field (and its list) closes the list.
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && showing) {
          e.preventDefault()
          setOpen(false)
        }
      }}
    >
      <TextField
        label="Name"
        value={value}
        autoComplete="off"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        onChange={(e) => {
          onChange(e.target.value)
          setTyped(e.target.value)
          setOpen(true)
        }}
        error={error}
        className={fromLabel ? 'from-label' : undefined}
        hint={fromLabel ? 'from label' : undefined}
      />
      {showing && (
        <div className="suggestions" id={listId}>
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
                    <Button
                      // Safari doesn't focus a clicked button, so keep focus in the field until the click lands.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onPick(s)
                        setTyped('')
                        setOpen(false)
                      }}
                    >
                      {s.name}
                    </Button>
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
