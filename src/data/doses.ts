import { supabase } from '../lib/supabase'
import type { DoseEvent, DoseStatus } from '../lib/types'
import { opMeta, sameTime } from './offline/ops'
import { readThrough, snapshot, STALE_DOSE_CODE, submit } from './offline/sync'

const inRange = (d: DoseEvent, from: string, to: string) => {
  const t = Date.parse(d.scheduled_for)
  return t >= Date.parse(from) && t < Date.parse(to)
}

/** Rows with scheduled_for in [from, to). Offline: the cached rows in that range. */
export async function listDoses(from: string, to: string): Promise<DoseEvent[]> {
  return readThrough(
    async () => {
      const { data, error } = await supabase
        .from('dose_events')
        .select('*')
        .gte('scheduled_for', from)
        .lt('scheduled_for', to)
        .order('scheduled_for')
      if (error) throw error
      return data as DoseEvent[]
    },
    (c) => c.doses.filter((d) => inRange(d, from, to)),
    (c, rows) => ({
      ...c,
      doses: [...c.doses.filter((d) => !inRange(d, from, to)), ...rows].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
    }),
  )
}

// RPCs returning a composite can come back as null or an object with a null id.
const rowOrNull = (d: DoseEvent | null): DoseEvent | null => (d && d.id ? d : null)

/** Shown when setDoseStatus returns null: the dose was regenerated (e.g. its schedule edited on another device). */
export const STALE_DOSE = 'That dose changed on another device, so nothing was saved. The list is now up to date.'

/** Queued by (med, time), since the dose's id can change when the server regenerates it. */
export async function setDoseStatus(id: string, status: DoseStatus): Promise<DoseEvent | null> {
  const dose = (await snapshot())?.doses.find((d) => d.id === id)
  if (!dose) {
    const { data, error } = await supabase.rpc('set_dose_status', { p_dose: id, p_status: status })
    if (error) throw error
    return rowOrNull(data as DoseEvent | null)
  }
  if (status === 'missed') throw new Error('invalid target status: missed')
  const { medication_id: medId, scheduled_for: scheduledFor } = dose
  try {
    return await submit({ ...opMeta(), kind: 'doseStatus', medId, scheduledFor, status }, (c) =>
      c.doses.find((d) => d.medication_id === medId && sameTime(d.scheduled_for, scheduledFor)) ?? null,
    )
  } catch (e) {
    if ((e as { code?: string }).code === STALE_DOSE_CODE) return null
    throw e
  }
}

export const SNOOZE_MINUTES = [5, 10, 15, 30, 60] as const

/** Online only: the reminder is re-sent by the server when the snooze ends. Null if the dose is no longer pending. */
export async function snoozeDose(id: string, minutes: (typeof SNOOZE_MINUTES)[number]): Promise<DoseEvent | null> {
  const { data, error } = await supabase.rpc('snooze_dose', { p_dose: id, p_minutes: minutes })
  if (error) throw error
  return rowOrNull(data as DoseEvent | null)
}

export async function logPrnDose(medId: string): Promise<DoseEvent | null> {
  const doseId = crypto.randomUUID()
  return submit({ ...opMeta(), kind: 'prn', medId, doseId }, (c) => c.doses.find((d) => d.id === doseId) ?? null)
}

/** Called once per app load, not after each action. */
export async function generateDoses(): Promise<void> {
  const { error } = await supabase.rpc('generate_doses')
  if (error) throw error
}
