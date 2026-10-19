import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useMatch, useNavigate, useParams } from 'react-router-dom'
import { Empty, Loading } from '../../components/states'
import { logPrnDose } from '../../data/doses'
import { addStock, deleteMed, listMeds, listSchedules, saveMed, setPaused, type MedInput, type ScheduleInput } from '../../data/meds'
import { DEFAULT_TIME_ZONE } from '../../data/profile'
import type { Medication, Schedule } from '../../lib/types'
import { useGoBack } from '../../lib/useGoBack'
import LoadError from '../auth/LoadError'
import { useProfile } from '../auth/useProfile'
import { nowTimeIn, todayIn } from '../today/dayRange'
import MedCard from './MedCard'
import MedForm from './MedForm'
import { nextDoseText } from './summary'

export default function MedsList() {
  const profile = useProfile()
  const [meds, setMeds] = useState<Medication[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Confirmation after a save, e.g. "Added. Next dose today 9:00 AM".
  const [notice, setNotice] = useState<string | null>(null)
  // The form is a route (/meds/new, /meds/:id/edit) so the phone's Back button closes it.
  const isNew = useMatch('/meds/new') !== null
  const { id: editId } = useParams()
  const navigate = useNavigate()
  const closeForm = useGoBack('/meds')
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE

  const load = useCallback(async () => {
    try {
      const [m, s] = await Promise.all([listMeds(), listSchedules()])
      setMeds(m)
      setSchedules(s)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load medications')
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void load())
  }, [load])

  async function run(action: () => Promise<unknown>, fallback: string) {
    try {
      setError(null)
      setNotice(null)
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : fallback)
    }
  }

  async function save(med: MedInput, scheds: ScheduleInput[]) {
    await saveMed(med, scheds)
    const paused = !!med.id && meds.some((m) => m.id === med.id && m.paused)
    const next = paused ? null : nextDoseText(scheds, todayIn(tz), nowTimeIn(tz))
    setNotice(`${med.id ? 'Saved.' : 'Added.'}${next ? ` Next dose ${next}` : ''}`)
    setError(null)
    await load()
    closeForm()
  }

  const sorted = useMemo(
    () => [...meds].sort((a, b) => Number(a.paused) - Number(b.paused) || a.name.localeCompare(b.name)),
    [meds],
  )

  if (!loaded)
    return (
      <main>
        <Loading />
      </main>
    )
  if (loadError && meds.length === 0)
    return (
      <main>
        <LoadError message={loadError} onRetry={() => void load()} />
      </main>
    )

  if (isNew || editId) {
    const med = editId ? meds.find((m) => m.id === editId) : undefined
    if (editId && !med) return <Navigate to="/meds" replace />
    return (
      <main>
        <MedForm
          med={med}
          schedules={med ? schedules.filter((s) => s.medication_id === med.id) : undefined}
          meds={meds}
          remoteSuggestions={profile?.suggestions_enabled ?? true}
          today={todayIn(tz)}
          onSave={save}
          onCancel={closeForm}
        />
      </main>
    )
  }

  return (
    <main className="has-fab">
      {(error ?? loadError) && <p role="alert">{error ?? loadError}</p>}
      <p role="status" className="notice">
        {notice}
      </p>
      {meds.length === 0 && <Empty>No medications yet. Tap + Add to create one.</Empty>}
      <ul className="dose-list">
        {sorted.map((m) => (
          <MedCard
            key={m.id}
            med={m}
            schedules={schedules.filter((s) => s.medication_id === m.id)}
            onEdit={() => navigate(`/meds/${m.id}/edit`)}
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
      <button type="button" className="primary fab" onClick={() => navigate('/meds/new')}>
        + Add
      </button>
    </main>
  )
}
