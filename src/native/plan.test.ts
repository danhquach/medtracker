import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication, Schedule } from '../lib/types'
import { planReminders, reminderId } from './plan'

const TZ = 'America/Toronto'
const NOW = Date.parse('2026-10-20T14:00:00Z') // Tue 10:00 in Toronto (EDT, UTC-4)

const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', user_id: 'u1', name: 'Aspirin', strength: '81 mg', form: null, notes: null, units_per_dose: 1, stock: null,
  refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null, created_at: '', updated_at: '', ...over,
})
const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: 's1', user_id: 'u1', medication_id: 'm1', kind: 'daily', times: ['08:00:00', '20:00:00'], weekdays: null,
  interval_days: null, start_date: null, end_date: null, ...over,
})
const dose = (scheduled_for: string, over: Partial<DoseEvent> = {}): DoseEvent => ({
  id: `d-${scheduled_for}`, user_id: 'u1', medication_id: 'm1', scheduled_for, status: 'pending', acted_at: null,
  notified_at: null, snoozed_until: null, ...over,
})
const run = (over: Partial<Parameters<typeof planReminders>[0]> = {}) =>
  planReminders({ meds: [med()], schedules: [sched()], doses: [], timeZone: TZ, nowMs: NOW, days: 2, ...over })
const ats = (rows: { at: number }[]) => rows.map((r) => new Date(r.at).toISOString())

describe('planReminders', () => {
  it('future dose times across the window, soonest first, with server wording', () => {
    const rows = run()
    expect(ats(rows)).toEqual(['2026-10-21T00:00:00.000Z', '2026-10-21T12:00:00.000Z', '2026-10-22T00:00:00.000Z'])
    expect(rows[0]).toMatchObject({
      medId: 'm1',
      scheduledFor: '2026-10-21T00:00:00.000Z',
      title: 'Time for Aspirin',
      body: '81 mg, due 8:00 PM',
      id: reminderId('m1', '2026-10-21T00:00:00.000Z'),
    })
  })

  it('without a strength the body is just the time', () => {
    expect(run({ meds: [med({ strength: null })] })[0].body).toBe('Due 8:00 PM')
  })

  it('defaults to 7 days ahead', () => {
    expect(run({ days: undefined })).toHaveLength(13) // tonight + 6 more days x 2
  })

  it('skips meds with reminders turned off, paused meds and prn', () => {
    expect(run({ meds: [med({ notify: false })] })).toEqual([])
    expect(run({ meds: [med({ paused: true })] })).toEqual([])
    expect(run({ schedules: [sched({ kind: 'prn' })] })).toEqual([])
  })

  it('skips doses already taken or skipped', () => {
    const doses = [dose('2026-10-21T00:00:00.000Z', { status: 'taken' }), dose('2026-10-21T12:00:00.000Z', { status: 'skipped' })]
    expect(ats(run({ doses }))).toEqual(['2026-10-22T00:00:00.000Z'])
  })

  it('a snoozed dose fires at its snooze time, even after its scheduled time passed', () => {
    const doses = [dose('2026-10-20T12:00:00.000Z', { snoozed_until: '2026-10-20T14:10:00.000Z' })]
    const rows = run({ doses })
    expect(rows[0]).toMatchObject({ at: Date.parse('2026-10-20T14:10:00.000Z'), scheduledFor: '2026-10-20T12:00:00.000Z' })
  })

  it("yesterday's late dose snoozed past midnight still fires", () => {
    const late = Date.parse('2026-10-21T04:05:00Z') // Wed 00:05 Toronto
    const doses = [dose('2026-10-21T03:50:00.000Z', { snoozed_until: '2026-10-21T04:20:00.000Z' })]
    const rows = run({ schedules: [sched({ times: ['23:50:00'] })], doses, nowMs: late, days: 1 })
    expect(ats(rows)).toEqual(['2026-10-21T04:20:00.000Z', '2026-10-22T03:50:00.000Z'])
  })

  it('a snooze made on this phone wins over the cached one', () => {
    const doses = [dose('2026-10-20T12:00:00.000Z', { snoozed_until: '2026-10-20T14:10:00.000Z' })]
    const snoozes = { [reminderId('m1', '2026-10-20T12:00:00.000Z')]: Date.parse('2026-10-20T14:30:00.000Z') }
    expect(run({ doses, snoozes })[0].at).toBe(Date.parse('2026-10-20T14:30:00.000Z'))
  })

  it('a dose time that already passed without a snooze is not scheduled', () => {
    expect(ats(run())).not.toContain('2026-10-20T12:00:00.000Z')
  })

  it('keeps the wall-clock time across the fall-back change (EDT -> EST on 2026-11-01)', () => {
    const rows = run({ schedules: [sched({ times: ['09:00:00'] })], nowMs: Date.parse('2026-10-31T14:00:00Z'), days: 3 })
    expect(ats(rows)).toEqual(['2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z'])
    expect(rows.map((r) => r.body)).toEqual(['81 mg, due 9:00 AM', '81 mg, due 9:00 AM'])
  })

  it('caps the number of reminders, keeping the soonest', () => {
    expect(ats(run({ days: 7, max: 2 }))).toEqual(['2026-10-21T00:00:00.000Z', '2026-10-21T12:00:00.000Z'])
  })

  it('caps the number of reminders', () => {
    expect(run({ days: 7, max: 3 })).toHaveLength(3)
  })

  it('ids are stable, positive 31-bit ints and differ per dose', () => {
    const a = reminderId('m1', '2026-10-21T00:00:00.000Z')
    expect(a).toBe(reminderId('m1', '2026-10-21T00:00:00.000Z'))
    expect(a).not.toBe(reminderId('m1', '2026-10-21T12:00:00.000Z'))
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThanOrEqual(0x7fffffff)
  })
})
