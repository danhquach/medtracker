import type { Schedule } from '../../lib/types'

export interface MedDraft {
  name: string
  units_per_dose: string
  stock: string
  refill_threshold_days: string
}

export interface ScheduleDraft {
  kind: Schedule['kind']
  times: string[] // 'HH:MM'
  weekdays: number[]
  interval_days: string
  start_date: string
  end_date: string
}

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s))

/** Field key → message. Schedule fields are keyed by index, e.g. `0.times`, `1.end_date`. */
export type FieldErrors = Record<string, string>

/** Marks a field invalid and points it at its error text. */
export const invalidProps = (message: string | undefined, id: string) =>
  message ? { 'aria-invalid': true, 'aria-describedby': id } : {}

export function validateMed(med: MedDraft, schedules: ScheduleDraft[]): FieldErrors {
  const errors: FieldErrors = {}
  if (!med.name.trim()) errors.name = 'Name is required'
  const units = num(med.units_per_dose)
  if (!(units > 0)) errors.units_per_dose = 'Amount per dose must be greater than 0'
  if (med.stock.trim() !== '') {
    const stock = num(med.stock)
    if (!(stock >= 0)) errors.stock = 'Stock must be 0 or more (or left empty to not track)'
  }
  const threshold = num(med.refill_threshold_days)
  if (!Number.isInteger(threshold) || threshold < 1)
    errors.refill_threshold_days = 'Refill threshold must be a whole number of 1 or more days'

  schedules.forEach((s, i) => {
    if ((s.kind === 'daily' || s.kind === 'weekdays' || s.kind === 'interval') && !s.times.some((t) => t)) {
      errors[`${i}.times`] = 'Add at least one time'
    }
    if (s.kind === 'weekdays' && s.weekdays.length === 0) errors[`${i}.weekdays`] = 'Pick at least one day'
    if (s.kind === 'interval') {
      const n = num(s.interval_days)
      if (!Number.isInteger(n) || n < 2) errors[`${i}.interval_days`] = 'Repeat every 2 or more days'
      if (!s.start_date) errors[`${i}.start_date`] = 'Every-N-days needs a start date'
    }
    if (s.start_date && s.end_date && s.end_date < s.start_date)
      errors[`${i}.end_date`] = 'End date must not be before the start date'
  })
  return errors
}

export function toMedInput(med: MedDraft & { strength: string; form: string; notes: string; notify: boolean }) {
  const form = ['tablet', 'capsule', 'liquid', 'other'].includes(med.form) ? (med.form as 'tablet' | 'capsule' | 'liquid' | 'other') : null
  return {
    name: med.name.trim(),
    strength: med.strength.trim() || null,
    form,
    notes: med.notes.trim() || null,
    units_per_dose: Number(med.units_per_dose),
    stock: med.stock.trim() === '' ? null : Number(med.stock),
    refill_threshold_days: Number(med.refill_threshold_days),
    notify: med.notify,
  }
}

export function toScheduleInput(s: ScheduleDraft) {
  const timed = s.kind !== 'prn'
  return {
    kind: s.kind,
    times: timed ? [...new Set(s.times.filter(Boolean))].sort().map((t) => (t.length === 5 ? `${t}:00` : t)) : [],
    weekdays: s.kind === 'weekdays' ? [...s.weekdays].sort((a, b) => a - b) : null,
    interval_days: s.kind === 'interval' ? Number(s.interval_days) : null,
    start_date: s.start_date || null,
    end_date: s.end_date || null,
  }
}
