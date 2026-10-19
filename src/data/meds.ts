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
