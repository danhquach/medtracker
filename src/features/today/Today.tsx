import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { avgDosesPerDay, daysLeft, refillState } from '../../../supabase/functions/_shared/refill'
import { listDoses, setDoseStatus } from '../../data/doses'
import { listMeds, listSchedules } from '../../data/meds'
import type { DoseEvent, DoseStatus, Medication, Schedule } from '../../lib/types'
import GuestBanner from '../auth/GuestBanner.tsx'
import { isGuest } from '../auth/auth'
import { useProfile } from '../auth/useProfile'
import { useSession } from '../auth/useSession'
import { closeDoseNotification, closeStaleNotifications } from '../../push/closeStale'
import { deviceLabel, enablePushOnThisDevice } from '../../push/subscribe'
import { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { localDayRange, timeLabel, todayIn } from './dayRange'
import DoseRow from './DoseRow'
import WeekStrip from './WeekStrip'

const isResolved = (d: DoseEvent) => d.status === 'taken' || d.status === 'skipped'

export default function Today() {
  const profile = useProfile()
  const { user } = useSession()
  const { state: notifications, refresh: refreshNotifications } = useDeviceNotificationState()
  const [enableError, setEnableError] = useState<string | null>(null)
  const tz = profile?.time_zone
  const today = useMemo(() => (tz ? todayIn(tz) : null), [tz])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked ?? today
  const [meds, setMeds] = useState<Medication[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const latest = useRef({ selected, tz })
  const requestId = useRef(0)
  useEffect(() => {
    latest.current = { selected, tz }
  })

  // Only the most recent request may write state.
  const load = useCallback((day: string, zone: string) => {
    const id = ++requestId.current
    const { from, to } = localDayRange(day, zone)
    Promise.all([listMeds(), listSchedules(), listDoses(from, to)]).then(
      ([m, s, d]) => {
        if (id !== requestId.current) return
        setMeds(m)
        setSchedules(s)
        setDoses(d)
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

  async function act(dose: DoseEvent, status: DoseStatus) {
    try {
      await setDoseStatus(dose.id, status)
      void closeDoseNotification(dose.id)
      const { selected: day, tz: zone } = latest.current
      if (day && zone) load(day, zone)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update dose')
    }
  }

  // Coming back to the app: refresh, then drop notifications for doses that are no longer pending
  // (e.g. marked Taken on another device). Pending set is independent of the selected day.
  useEffect(() => {
    async function onVisible() {
      if (document.visibilityState !== 'visible') return
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
  }, [load, refreshNotifications])

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
  const open = doses.filter((d) => !isResolved(d))
  const resolved = doses.filter(isResolved)
  const groups = new Map<string, DoseEvent[]>()
  for (const d of open) {
    const key = timeLabel(d.scheduled_for, tz!)
    groups.set(key, [...(groups.get(key) ?? []), d])
  }
  const lowMeds = meds.filter((m) => {
    const own = schedules.filter((s) => s.medication_id === m.id)
    return refillState(m, own) === 'low'
  })

  return (
    <main>
      <h2>Today</h2>
      <GuestBanner guest={isGuest(user)} />
      {notifications !== null && notifications !== 'on' && (
        <section className="banner" aria-label="Notifications">
          <p>Notifications are off on this device</p>
          {notifications === 'off' && (
            <button type="button" onClick={turnOn}>
              Turn on
            </button>
          )}
          {notifications === 'denied' && <p>Notifications are blocked. Enable them for this site in your browser settings.</p>}
          {enableError && <p role="alert">{enableError}</p>}
        </section>
      )}
      {lowMeds.map((m) => {
        const own = schedules.filter((s) => s.medication_id === m.id)
        const left = daysLeft(m.stock, m.units_per_dose, own.reduce((n, s) => n + avgDosesPerDay(s), 0))
        return (
          <p key={m.id} className="chip chip-low">
            {m.name}: running low{left !== null ? ` (about ${Math.max(0, Math.floor(left))} days left)` : ''}
          </p>
        )
      })}
      {today && selected && <WeekStrip today={today} selected={selected} onSelect={setPicked} />}
      {error && <p role="alert">{error}</p>}
      {profile && doses.length === 0 && !error && <p className="muted">Nothing scheduled for this day.</p>}
      {[...groups].map(([time, rows]) => (
        <section key={time}>
          <h3>{time}</h3>
          <ul className="dose-list">
            {rows.map((d) => (
              <DoseRow key={d.id} dose={d} med={medById.get(d.medication_id)} onSet={(s) => act(d, s)} />
            ))}
          </ul>
        </section>
      ))}
      {resolved.length > 0 && (
        <details className="resolved">
          <summary>Resolved ({resolved.length})</summary>
          <ul className="dose-list">
            {resolved.map((d) => (
              <DoseRow key={d.id} dose={d} med={medById.get(d.medication_id)} onSet={(s) => act(d, s)} />
            ))}
          </ul>
        </details>
      )}
    </main>
  )
}
