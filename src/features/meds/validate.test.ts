import { describe, expect, it } from 'vitest'
import { validateMed, type MedDraft, type ScheduleDraft } from './validate'

const med: MedDraft = { name: 'A', units_per_dose: '1', stock: '', refill_threshold_days: '7' }
const sch = (p: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  kind: 'daily', times: ['09:00'], weekdays: [], interval_days: '', start_date: '', end_date: '', ...p,
})
const errs = (m: Partial<MedDraft> = {}, s: ScheduleDraft[] = [sch()]) => validateMed({ ...med, ...m }, s)

describe('validateMed', () => {
  it('accepts a valid med', () => expect(errs()).toEqual([]))
  it('requires a name', () => expect(errs({ name: '  ' })).toContain('Name is required'))
  it.each(['0', '-1', 'abc', ''])('rejects units_per_dose %j', (v) =>
    expect(errs({ units_per_dose: v }).join()).toMatch(/Units per dose/))
  it.each(['-1', 'x'])('rejects stock %j', (v) => expect(errs({ stock: v }).join()).toMatch(/Stock/))
  it('allows stock 0 and empty', () => {
    expect(errs({ stock: '0' })).toEqual([])
    expect(errs({ stock: '' })).toEqual([])
  })
  it.each(['0', '', '1.5'])('rejects refill threshold %j', (v) =>
    expect(errs({ refill_threshold_days: v }).join()).toMatch(/Refill threshold/))
  it('daily and weekdays need a time', () => {
    expect(errs({}, [sch({ times: [] })]).join()).toMatch(/at least one time/)
    expect(errs({}, [sch({ kind: 'weekdays', weekdays: [1], times: [''] })]).join()).toMatch(/at least one time/)
  })
  it('weekdays needs a day', () =>
    expect(errs({}, [sch({ kind: 'weekdays' })]).join()).toMatch(/at least one day/))
  it('interval needs >=2 days and a start date', () => {
    const base = sch({ kind: 'interval', interval_days: '1', start_date: '2026-10-19' })
    expect(errs({}, [base]).join()).toMatch(/2 or more days/)
    expect(errs({}, [{ ...base, interval_days: '2', start_date: '' }]).join()).toMatch(/start date/i)
    expect(errs({}, [{ ...base, interval_days: '2' }])).toEqual([])
  })
  it('prn needs no times', () => expect(errs({}, [sch({ kind: 'prn', times: [] })])).toEqual([]))
  it('end date must not precede start date', () =>
    expect(errs({}, [sch({ start_date: '2026-10-20', end_date: '2026-10-19' })]).join()).toMatch(/End date/))
})
