import { useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { Empty, Loading } from '../../components/states'
import { listDoses, setDoseStatus, STALE_DOSE } from '../../data/doses'
import { listMeds } from '../../data/meds'
import { DEFAULT_TIME_ZONE } from '../../data/profile'
import type { DoseEvent, DoseStatus, Medication } from '../../lib/types'
import LoadError from '../auth/LoadError'
import { useProfileState } from '../auth/useProfile'
import { addDays, localDayRange, todayIn } from '../today/dayRange'
import { Button } from '../../components/Button'
import { Notice } from '../../components/layout'
import MedHistory from './MedHistory'
import MonthView from './MonthView'
import { Legend } from './StatusIcon'
import WeekView from './WeekView'

type View = 'week' | 'month'
const VIEW_KEY = 'historyView'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'month' ? 'month' : 'week'
  } catch {
    return 'week'
  }
}

function writeView(view: View): void {
  try {
    localStorage.setItem(VIEW_KEY, view)
  } catch {
    // storage unavailable: the week view comes back next time
  }
}

export default function History() {
  const { profile, error: profileError, retry: retryProfile } = useProfileState()
  const tz = profile?.time_zone ?? DEFAULT_TIME_ZONE
  const [meds, setMeds] = useState<Medication[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [view, setView] = useState<View>(readView)
  const { medId: selected } = useParams()

  const hasProfile = !!profile
  const today = todayIn(tz)
  useEffect(() => {
    if (!hasProfile) return
    let alive = true
    Promise.all([listMeds(), listDoses(localDayRange(addDays(today, -29), tz).from, localDayRange(today, tz).to)]).then(
      ([m, d]) => {
        if (!alive) return
        setMeds(m)
        setDoses(d)
        setLoaded(true)
      },
      (e: unknown) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : 'Could not load history')
        setLoaded(true)
      },
    )
    return () => {
      alive = false
    }
  }, [hasProfile, tz, today])

  // Active meds first; paused ones keep their past doses, marked as paused.
  const ordered = useMemo(() => [...meds].sort((a, b) => Number(a.paused) - Number(b.paused)), [meds])

  const change = async (dose: DoseEvent, status: DoseStatus) => {
    setBusy(dose.id)
    setSaveError(null)
    try {
      const row = await setDoseStatus(dose.id, status)
      setDoses((ds) => (row ? ds.map((d) => (d.id === row.id ? row : d)) : ds.filter((d) => d.id !== dose.id)))
      if (!row) setSaveError(STALE_DOSE)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save that change')
    } finally {
      setBusy(null)
    }
  }

  if (profileError && !profile)
    return (
      <main>
        <LoadError message={profileError} onRetry={retryProfile} />
      </main>
    )
  if (!loaded)
    return (
      <main>
        <Loading />
      </main>
    )

  const detail = meds.find((m) => m.id === selected)
  if (selected && !detail) return <Navigate to="/history" replace />
  if (detail)
    return (
      <MedHistory
        med={detail}
        doses={doses}
        tz={tz}
        today={today}
        saveError={saveError}
        busy={busy}
        onChange={(dose, status) => void change(dose, status)}
      />
    )

  const pickView = (v: View) => {
    setView(v)
    writeView(v)
  }
  return (
    <main className="stack">
      {error && <Notice tone="error">{error}</Notice>}
      {!error && ordered.length === 0 && <Empty>No medications yet.</Empty>}
      {ordered.length > 0 && (
        <>
          <div className="row" role="group" aria-label="View">
            {(['week', 'month'] as const).map((v) => (
              <Button key={v} aria-pressed={view === v} onClick={() => pickView(v)}>
                {v === 'week' ? 'Week' : 'Month'}
              </Button>
            ))}
          </div>
          {view === 'month' ? (
            <MonthView meds={ordered} tz={tz} today={today} />
          ) : (
            <WeekView meds={ordered} doses={doses} tz={tz} today={today} />
          )}
          <Legend />
        </>
      )}
    </main>
  )
}
