export type ScheduleLike = {
  kind: 'daily' | 'weekdays' | 'interval' | 'prn'
  times: string[] | null
  weekdays: number[] | null
  interval_days: number | null
}

export type MedLike = {
  stock: number | null
  units_per_dose: number
  refill_threshold_days: number
  paused: boolean
}

export function avgDosesPerDay(s: ScheduleLike): number {
  const n = s.times?.length ?? 0
  switch (s.kind) {
    case 'daily':
      return n
    case 'weekdays':
      return (n * (s.weekdays?.length ?? 0)) / 7
    case 'interval':
      return s.interval_days && s.interval_days > 0 ? n / s.interval_days : 0
    default:
      return 0
  }
}

export function daysLeft(stock: number | null, unitsPerDose: number, perDay: number): number | null {
  if (stock === null || perDay <= 0 || unitsPerDose <= 0) return null
  return stock / (unitsPerDose * perDay)
}

export function refillState(med: MedLike, schedules: ScheduleLike[]): 'none' | 'ok' | 'low' {
  if (med.paused || med.stock === null) return 'none'
  const perDay = schedules.reduce((sum, s) => sum + avgDosesPerDay(s), 0)
  const left = daysLeft(med.stock, med.units_per_dose, perDay)
  if (left === null) return 'none'
  return left <= med.refill_threshold_days ? 'low' : 'ok'
}
