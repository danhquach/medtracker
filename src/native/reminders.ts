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
import { planReminders, reminderId } from './plan'

const CHANNEL = 'dose-reminders'
const ACTION_TYPE = 'dose'
const DAYS = 7
const ENABLED_KEY = 'medtracker-reminders-on'
const SNOOZES_KEY = 'medtracker-reminder-snoozes'
const ACTIONS_KEY = 'medtracker-reminder-actions'
const RUNG_KEY = 'medtracker-reminder-rung'

// The plugin check, not just "native": the live-site app runs new web code on whatever APK is
// installed, and one without the plugin falls back to the web path instead of crashing.
export const isNativeApp = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LocalNotifications')

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

/** Reminders this phone set (reminder id -> time), kept a day so their repeats survive a re-plan. */
function liveRung(now: number): Record<number, number> {
  const all = read<Record<number, number>>(RUNG_KEY, {})
  return Object.fromEntries(Object.entries(all).filter(([, at]) => at > now - 86_400_000))
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
  if (!on) write(RUNG_KEY, null) // cancelled before they rang: no repeats when turned back on
  // Queued, so a sync already loading data can't re-schedule after this cancel.
  await (on ? syncReminders() : enqueue(cancelAll))
}

/** Sign-out: nothing of this user's may fire or stay on screen on this phone afterwards. */
export async function forgetReminders(): Promise<void> {
  write(ENABLED_KEY, null) // a sync in flight checks this before it schedules
  const clear = async () => {
    write(SNOOZES_KEY, null)
    write(ACTIONS_KEY, null)
    write(RUNG_KEY, null)
    await cancelAll()
    await (await plugin()).LocalNotifications.removeAllDeliveredNotifications()
  }
  await clear() // now, even if a sync is stuck on the network
  void enqueue(clear).catch((e: unknown) => console.error('could not clear reminders', e)) // and after it, which may write its state back
}

async function cancelAll(): Promise<void> {
  const { LocalNotifications: ln } = await plugin()
  const { notifications } = await ln.getPending()
  if (notifications.length) await ln.cancel({ notifications: notifications.map(({ id }) => ({ id })) })
}

let queue: Promise<void> = Promise.resolve()

/** Every change to scheduled reminders runs one at a time, in call order. */
function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task)
  return queue
}

/** Replace the phone's scheduled reminders with the plan from current data. */
export function syncReminders(): Promise<void> {
  return enqueue(runSync)
}

async function runSync(): Promise<void> {
  if (!isNativeApp() || !remindersEnabled()) return
  const { LocalNotifications: ln } = await plugin()
  if ((await ln.checkPermissions()).display !== 'granted') return
  await sendSavedActions()
  const now = Date.now()
  let input
  try {
    const [meds, schedules, profile] = await Promise.all([listMeds(), listSchedules(), getProfile()])
    const tz = profile.time_zone
    const today = todayIn(tz, now)
    const doses = await listDoses(localDayRange(addDays(today, -1), tz).from, localDayRange(addDays(today, DAYS), tz).to)
    input = { meds, schedules, doses, timeZone: tz, repeatMinutes: profile.snooze_minutes }
  } catch (e) {
    // Signed out, or no data yet: keep what is scheduled rather than wiping it.
    console.error('could not load data for reminders', e)
    return
  }
  const snoozes = liveSnoozes(now)
  const rung = liveRung(now)
  const plan = planReminders({ ...input, nowMs: now, days: DAYS, snoozes, rung })
  // A reminder already showing goes away once its dose is marked or snoozed (it rings again later).
  const { notifications: shown } = await ln.getDeliveredNotifications()
  const done = shown.filter((n) => {
    const { medId, scheduledFor } = (n.extra ?? {}) as { medId?: string; scheduledFor?: string }
    if (!medId || !scheduledFor) return false
    const row = input.doses.find((d) => d.medication_id === medId && sameTime(d.scheduled_for, scheduledFor))
    return (row && row.status !== 'pending') || plan.some((r) => r.id === n.id)
  })
  if (done.length) await ln.removeDeliveredNotifications({ notifications: done })
  if (!remindersEnabled()) return // turned off or signed out while the data loaded
  // Schedule first (same id replaces), then cancel the rest: a failed schedule keeps the old plan.
  const { notifications: before } = await ln.getPending()
  if (plan.length) {
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
  for (const r of plan) if (r.repeat === 0) rung[r.id] = r.at
  write(RUNG_KEY, rung)
  const keep = new Set(plan.map((r) => r.id))
  const stale = before.filter((n) => !keep.has(n.id))
  if (stale.length) await ln.cancel({ notifications: stale.map(({ id }) => ({ id })) })
}

async function findDose(medId: string, scheduledFor: string) {
  const at = Date.parse(scheduledFor)
  const rows = await listDoses(new Date(at).toISOString(), new Date(at + 1).toISOString())
  return rows.find((d) => d.medication_id === medId && sameTime(d.scheduled_for, scheduledFor)) ?? null
}

type SavedAction = { action: 'taken' | 'snooze'; medId: string; scheduledFor: string; minutes: (typeof SNOOZE_MINUTES)[number]; at: number }
const ACTION_TTL_MS = 2 * 86_400_000

/**
 * Sends Taken/Snooze taps kept on the phone. One that can't be sent yet (offline, the app just
 * started, no dose row yet) stays for the next sync; a snooze that already ended is dropped.
 */
async function sendSavedActions(): Promise<void> {
  const now = Date.now()
  const left: SavedAction[] = []
  for (const a of read<SavedAction[]>(ACTIONS_KEY, [])) {
    if (now - a.at > ACTION_TTL_MS || (a.action === 'snooze' && now > a.at + a.minutes * 60_000)) continue
    try {
      const dose = await findDose(a.medId, a.scheduledFor)
      if (!dose) left.push(a)
      else if (a.action === 'taken') await setDoseStatus(dose.id, 'taken')
      else if (dose.status === 'pending') await snoozeDose(dose.id, a.minutes)
    } catch (e) {
      console.error('could not send reminder action', e)
      left.push(a)
    }
  }
  write(ACTIONS_KEY, left.length ? left : null)
}

/** A tap is kept on the phone first (in the queue, so no sync overwrites it), then sent by the sync. */
function onAction({ actionId, notification }: ActionPerformed): Promise<void> {
  const { medId, scheduledFor } = (notification.extra ?? {}) as { medId?: string; scheduledFor?: string }
  if (!medId || !scheduledFor || (actionId !== 'taken' && actionId !== 'snooze')) return Promise.resolve()
  return enqueue(async () => {
    const now = Date.now()
    const snoozes = liveSnoozes(now)
    const id = reminderId(medId, scheduledFor) // the dose's, also when tapped on one of its repeats
    let minutes: (typeof SNOOZE_MINUTES)[number] = 10
    if (actionId === 'snooze') {
      minutes = await getProfile().then((p) => p.snooze_minutes, () => minutes) // offline, nothing cached: default
      snoozes[id] = now + minutes * 60_000 // rings again even if the server can't be told
    } else delete snoozes[id]
    write(SNOOZES_KEY, snoozes)
    write(ACTIONS_KEY, [...read<SavedAction[]>(ACTIONS_KEY, []), { action: actionId, medId, scheduledFor, minutes, at: now }])
  })
    .then(syncReminders)
    .catch((e: unknown) => console.error('reminder action failed', e))
    .finally(() => window.dispatchEvent(new Event(REMINDER_ACTED)))
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
  // Off but alarms still set: after switching to the live-site APK, the old build's alarms stay
  // armed while this origin starts with reminders off. Clear them so turning on doesn't double up.
  if (!remindersEnabled()) await enqueue(cancelAll)
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
