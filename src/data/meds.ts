import { supabase } from '../lib/supabase'
import type { Medication, Schedule } from '../lib/types'
import { opMeta } from './offline/ops'
import { readThrough, submit } from './offline/sync'

export async function listMeds(): Promise<Medication[]> {
  return readThrough(
    async () => {
      const { data, error } = await supabase.from('medications').select('*').order('name')
      if (error) throw error
      return data as Medication[]
    },
    (c) => [...c.meds].sort((a, b) => a.name.localeCompare(b.name)),
    (c, meds) => ({ ...c, meds }),
  )
}

export async function listSchedules(): Promise<Schedule[]> {
  return readThrough(
    async () => {
      const { data, error } = await supabase.from('schedules').select('*')
      if (error) throw error
      return data as Schedule[]
    },
    (c) => c.schedules,
    (c, schedules) => ({ ...c, schedules }),
  )
}

/** On edit, leave `stock` out to keep the current count (a refill or dose may have changed it meanwhile). */
export type MedInput = Pick<
  Medication,
  'name' | 'strength' | 'form' | 'notes' | 'units_per_dose' | 'refill_threshold_days' | 'notify'
> & { id?: string; stock?: Medication['stock'] }
export type ScheduleInput = Pick<Schedule, 'kind' | 'times' | 'weekdays' | 'interval_days' | 'start_date' | 'end_date'>

/**
 * Atomic (one DB transaction): saves the med, replaces its schedules, regenerates its future doses.
 * A new med gets its id here, so it can be used before the server has it. Returns the med id.
 */
export async function saveMed(med: MedInput, schedules: ScheduleInput[]): Promise<string> {
  const id = med.id ?? crypto.randomUUID()
  return submit({ ...opMeta(), kind: 'saveMed', create: !med.id, med: { ...med, id }, schedules }, () => id)
}

export async function deleteMed(id: string): Promise<void> {
  await submit({ ...opMeta(), kind: 'deleteMed', medId: id }, () => undefined)
}

/** Ends the med's recurring schedules after today: no more doses, history kept. */
export async function stopMed(med: Medication, schedules: Schedule[], today: string): Promise<void> {
  const { id, name, strength, form, notes, units_per_dose, refill_threshold_days, notify } = med
  await saveMed(
    { id, name, strength, form, notes, units_per_dose, refill_threshold_days, notify },
    schedules.map(({ kind, times, weekdays, interval_days, start_date, end_date }) => ({
      kind,
      times,
      weekdays,
      interval_days,
      start_date,
      end_date: kind === 'prn' || (end_date && end_date <= today) ? end_date : today,
    })),
  )
}

export async function setPaused(id: string, paused: boolean): Promise<void> {
  await submit({ ...opMeta(), kind: 'setPaused', medId: id, paused }, () => undefined)
}

/** Atomic stock += qty; untracked stock (null) starts at qty. Returns the new stock. */
export async function addStock(id: string, qty: number): Promise<number> {
  if (!(Number.isFinite(qty) && qty > 0)) throw new Error('Quantity must be greater than 0')
  return submit({ ...opMeta(), kind: 'addStock', medId: id, qty }, (c) => c.meds.find((m) => m.id === id)?.stock ?? qty)
}
