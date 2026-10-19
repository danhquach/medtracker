import { useCallback, useEffect, useMemo, useState } from 'react'
import { logPrnDose } from '../../data/doses'
import { addStock, deleteMed, listMeds, listSchedules, saveMed, setPaused, type MedInput, type ScheduleInput } from '../../data/meds'
import { DEFAULT_TIME_ZONE } from '../../data/profile'
import type { Medication, Schedule } from '../../lib/types'
import { useProfile } from '../auth/useProfile'
import { todayIn } from '../today/dayRange'
import MedCard from './MedCard'
import MedForm from './MedForm'

export default function MedsList() {
  const profile = useProfile()
  const [meds, setMeds] = useState<Medication[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Medication | 'new' | null>(null)

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([listMeds(), listSchedules()])
      setMeds(m)
      setSchedules(s)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load medications')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  async function run(action: () => Promise<unknown>, fallback: string) {
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
    }
  }

  async function save(med: MedInput, scheds: ScheduleInput[]) {
    await saveMed(med, scheds)
    setEditing(null)
    await load()
  }

  const sorted = useMemo(
    () => [...meds].sort((a, b) => Number(a.paused) - Number(b.paused) || a.name.localeCompare(b.name)),
    [meds],
  )
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE

  if (editing) {
    const med = editing === 'new' ? undefined : editing
    return (
      <main>
        <MedForm
          med={med}
          schedules={med ? schedules.filter((s) => s.medication_id === med.id) : undefined}
          meds={meds}
          remoteSuggestions={profile?.suggestions_enabled ?? true}
          today={todayIn(tz)}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      </main>
    )
  }

  return (
    <main>
      <h2>Meds</h2>
      {error && <p role="alert">{error}</p>}
      {loaded && meds.length === 0 && !error && <p className="muted">No medications yet. Tap + Add to create one.</p>}
      <ul className="dose-list">
        {sorted.map((m) => (
          <MedCard
            key={m.id}
            med={m}
            schedules={schedules.filter((s) => s.medication_id === m.id)}
            onEdit={() => setEditing(m)}
            onDelete={() => {
              if (window.confirm(`Delete ${m.name}? This also removes its schedule and dose history.`)) {
                void run(() => deleteMed(m.id), 'Could not delete medication')
              }
            }}
            onPause={(p) => void run(() => setPaused(m.id, p), 'Could not update medication')}
            onLogDose={() => void run(() => logPrnDose(m.id), 'Could not log dose')}
            onRefill={(qty) => void run(() => addStock(m.id, qty), 'Could not update stock')}
          />
        ))}
      </ul>
      <button type="button" className="primary fab" onClick={() => setEditing('new')}>
        + Add
      </button>
    </main>
  )
}
