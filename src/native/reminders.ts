// Android app (Capacitor) dose reminders: scheduled on the phone as exact local notifications, so
// they fire on time offline and while idle. The web/PWA build never loads the plugin.
import { Capacitor } from '@capacitor/core'
import type { ActionPerformed } from '@capacitor/local-notifications'
import { listDoses, setDoseStatus, snoozeDose, SNOOZE_MINUTES } from '../data/doses'
import { listMeds, listSchedules } from '../data/meds'
import { sameTime } from '../data/offline/ops'
import { subscribe } from '../data/offline/sync'
import { getProfile } from '../data/profile'
import { addDays, localDayRange, todayIn } from '../features/today/dayRange'
import { planReminders } from './plan'

const CHANNEL = 'dose-reminders'
const ACTION_TYPE = 'dose'
const DAYS = 7
const ENABLED_KEY = 'medtracker-reminders-on'
const SNOOZES_KEY = 'medtracker-reminder-snoozes'

export const isNativeApp = (): boolean => Capacitor.isNativePlatform()

/** Window event after Taken/Snooze on a notification changed a dose, so open screens reload. */
export const REMINDER_ACTED = 'medtracker:reminder-acted'

// Resolves to the module, never the plugin itself: awaiting a Capacitor plugin proxy calls its
// `.then`, which Capacitor treats as a native method and rejects.
const plugin = () => import('@capacitor/local-notifications')

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: reminders still work for this run
  }
}

/** Snoozes made on this phone (reminder id -> until ms), past ones dropped. */
function liveSnoozes(now: number): Record<number, number> {
  const all = read<Record<number, number>>(SNOOZES_KEY, {})
  return Object.fromEntries(Object.entries(all).filter(([, until]) => until > now))
}

export const remindersEnabled = (): boolean => read(ENABLED_KEY, false)

export async function nativeDeviceState(): Promise<'on' | 'off' | 'denied'> {
  const { display } = await (await plugin()).LocalNotifications.checkPermissions()
  if (display === 'denied') return 'denied'
  return display === 'granted' && remindersEnabled() ? 'on' : 'off'
}

/** Asks for permission (first time only); on success turns reminders on and schedules them. */
export async function enableReminders(): Promise<'ok' | 'denied'> {
  const { display } = await (await plugin()).LocalNotifications.requestPermissions()
  if (display !== 'granted') return 'denied'
  await setRemindersEnabled(true)
  return 'ok'
}

export async function setRemindersEnabled(on: boolean): Promise<void> {
  write(ENABLED_KEY, on || null)
  if (on) await syncReminders()
  else await cancelAll()
}

/** Sign-out: nothing of this user's may fire on this phone afterwards. */
export async function forgetReminders(): Promise<void> {
  write(ENABLED_KEY, null)
  write(SNOOZES_KEY, null)
  await cancelAll()
}

async function cancelAll(): Promise<void> {
  const { LocalNotifications: ln } = await plugin()
  const { notifications } = await ln.getPending()
  if (notifications.length) await ln.cancel({ notifications: notifications.map(({ id }) => ({ id })) })
}

let queue: Promise<void> = Promise.resolve()

/** Replace the phone's scheduled reminders with the plan from current data. Runs one at a time. */
export function syncReminders(): Promise<void> {
  queue = queue.then(runSync, runSync)
  return queue
}

async function runSync(): Promise<void> {
  if (!isNativeApp() || !remindersEnabled()) return
  const { LocalNotifications: ln } = await plugin()
  if ((await ln.checkPermissions()).display !== 'granted') return
  const now = Date.now()
  let input
  try {
    const [meds, schedules, profile] = await Promise.all([listMeds(), listSchedules(), getProfile()])
    const tz = profile.time_zone
    const today = todayIn(tz, now)
    const doses = await listDoses(localDayRange(addDays(today, -1), tz).from, localDayRange(addDays(today, DAYS), tz).to)
    input = { meds, schedules, doses, timeZone: tz }
  } catch (e) {
    // Signed out, or no data yet: keep what is scheduled rather than wiping it.
    console.error('could not load data for reminders', e)
    return
  }
  const snoozes = liveSnoozes(now)
  const plan = planReminders({ ...input, nowMs: now, days: DAYS, snoozes })
  // A reminder already showing goes away once its dose is marked or snoozed (it rings again later).
  const { notifications: shown } = await ln.getDeliveredNotifications()
  const done = shown.filter((n) => {
    const { medId, scheduledFor } = (n.extra ?? {}) as { medId?: string; scheduledFor?: string }
    if (!medId || !scheduledFor) return false
    const row = input.doses.find((d) => d.medication_id === medId && sameTime(d.scheduled_for, scheduledFor))
    return (row && row.status !== 'pending') || plan.some((r) => r.id === n.id)
  })
  if (done.length) await ln.removeDeliveredNotifications({ notifications: done })
  await cancelAll()
  if (!plan.length) return
  await ln.schedule({
    notifications: plan.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      channelId: CHANNEL,
      actionTypeId: ACTION_TYPE,
      autoCancel: true,
      extra: { medId: r.medId, scheduledFor: r.scheduledFor },
      schedule: { at: new Date(r.at), allowWhileIdle: true },
    })),
  })
}

async function findDose(medId: string, scheduledFor: string) {
  const at = Date.parse(scheduledFor)
  const rows = await listDoses(new Date(at).toISOString(), new Date(at + 1).toISOString())
  return rows.find((d) => d.medication_id === medId && sameTime(d.scheduled_for, scheduledFor)) ?? null
}

async function onAction({ actionId, notification }: ActionPerformed): Promise<void> {
  const { medId, scheduledFor } = (notification.extra ?? {}) as { medId?: string; scheduledFor?: string }
  if (!medId || !scheduledFor || (actionId !== 'taken' && actionId !== 'snooze')) return
  try {
    const dose = await findDose(medId, scheduledFor)
    if (actionId === 'taken') {
      if (dose) await setDoseStatus(dose.id, 'taken')
    } else {
      let minutes: (typeof SNOOZE_MINUTES)[number] = 10
      try {
        minutes = (await getProfile()).snooze_minutes
      } catch {
        // offline with no cached profile: default snooze
      }
      // Kept on the phone first, so the snooze holds even when the server can't be told (offline).
      write(SNOOZES_KEY, { ...liveSnoozes(Date.now()), [notification.id]: Date.now() + minutes * 60_000 })
      if (dose) await snoozeDose(dose.id, minutes).catch((e: unknown) => console.error('server snooze failed', e))
    }
  } catch (e) {
    console.error('reminder action failed', e)
  }
  window.dispatchEvent(new Event(REMINDER_ACTED))
  await syncReminders()
}

let resyncTimer: ReturnType<typeof setTimeout> | undefined
/** Re-plan shortly; bursts of changes collapse into one run. */
export const resyncSoon = (): void => {
  clearTimeout(resyncTimer)
  resyncTimer = setTimeout(() => void syncReminders().catch((e: unknown) => console.error('reminder sync failed', e)), 1500)
}

/** Once per app start: channel, Taken/Snooze buttons, and re-planning on open, resume and data changes. */
export async function startReminders(): Promise<void> {
  if (!isNativeApp()) return
  const { LocalNotifications: ln } = await plugin()
  await ln.createChannel({
    id: CHANNEL,
    name: 'Dose reminders',
    description: 'Time to take a medication',
    importance: 5,
    visibility: 1,
    sound: 'dose_reminder.wav',
    vibration: true,
  })
  await ln.registerActionTypes({
    types: [{ id: ACTION_TYPE, actions: [{ id: 'taken', title: 'Taken' }, { id: 'snooze', title: 'Snooze' }] }],
  })
  await ln.addListener('localNotificationActionPerformed', (a) => void onAction(a))
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resyncSoon())
  subscribe(resyncSoon) // local edits (meds, doses, snoozes) and reconnects
  resyncSoon()
}

export async function showTestReminder(): Promise<void> {
  await (await plugin()).LocalNotifications.schedule({
    notifications: [
      { id: 1, title: 'Test', body: 'Notifications are working on this device.', channelId: CHANNEL, schedule: { at: new Date(Date.now() + 1000) } },
    ],
  })
}
