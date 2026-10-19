import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Empty, Loading } from '../../components/states'
import { avgDosesPerDay, daysLeft, refillState } from '../../../supabase/functions/_shared/refill'
import { listDoses, setDoseStatus, STALE_DOSE } from '../../data/doses'
import { listMeds, listSchedules } from '../../data/meds'
import type { DoseEvent, DoseStatus, Medication, Schedule } from '../../lib/types'
import { isGuest } from '../auth/auth'
import LoadError from '../auth/LoadError'
import { useProfileState } from '../auth/useProfile'
import { useSession } from '../auth/useSession'
import { closeDoseNotification, closeStaleNotifications } from '../../push/closeStale'
import { deviceLabel, enablePushOnThisDevice } from '../../push/subscribe'
import { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { dayParam, localDayRange, timeLabel, todayIn } from './dayRange'
import DoseRow from './DoseRow'
import NeedsAttention from './NeedsAttention'
import WeekStrip from './WeekStrip'

export default function Today() {
  const { profile, error: profileError, retry: retryProfile } = useProfileState()
  const { user } = useSession()
  const { state: notifications, refresh: refreshNotifications } = useDeviceNotificationState()
  const [enableError, setEnableError] = useState<string | null>(null)
  const tz = profile?.time_zone
  const [clock, setClock] = useState(() => Date.now())
  const today = useMemo(() => (tz ? todayIn(tz, clock) : null), [tz, clock])
  // A day other than today lives in the URL so the header can title it.
  const [params, setParams] = useSearchParams()
  const picked = dayParam(params.get('date'))
  const selected = picked ?? today
  const [meds, setMeds] = useState<Medication[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const latest = useRef({ selected, tz, today })
  const requestId = useRef(0)
  useEffect(() => {
    latest.current = { selected, tz, today }
  })

  const pick = useCallback(
    (day: string) => setParams(day === latest.current.today ? {} : { date: day }, { replace: true }),
    [setParams],
  )

  // A picked day that has become today (midnight passed) drops back to the plain, following view.
  useEffect(() => {
    if (picked && picked === today) setParams({}, { replace: true })
  }, [picked, today, setParams])

  // The app can stay open across midnight: re-read the clock; the plain today view follows.
  const rollover = useCallback(() => setClock(Date.now()), [])

  useEffect(() => {
    if (!tz) return
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const now = Date.now()
      const untilMidnight = Date.parse(localDayRange(todayIn(tz, now), tz).to) - now
      timer = setTimeout(() => {
        rollover()
        schedule()
      }, untilMidnight + 100)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [tz, rollover])

  // Only the most recent request may write state.
  const load = useCallback((day: string, zone: string) => {
    const id = ++requestId.current
    const { from, to } = localDayRange(day, zone)
    return Promise.all([listMeds(), listSchedules(), listDoses(from, to)]).then(
      ([m, s, d]) => {
        if (id !== requestId.current) return
        setMeds(m)
        setSchedules(s)
        setDoses(d)
        setLoaded(true)
        setError(null)
      },
      (e: unknown) => {
        if (id === requestId.current) setError(e instanceof Error ? e.message : 'Could not load doses')
      },
    )
  }, [])

  useEffect(() => {
    if (tz && selected) load(selected, tz)
  }, [tz, selected, load])

  // Applies on screen right away; the reload afterwards confirms it (or reverts it on failure).
  const act = useCallback(
    async (dose: DoseEvent, status: DoseStatus) => {
      requestId.current++ // an older in-flight load must not undo the change
      const actedAt = new Date().toISOString()
      setDoses((ds) => ds.map((d) => (d.id === dose.id ? { ...d, status, acted_at: actedAt } : d)))
      let failed: string | null = null
      try {
        if (!(await setDoseStatus(dose.id, status))) failed = STALE_DOSE
        else if (status !== 'pending') void closeDoseNotification(dose.id) // an undone dose is due again
      } catch (e) {
        failed = e instanceof Error ? e.message : 'Could not update dose'
      }
      const { selected: day, tz: zone } = latest.current
      if (day && zone) await load(day, zone)
      if (failed) setError(failed) // after the reload, which clears errors

    },
    [load],
  )

  // Coming back to the app: refresh, then drop notifications for doses that are no longer pending
  // (e.g. marked Taken on another device). Pending set is independent of the selected day.
  useEffect(() => {
    async function onVisible() {
      if (document.visibilityState !== 'visible') return
      rollover()
      const { selected: day, tz: zone } = latest.current
      if (day && zone) load(day, zone)
      refreshNotifications()
      try {
        const now = Date.now()
        const recent = await listDoses(new Date(now - 48 * 3_600_000).toISOString(), new Date(now + 24 * 3_600_000).toISOString())
        await closeStaleNotifications(new Set(recent.filter((d) => d.status === 'pending').map((d) => d.id)))
      } catch {
        // best-effort; stale notifications are harmless
      }
    }
    void onVisible() // cold open counts as becoming visible
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load, refreshNotifications, rollover])

  async function turnOn() {
    setEnableError(null)
    try {
      await enablePushOnThisDevice(deviceLabel())
    } catch (e) {
      setEnableError(e instanceof Error ? e.message : 'Could not turn on notifications')
    }
    refreshNotifications()
  }

  const medById = new Map(meds.map((m) => [m.id, m]))
  const groups = new Map<string, DoseEvent[]>()
  for (const d of doses) {
    const key = timeLabel(d.scheduled_for, tz!)
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  const taken = doses.filter((d) => d.status === 'taken').length
  const low = meds.flatMap((m) => {
    const own = schedules.filter((s) => s.medication_id === m.id)
    if (refillState(m, own) !== 'low') return []
    const left = daysLeft(m.stock, m.units_per_dose, own.reduce((n, s) => n + avgDosesPerDay(s), 0))
    return [{ id: m.id, name: m.name, daysLeft: left }]
  })

  return (
    <main>
      {today && selected && <WeekStrip today={today} selected={selected} onSelect={pick} />}
      {profileError && !profile && <LoadError message={profileError} onRetry={retryProfile} />}
      {error && <p role="alert">{error}</p>}
      {profile && !loaded && !error && <Loading />}
      {profile && loaded && doses.length === 0 && !error && (
        <Empty action={meds.length === 0 && <Link to="/meds/new">Add a med</Link>}>Nothing scheduled for this day.</Empty>
      )}
      {doses.length > 0 && (
        <p className="progress" aria-live="polite">
          {taken} of {doses.length} taken
        </p>
      )}
      {[...groups].map(([time, rows]) => (
        <section key={time}>
          <h3>{time}</h3>
          <ul className="dose-list">
            {rows.map((d) => (
              <DoseRow key={d.id} dose={d} med={medById.get(d.medication_id)} tz={tz!} onSet={(s) => act(d, s)} />
            ))}
          </ul>
        </section>
      ))}
      <NeedsAttention
        guest={isGuest(user)}
        notifications={notifications}
        enableError={enableError}
        onTurnOn={turnOn}
        low={low}
      />
    </main>
  )
}
