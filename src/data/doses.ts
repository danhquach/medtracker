import { supabase } from '../lib/supabase'
import type { DoseEvent, DoseStatus } from '../lib/types'

/** Rows with scheduled_for in [from, to). */
export async function listDoses(from: string, to: string): Promise<DoseEvent[]> {
  const { data, error } = await supabase
    .from('dose_events')
    .select('*')
    .gte('scheduled_for', from)
    .lt('scheduled_for', to)
    .order('scheduled_for')
  if (error) throw error
  return data as DoseEvent[]
}

// RPCs returning a composite can come back as null or an object with a null id.
const rowOrNull = (d: DoseEvent | null): DoseEvent | null => (d && d.id ? d : null)

export async function setDoseStatus(id: string, status: DoseStatus): Promise<DoseEvent | null> {
  const { data, error } = await supabase.rpc('set_dose_status', { p_dose: id, p_status: status })
  if (error) throw error
  return rowOrNull(data as DoseEvent | null)
}

export async function logPrnDose(medId: string): Promise<DoseEvent | null> {
  const { data, error } = await supabase.rpc('log_prn_dose', { p_med: medId })
  if (error) throw error
  return rowOrNull(data as DoseEvent | null)
}

/** Called once per app load, not after each action. */
export async function generateDoses(): Promise<void> {
  const { error } = await supabase.rpc('generate_doses')
  if (error) throw error
}
