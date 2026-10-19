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

export interface Schedule {
  id: string
  user_id: string
  medication_id: string
  kind: 'daily' | 'weekdays' | 'interval' | 'prn'
  times: string[] // 'HH:MM:SS'
  weekdays: number[] | null // ISO Mon=1..Sun=7
  interval_days: number | null
  start_date: string | null
  end_date: string | null
}

export type DoseStatus = 'pending' | 'taken' | 'skipped' | 'missed'

export interface DoseEvent {
  id: string
  user_id: string
  medication_id: string
  scheduled_for: string
  status: DoseStatus
  acted_at: string | null
  notified_at: string | null
  snoozed_until: string | null
}

export interface Profile {
  user_id: string
  nickname: string | null
  time_zone: string
  snooze_minutes: 5 | 10 | 15 | 30 | 60
  suggestions_enabled: boolean
  password_set: boolean
  last_seen_at: string
}

export interface PushSub {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  device_label: string | null
  enabled: boolean
  created_at: string
}
