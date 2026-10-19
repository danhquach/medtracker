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

export type MedInput = Pick<
  Medication,
  'name' | 'strength' | 'form' | 'notes' | 'units_per_dose' | 'stock' | 'refill_threshold_days' | 'notify'
> & { id?: string }
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

export async function setPaused(id: string, paused: boolean): Promise<void> {
  const { error } = await supabase.from('medications').update({ paused }).eq('id', id)
  if (error) throw error
  const { error: rpcError } = await supabase.rpc('regenerate_user_doses')
  if (rpcError) throw rpcError
}

/** Atomic stock += qty; untracked stock (null) starts at qty. Returns the new stock. */
export async function addStock(id: string, qty: number): Promise<number> {
  if (!(qty > 0)) throw new Error('Quantity must be greater than 0')
  const { data, error } = await supabase.rpc('add_stock', { p_med: id, p_qty: qty })
  if (error) throw error
  return data as number
}
