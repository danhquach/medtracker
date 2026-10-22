import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DoseEvent, Medication, Profile, Schedule } from '../lib/types'

const h = vi.hoisted(() => {
  const pending: { id: number }[] = []
  let actionListener: ((a: unknown) => void) | undefined
  const ln = {
    checkPermissions: vi.fn(async () => ({ display: 'granted' })),
    requestPermissions: vi.fn(async () => ({ display: 'granted' })),
    getPending: vi.fn(async () => ({ notifications: [...pending] })),
    schedule: vi.fn(async ({ notifications }: { notifications: { id: number; schedule?: { at: Date } }[] }) => {
      for (const n of notifications) if (!pending.some((p) => p.id === n.id)) pending.push({ id: n.id })
      return { notifications }
    }),
    cancel: vi.fn(async ({ notifications }: { notifications: { id: number }[] }) => {
      for (const n of notifications) pending.splice(pending.findIndex((p) => p.id === n.id), 1)
    }),
    getDeliveredNotifications: vi.fn(async () => ({ notifications: [] })),
    removeDeliveredNotifications: vi.fn(async () => {}),
    removeAllDeliveredNotifications: vi.fn(async () => {}),
    createChannel: vi.fn(async () => {}),
    registerActionTypes: vi.fn(async () => {}),
    addListener: vi.fn(async (_: string, fn: (a: unknown) => void) => {
      actionListener = fn
      return { remove: async () => {} }
    }),
  }
  return { ln, pending, act: (a: unknown) => actionListener?.(a) }
})

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: h.ln }))
vi.mock('../data/meds', () => ({ listMeds: vi.fn(), listSchedules: vi.fn() }))
vi.mock('../data/profile', () => ({ getProfile: vi.fn() }))
vi.mock('../data/offline/sync', () => ({ subscribe: vi.fn() }))
vi.mock('../data/doses', () => ({ listDoses: vi.fn(), setDoseStatus: vi.fn(), snoozeDose: vi.fn(), SNOOZE_MINUTES: [5, 10, 15, 30, 60] }))

const meds = await import('../data/meds')
const profile = await import('../data/profile')
const doses = await import('../data/doses')
const r = await import('./reminders')
const { reminderId } = await import('./plan')

const NOW = Date.parse('2026-10-20T14:00:00Z') // Tue 10:00 Toronto
const med: Medication = {
  id: 'm1', user_id: 'u1', name: 'A', strength: null, form: null, notes: null, units_per_dose: 1, stock: null,
  refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null, created_at: '', updated_at: '',
}
const sched: Schedule = {
  id: 's1', user_id: 'u1', medication_id: 'm1', kind: 'daily', times: ['20:00:00'], weekdays: null, interval_days: null,
  start_date: null, end_date: null,
}
const prof = { time_zone: 'America/Toronto', snooze_minutes: 5 } as Profile
const DUE = '2026-10-21T00:00:00.000Z' // tonight 20:00
const row = (over: Partial<DoseEvent> = {}): DoseEvent => ({
  id: 'd1', user_id: 'u1', medication_id: 'm1', scheduled_for: DUE, status: 'pending', acted_at: null, notified_at: null,
  snoozed_until: null, ...over,
})
/** Taps a notification button, then waits for the queued save and sync to finish. */
const tap = async (actionId: string) => {
  h.act({ actionId, notification: { id: reminderId('m1', DUE), title: '', body: '', extra: { medId: 'm1', scheduledFor: DUE } } })
  await r.syncReminders()
}
const until = async (cond: () => boolean) => {
  for (let i = 0; i < 50 && !cond(); i++) await new Promise((res) => setTimeout(res, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
  localStorage.clear()
  h.pending.length = 0
  localStorage.setItem('medtracker-reminders-on', 'true')
  vi.mocked(meds.listMeds).mockResolvedValue([med])
  vi.mocked(meds.listSchedules).mockResolvedValue([sched])
  vi.mocked(profile.getProfile).mockResolvedValue(prof)
  vi.mocked(doses.listDoses).mockResolvedValue([])
})

describe('syncReminders', () => {
  it('schedules the planned doses on the dose channel with the Taken/Snooze buttons', async () => {
    await r.syncReminders()
    expect(h.ln.schedule).toHaveBeenCalledTimes(1)
    const [n] = h.ln.schedule.mock.calls[0][0].notifications as Record<string, unknown>[]
    expect(n).toMatchObject({ channelId: 'dose-reminders', actionTypeId: 'dose', extra: { medId: 'm1', scheduledFor: DUE } })
    expect(h.pending).toHaveLength(7)
  })

  it('does nothing without notification permission', async () => {
    h.ln.checkPermissions.mockResolvedValueOnce({ display: 'denied' })
    await r.syncReminders()
    expect(h.ln.schedule).not.toHaveBeenCalled()
  })

  it('a failed schedule keeps the reminders already set', async () => {
    h.pending.push({ id: 1 }, { id: 2 })
    h.ln.schedule.mockRejectedValueOnce(new Error('plugin'))
    await expect(r.syncReminders()).rejects.toThrow('plugin')
    expect(h.ln.cancel).not.toHaveBeenCalled()
    expect(h.pending).toHaveLength(2)
  })

  it('cancels reminders no longer in the plan', async () => {
    h.pending.push({ id: 1 })
    await r.syncReminders()
    expect(h.ln.cancel).toHaveBeenCalledWith({ notifications: [{ id: 1 }] })
  })

  it('sign-out during a sync in flight leaves nothing scheduled', async () => {
    let release!: (m: Medication[]) => void
    vi.mocked(meds.listMeds).mockReturnValueOnce(new Promise((res) => (release = res)))
    const sync = r.syncReminders()
    await until(() => vi.mocked(meds.listMeds).mock.calls.length > 0)
    const forget = r.forgetReminders()
    release([med])
    await Promise.all([sync, forget])
    expect(h.ln.schedule).not.toHaveBeenCalled()
    expect(h.pending).toEqual([])
    expect(h.ln.removeAllDeliveredNotifications).toHaveBeenCalled()
  })

  it('turning reminders off during a sync in flight leaves nothing scheduled', async () => {
    let release!: (m: Medication[]) => void
    vi.mocked(meds.listMeds).mockReturnValueOnce(new Promise((res) => (release = res)))
    const sync = r.syncReminders()
    await until(() => vi.mocked(meds.listMeds).mock.calls.length > 0)
    const off = r.setRemindersEnabled(false)
    release([med])
    await Promise.all([sync, off])
    expect(h.pending).toEqual([])
  })
})

describe('notification buttons', () => {
  beforeEach(async () => {
    await r.startReminders()
    vi.clearAllMocks()
  })

  it('Taken marks the dose', async () => {
    vi.mocked(doses.listDoses).mockResolvedValue([row()])
    await tap('taken')
    expect(doses.setDoseStatus).toHaveBeenCalledWith('d1', 'taken')
    expect(localStorage.getItem('medtracker-reminder-actions')).toBeNull()
  })

  it('Taken with no dose row yet is kept and sent on a later sync', async () => {
    await tap('taken')
    expect(doses.setDoseStatus).not.toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('medtracker-reminder-actions')!)).toHaveLength(1)
    vi.mocked(doses.listDoses).mockResolvedValue([row()])
    await r.syncReminders()
    expect(doses.setDoseStatus).toHaveBeenCalledWith('d1', 'taken')
    expect(localStorage.getItem('medtracker-reminder-actions')).toBeNull()
  })

  it('Snooze rings again after the profile snooze even when the server is unreachable', async () => {
    vi.mocked(doses.listDoses).mockResolvedValue([row()])
    vi.mocked(doses.snoozeDose).mockRejectedValue(new Error('offline'))
    vi.setSystemTime(Date.parse(DUE) + 60_000) // the reminder fired a minute ago
    await tap('snooze')
    expect(doses.snoozeDose).toHaveBeenCalledWith('d1', 5)
    const ats = h.ln.schedule.mock.calls.flatMap((c) => c[0].notifications.map((n) => n.schedule!.at.getTime()))
    expect(ats).toContain(Date.parse(DUE) + 6 * 60_000)
    expect(JSON.parse(localStorage.getItem('medtracker-reminder-actions')!)).toHaveLength(1) // retried later
  })
})
