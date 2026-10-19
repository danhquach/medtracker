import { currentUserId, supabase } from '../lib/supabase'
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

/** Saves the med, replaces its schedules, then regenerates its future doses. Returns the med id. */
export async function saveMed(med: MedInput, schedules: ScheduleInput[]): Promise<string> {
  const { id, ...fields } = med
  let medId = id
  if (medId) {
    const { error } = await supabase.from('medications').update(fields).eq('id', medId)
    if (error) throw error
  } else {
    const user_id = await currentUserId()
    const { data, error } = await supabase.from('medications').insert({ ...fields, user_id }).select('id').single()
    if (error) throw error
    medId = (data as { id: string }).id
  }
  const del = await supabase.from('schedules').delete().eq('medication_id', medId)
  if (del.error) throw del.error
  if (schedules.length > 0) {
    const user_id = await currentUserId()
    const ins = await supabase.from('schedules').insert(schedules.map((s) => ({ ...s, medication_id: medId, user_id })))
    if (ins.error) throw ins.error
  }
  const { error: rpcError } = await supabase.rpc('regenerate_future_doses', { p_med: medId })
  if (rpcError) throw rpcError
  return medId
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

/** stock += qty; untracked stock (null) starts at qty. */
export async function addStock(id: string, qty: number): Promise<void> {
  if (!(qty > 0)) throw new Error('Quantity must be greater than 0')
  const { data, error } = await supabase.from('medications').select('stock').eq('id', id).single()
  if (error) throw error
  const current = (data as { stock: number | null }).stock
  const { error: upErr } = await supabase.from('medications').update({ stock: (current ?? 0) + qty }).eq('id', id)
  if (upErr) throw upErr
}
