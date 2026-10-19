import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Medication, Schedule } from '../../lib/types'
import MedCard from './MedCard'
import { scheduleSummary } from './summary'

const med = (p: Partial<Medication> = {}): Medication => ({
  id: 'm1', user_id: 'u', name: 'Aspirin', strength: '81 mg', form: 'tablet', notes: null, units_per_dose: 1,
  stock: 10, refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null,
  created_at: '', updated_at: '', ...p,
})
const sch = (p: Partial<Schedule>): Schedule => ({
  id: 's', user_id: 'u', medication_id: 'm1', kind: 'daily', times: ['11:00:00'], weekdays: null,
  interval_days: null, start_date: null, end_date: null, ...p,
})
const noop = () => {}
const card = (m: Medication, s: Schedule[], over: Partial<Parameters<typeof MedCard>[0]> = {}) =>
  render(<ul><MedCard med={m} schedules={s} onEdit={noop} onDelete={noop} onPause={noop} onLogDose={noop} onRefill={noop} {...over} /></ul>)

describe('scheduleSummary', () => {
  it('formats every kind', () => {
    expect(scheduleSummary([sch({})])).toBe('Daily — 11:00 AM')
    expect(scheduleSummary([sch({ kind: 'weekdays', weekdays: [3, 1], times: ['08:00:00'] })])).toBe('Mon, Wed — 8:00 AM')
    expect(scheduleSummary([sch({ kind: 'interval', interval_days: 3, times: ['09:00:00'] })])).toBe('Every 3 days — 9:00 AM')
    expect(scheduleSummary([sch({ kind: 'prn', times: [] })])).toBe('As needed')
    expect(scheduleSummary([sch({ times: ['00:30:00', '13:05:00'] })])).toBe('Daily — 12:30 AM, 1:05 PM')
  })
})

describe('MedCard', () => {
  it('pill chip: plural, singular, red when low', () => {
    const { unmount } = card(med({ stock: 1 }), [sch({})])
    expect(screen.getByText('1 pill left').className).toContain('chip-low')
    unmount()
    card(med({ stock: 100 }), [sch({})])
    expect(screen.getByText('100 pills left').className).not.toContain('chip-low')
  })
  it('no chip when stock untracked', () => {
    card(med({ stock: null }), [sch({})])
    expect(screen.queryByText(/left/)).toBeNull()
  })
  it('Log dose only for prn', () => {
    const { unmount } = card(med(), [sch({})])
    expect(screen.queryByRole('button', { name: 'Log dose' })).toBeNull()
    unmount()
    const onLogDose = vi.fn()
    card(med(), [sch({ kind: 'prn', times: [] })], { onLogDose })
    fireEvent.click(screen.getByRole('button', { name: 'Log dose' }))
    expect(onLogDose).toHaveBeenCalled()
  })
  it('Refilled asks for a positive quantity', () => {
    const onRefill = vi.fn()
    card(med(), [sch({})], { onRefill })
    fireEvent.click(screen.getByRole('button', { name: 'Refilled' }))
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Quantity added'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onRefill).toHaveBeenCalledWith(30)
  })
  it('pause toggle passes the inverse', () => {
    const onPause = vi.fn()
    card(med({ paused: true }), [sch({})], { onPause })
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(onPause).toHaveBeenCalledWith(false)
  })
})
