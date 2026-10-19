import { useCallback, useEffect, useMemo, useState } from 'react'
import { avgDosesPerDay, daysLeft, refillState } from '../../../supabase/functions/_shared/refill'
import { listDoses, setDoseStatus } from '../../data/doses'
import { listMeds, listSchedules } from '../../data/meds'
import type { DoseEvent, DoseStatus, Medication, Schedule } from '../../lib/types'
import GuestBanner from '../auth/GuestBanner.tsx'
import { isGuest } from '../auth/auth'
import { useProfile } from '../auth/useProfile'
import { useSession } from '../auth/useSession'
import { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { localDayRange, timeLabel, todayIn } from './dayRange'
import DoseRow from './DoseRow'
import WeekStrip from './WeekStrip'

const isResolved = (d: DoseEvent) => d.status === 'taken' || d.status === 'skipped'

export default function Today() {
  const profile = useProfile()
  const { user } = useSession()
  const notifications = useDeviceNotificationState()
  const tz = profile?.time_zone
  const today = useMemo(() => (tz ? todayIn(tz) : null), [tz])
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked ?? today
  const [meds, setMeds] = useState<Medication[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [doses, setDoses] = useState<DoseEvent[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!tz || !selected) return
    try {
      const { from, to } = localDayRange(selected, tz)
      const [m, s, d] = await Promise.all([listMeds(), listSchedules(), listDoses(from, to)])
      setMeds(m)
      setSchedules(s)
      setDoses(d)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load doses')
    }
  }, [tz, selected])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function act(dose: DoseEvent, status: DoseStatus) {
    try {
      await setDoseStatus(dose.id, status)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update dose')
    }
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
      {notifications !== 'on' && (
        <section className="banner" aria-label="Notifications">
          <p>Notifications are off on this device</p>
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
