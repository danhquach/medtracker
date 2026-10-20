import type { DoseEvent, Medication, Schedule } from '../../lib/types'
import type { MedInput, ScheduleInput } from '../meds'
import type { ProfilePatch } from '../profile'
import { generateLocalDoses } from './generate'
import type { Cache } from './store'

/** One user action, queued until the server has it. `at` = when the user acted; `opId` makes replays safe. */
export type Op = { opId: string; at: string } & (
  | { kind: 'doseStatus'; medId: string; scheduledFor: string; status: 'taken' | 'skipped' | 'pending' }
  | { kind: 'prn'; medId: string; doseId: string }
  | { kind: 'saveMed'; create: boolean; med: MedInput & { id: string }; schedules: ScheduleInput[] }
  | { kind: 'deleteMed'; medId: string }
  | { kind: 'setPaused'; medId: string; paused: boolean }
  | { kind: 'addStock'; medId: string; qty: number }
  | { kind: 'updateProfile'; patch: ProfilePatch }
)

const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b)

function withStock(meds: Medication[], medId: string, delta: number): Medication[] {
  return meds.map((m) => (m.id === medId && m.stock !== null ? { ...m, stock: Math.max(m.stock + delta, 0) } : m))
}

/** Future doses nobody acted on or was reminded about: the ones the server regenerates. */
function dropRegenerable(doses: DoseEvent[], medId: string, nowMs: number): DoseEvent[] {
  return doses.filter(
    (d) => !(d.medication_id === medId && d.status === 'pending' && !d.notified_at && Date.parse(d.scheduled_for) > nowMs),
  )
}

function regenerate(c: Cache, medId: string, nowMs: number, skipTimes?: string[]): DoseEvent[] {
  if (!c.profile) return c.doses
  const fresh = generateLocalDoses({
    meds: c.meds.filter((m) => m.id === medId),
    schedules: c.schedules.filter((s) => s.medication_id === medId),
    existing: c.doses,
    timeZone: c.profile.time_zone,
    nowMs,
    backfill: skipTimes && { medId, skipTimes },
  })
  return [...c.doses, ...fresh].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
}

/** What the server will do with `op`, applied to the cached copy so the UI shows it at once. Pure. */
export function applyLocal(cache: Cache, op: Op, nowMs: number): Cache {
  const c: Cache = { ...cache }
  switch (op.kind) {
    case 'doseStatus': {
      const d = c.doses.find((x) => x.medication_id === op.medId && sameTime(x.scheduled_for, op.scheduledFor))
      if (!d || d.status === op.status) return c
      const units = c.meds.find((m) => m.id === op.medId)?.units_per_dose ?? 0
      if (op.status === 'taken') c.meds = withStock(c.meds, op.medId, -units)
      else if (d.status === 'taken') c.meds = withStock(c.meds, op.medId, units)
      c.doses = c.doses.map((x) =>
        x === d ? { ...x, status: op.status, acted_at: op.status === 'pending' ? null : op.at, snoozed_until: op.status === 'pending' ? x.snoozed_until : null } : x,
      )
      return c
    }
    case 'prn': {
      const m = c.meds.find((x) => x.id === op.medId)
      if (!m || c.doses.some((d) => d.id === op.doseId)) return c
      c.doses = [
        ...c.doses,
        { id: op.doseId, user_id: m.user_id, medication_id: m.id, scheduled_for: op.at, status: 'taken', acted_at: op.at, notified_at: null, snoozed_until: null },
      ]
      c.meds = withStock(c.meds, m.id, -m.units_per_dose)
      return c
    }
    case 'saveMed': {
      const { id } = op.med
      const prior = c.meds.find((m) => m.id === id)
      const userId = prior?.user_id ?? c.profile?.user_id ?? ''
      const next: Medication = prior
        ? { ...prior, ...op.med, stock: 'stock' in op.med ? (op.med.stock ?? null) : prior.stock, updated_at: op.at }
        : { paused: false, refill_alerted_at: null, created_at: op.at, updated_at: op.at, ...op.med, stock: op.med.stock ?? null, user_id: userId }
      const skipTimes = c.schedules.filter((s) => s.medication_id === id).flatMap((s) => s.times)
      c.meds = prior ? c.meds.map((m) => (m.id === id ? next : m)) : [...c.meds, next]
      c.schedules = [
        ...c.schedules.filter((s) => s.medication_id !== id),
        ...op.schedules.map((s, i): Schedule => ({ ...s, id: `local:${id}:${i}`, user_id: userId, medication_id: id })),
      ]
      c.doses = dropRegenerable(c.doses, id, nowMs)
      c.doses = regenerate(c, id, nowMs, skipTimes)
      return c
    }
    case 'deleteMed':
      c.meds = c.meds.filter((m) => m.id !== op.medId)
      c.schedules = c.schedules.filter((s) => s.medication_id !== op.medId)
      c.doses = c.doses.filter((d) => d.medication_id !== op.medId)
      return c
    case 'setPaused':
      c.meds = c.meds.map((m) => (m.id === op.medId ? { ...m, paused: op.paused } : m))
      c.doses = dropRegenerable(c.doses, op.medId, nowMs)
      if (!op.paused) c.doses = regenerate(c, op.medId, nowMs)
      return c
    case 'addStock':
      c.meds = c.meds.map((m) => (m.id === op.medId ? { ...m, stock: (m.stock ?? 0) + op.qty } : m))
      return c
    case 'updateProfile':
      c.profile = c.profile && { ...c.profile, ...op.patch }
      return c
  }
}

/** The single server call that applies `op` (see migration 0012). */
export function toRpc(op: Op): { name: string; args: Record<string, unknown> } | { table: 'medications'; deleteId: string } {
  switch (op.kind) {
    case 'doseStatus':
      return { name: 'set_dose_status_at', args: { p_med: op.medId, p_scheduled_for: op.scheduledFor, p_status: op.status, p_acted_at: op.at } }
    case 'prn':
      return { name: 'log_prn_dose', args: { p_med: op.medId, p_id: op.doseId, p_at: op.at } }
    case 'saveMed':
      return { name: 'save_med', args: { p_med: op.med, p_schedules: op.schedules, p_create: op.create } }
    case 'deleteMed':
      return { table: 'medications', deleteId: op.medId }
    case 'setPaused':
      return { name: 'set_paused', args: { p_med: op.medId, p_paused: op.paused } }
    case 'addStock':
      return { name: 'add_stock', args: { p_med: op.medId, p_qty: op.qty, p_op: op.opId } }
    case 'updateProfile':
      return { name: 'update_profile', args: { p_patch: op.patch } }
  }
}
