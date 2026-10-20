import { describe, expect, it } from 'vitest'
import type { Medication, Schedule } from '../../lib/types'
import { generateLocalDoses } from './generate'

const TZ = 'America/Toronto'
const NOW = Date.parse('2026-10-20T14:00:00Z') // Tue 10:00 in Toronto (EDT, UTC-4)

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', user_id: 'u1', name: 'A', strength: null, form: null, notes: null, units_per_dose: 1, stock: null,
  refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null, created_at: '', updated_at: '', ...over,
})
const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's1', user_id: 'u1', medication_id: 'm1', kind: 'daily', times: ['08:00:00', '20:00:00'], weekdays: null,
  interval_days: null, start_date: null, end_date: null, ...over,
})
const run = (over: Partial<Parameters<typeof generateLocalDoses>[0]> = {}) =>
  generateLocalDoses({ meds: [med()], schedules: [sched()], existing: [], timeZone: TZ, nowMs: NOW, ...over })
const times = (rows: { scheduled_for: string }[]) => rows.map((r) => r.scheduled_for)

describe('generateLocalDoses', () => {
  it('daily future times today and tomorrow only', () => {
    const rows = run()
    expect(times(rows)).toEqual(['2026-10-21T00:00:00.000Z', '2026-10-21T12:00:00.000Z', '2026-10-22T00:00:00.000Z'])
    expect(rows[0]).toMatchObject({ id: 'local:m1:2026-10-21T00:00:00.000Z', user_id: 'u1', medication_id: 'm1', status: 'pending', notified_at: null })
  })

  it('weekdays respects ISO weekday', () => {
    // Tue = 2, Wed = 3: only Wednesday's doses
    expect(times(run({ schedules: [sched({ kind: 'weekdays', weekdays: [3], times: ['08:00:00'] })] }))).toEqual([
      '2026-10-21T12:00:00.000Z',
    ])
  })

  it('interval counts from start_date', () => {
    const s = sched({ kind: 'interval', interval_days: 2, start_date: '2026-10-19', times: ['20:00:00'] })
    // 10-19 + 2 = 10-21 (tomorrow) only; today (10-20) is off
    expect(times(run({ schedules: [s] }))).toEqual(['2026-10-22T00:00:00.000Z'])
  })

  it('paused and prn produce nothing', () => {
    expect(run({ meds: [med({ paused: true })] })).toEqual([])
    expect(run({ schedules: [sched({ kind: 'prn', times: [] })] })).toEqual([])
  })

  it('start/end dates bound days', () => {
    expect(times(run({ schedules: [sched({ end_date: '2026-10-20' })] }))).toEqual(['2026-10-21T00:00:00.000Z'])
    expect(times(run({ schedules: [sched({ start_date: '2026-10-21', times: ['08:00:00'] })] }))).toEqual([
      '2026-10-21T12:00:00.000Z',
    ])
  })

  it('backfill adds passed times today except skipTimes', () => {
    const s = sched({ times: ['07:00:00', '08:00:00'] })
    const rows = run({ schedules: [s], backfill: { medId: 'm1', skipTimes: ['07:00:00'] } })
    expect(times(rows)).toEqual(['2026-10-20T12:00:00.000Z', '2026-10-21T11:00:00.000Z', '2026-10-21T12:00:00.000Z'])
    expect(rows[0].notified_at).not.toBeNull()
  })

  it('existing (med, time) is not duplicated', () => {
    const existing = [{ medication_id: 'm1', scheduled_for: '2026-10-21T00:00:00.000Z' }]
    expect(times(run({ existing }))).not.toContain('2026-10-21T00:00:00.000Z')
  })

  it('DST day uses local wall time', () => {
    // 2026-11-01: Toronto falls back at 02:00 (EDT → EST). 08:00 EST = 13:00Z.
    const nowMs = Date.parse('2026-11-01T05:00:00Z')
    expect(times(run({ nowMs, schedules: [sched({ times: ['08:00:00'] })] }))).toEqual([
      '2026-11-01T13:00:00.000Z',
      '2026-11-02T13:00:00.000Z',
    ])
  })
})
