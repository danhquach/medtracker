import { describe, expect, it } from 'vitest'
import { avgDosesPerDay, daysLeft, refillState } from './refill'

const med = (o: Record<string, unknown> = {}) => ({
  stock: 30,
  units_per_dose: 1,
  refill_threshold_days: 7,
  paused: false,
  ...o,
})
const daily = (n: number) => ({
  kind: 'daily' as const,
  times: Array.from({ length: n }, (_, i) => `0${i + 8}:00`),
  weekdays: null,
  interval_days: null,
})

describe('refill math', () => {
  it('daily 2 times = 2/day', () => {
    expect(avgDosesPerDay(daily(2))).toBe(2)
  })
  it('weekdays 1 time × 3 days = 3/7', () => {
    expect(
      avgDosesPerDay({ kind: 'weekdays', times: ['08:00'], weekdays: [1, 3, 5], interval_days: null }),
    ).toBeCloseTo(3 / 7)
  })
  it('interval 1 time / 3 days = 1/3', () => {
    expect(
      avgDosesPerDay({ kind: 'interval', times: ['08:00'], weekdays: null, interval_days: 3 }),
    ).toBeCloseTo(1 / 3)
  })
  it('prn = 0', () => {
    expect(avgDosesPerDay({ kind: 'prn', times: [], weekdays: null, interval_days: null })).toBe(0)
  })
  it('30 pills, 1/dose, 2/day → 15 days', () => {
    expect(daysLeft(30, 1, 2)).toBe(15)
  })
  it('daysLeft null when stock null or perDay 0', () => {
    expect(daysLeft(null, 1, 2)).toBeNull()
    expect(daysLeft(30, 1, 0)).toBeNull()
  })
  it('stock null → none', () => {
    expect(refillState(med({ stock: null }), [daily(1)])).toBe('none')
  })
  it('paused → none', () => {
    expect(refillState(med({ paused: true, stock: 0 }), [daily(1)])).toBe('none')
  })
  it('prn-only → none', () => {
    const prn = { kind: 'prn' as const, times: [], weekdays: null, interval_days: null }
    expect(refillState(med({ stock: 0 }), [prn])).toBe('none')
  })
  it('threshold 7, 7 days left → low', () => {
    expect(refillState(med({ stock: 7 }), [daily(1)])).toBe('low')
  })
  it('threshold 7, 8 days left → ok', () => {
    expect(refillState(med({ stock: 8 }), [daily(1)])).toBe('ok')
  })
  it('stock 0 → low', () => {
    expect(refillState(med({ stock: 0 }), [daily(1)])).toBe('low')
  })
  it('sums schedules of one med', () => {
    expect(refillState(med({ stock: 14 }), [daily(1), daily(1)])).toBe('low')
  })
})
