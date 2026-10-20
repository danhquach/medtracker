import { supabase } from '../lib/supabase'
import type { Medication, Schedule } from '../lib/types'

export async function listMeds(): Promise<Medication[]> {
  const { data, error } = await supabase.from('medications').select('*').order('name')
  if (error) throw error
  return data as Medication[]
}

export async function listSchedules(): Promise<Schedule[]> {
  const { data, error } = await supabase.from('schedules').select('*')
  if (error) throw error
  return data as Schedule[]
}

/** On edit, leave `stock` out to keep the current count (a refill or dose may have changed it meanwhile). */
export type MedInput = Pick<
  Medication,
  'name' | 'strength' | 'form' | 'notes' | 'units_per_dose' | 'refill_threshold_days' | 'notify'
> & { id?: string; stock?: Medication['stock'] }
export type ScheduleInput = Pick<Schedule, 'kind' | 'times' | 'weekdays' | 'interval_days' | 'start_date' | 'end_date'>

/** Atomic (one DB transaction): saves the med, replaces its schedules, regenerates its future doses. Returns the med id. */
export async function saveMed(med: MedInput, schedules: ScheduleInput[]): Promise<string> {
  const { data, error } = await supabase.rpc('save_med', { p_med: med, p_schedules: schedules })
  if (error) throw error
  return data as string
}

export async function deleteMed(id: string): Promise<void> {
  const { error } = await supabase.from('medications').delete().eq('id', id)
  if (error) throw error
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
  const { error } = await supabase.from('medications').update({ paused }).eq('id', id)
  if (error) throw error
  const { error: rpcError } = await supabase.rpc('regenerate_user_doses')
  if (rpcError) throw rpcError
}

/** Atomic stock += qty; untracked stock (null) starts at qty. Returns the new stock. */
export async function addStock(id: string, qty: number): Promise<number> {
  if (!(Number.isFinite(qty) && qty > 0)) throw new Error('Quantity must be greater than 0')
  const { data, error } = await supabase.rpc('add_stock', { p_med: id, p_qty: qty })
  if (error) throw error
  return data as number
}
