export type MedForm = 'tablet' | 'capsule' | 'liquid' | 'other'

export interface Medication {
  id: string
  user_id: string
  name: string
  strength: string | null
  form: MedForm | null
  notes: string | null
  units_per_dose: number
  stock: number | null
  refill_threshold_days: number
  notify: boolean
  paused: boolean
  refill_alerted_at: string | null
  created_at: string
  updated_at: string
}
