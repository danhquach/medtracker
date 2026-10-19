import { describe, expect, it } from 'vitest'
import type { Medication, Schedule } from '../../lib/types'
import { scheduleSummary } from '../meds/summary'
import { toCsv } from './exportCsv'

const med = (over: Partial<Medication> = {}): Medication =>
  ({
    id: 'm1', user_id: 'u', name: 'Aspirin', strength: '81 mg', form: 'tablet', notes: null,
    units_per_dose: 1, stock: 30, refill_threshold_days: 7, notify: true, paused: false,
    refill_alerted_at: null, created_at: '', updated_at: '', ...over,
  }) as Medication
const sched = (over: Partial<Schedule> = {}): Schedule =>
  ({
    id: 's1', user_id: 'u', medication_id: 'm1', kind: 'daily', times: ['09:00:00'],
    weekdays: null, interval_days: null, start_date: null, end_date: null, ...over,
  }) as Schedule

describe('toCsv', () => {
  it('has the header row', () => {
    expect(toCsv([], []).split('\r\n')[0]).toBe('name,strength,form,schedule,units_per_dose,stock,notes')
  })

  it('quotes commas and quotes in notes', () => {
    const csv = toCsv([med({ notes: 'with food, "no" dairy' })], [sched()])
    expect(csv).toContain('"with food, ""no"" dairy"')
  })

  it('quotes newlines in notes', () => {
    expect(toCsv([med({ notes: 'a\nb' })], [sched()])).toContain('"a\nb"')
  })

  it('schedule column uses the MedCard summary text', () => {
    const s = [sched({ kind: 'weekdays', weekdays: [1, 3], times: ['09:00:00', '21:30:00'] })]
    const summary = scheduleSummary(s)
    const csv = toCsv([med()], s)
    expect(csv.split('\r\n')[1]).toBe(`Aspirin,81 mg,tablet,"${summary}",1,30,`)
  })

  it('only uses schedules belonging to the med and leaves nulls empty', () => {
    const csv = toCsv([med({ strength: null, form: null, stock: null })], [sched({ medication_id: 'other', kind: 'prn' })])
    expect(csv.split('\r\n')[1]).toBe('Aspirin,,,No schedule,1,,')
  })

  it('neutralises CSV formula injection with a leading single quote', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)']) {
      const csv = toCsv([med({ name: bad, notes: bad })], [sched()])
      expect(csv).toContain(`'${bad}`)
      expect(csv).not.toMatch(new RegExp(`(^|,|\\n)${bad.replace(/[+()$]/g, '\\$&')}`))
    }
  })
})
