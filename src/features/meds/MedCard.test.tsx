import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Medication, Schedule } from '../../lib/types'
import MedCard from './MedCard'
import { nextDoseText, scheduleSummary } from './summary'

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

describe('nextDoseText', () => {
  const s = (p: Partial<Schedule>) => ({ ...sch({}), ...p })
  it('today when a time is still ahead, else tomorrow', () => {
    expect(nextDoseText([s({ times: ['09:00:00', '21:00:00'] })], '2026-10-19', '08:59')).toBe('today 9:00 AM')
    expect(nextDoseText([s({ times: ['09:00:00', '21:00:00'] })], '2026-10-19', '09:00')).toBe('today 9:00 PM')
    expect(nextDoseText([s({ times: ['09:00'] })], '2026-10-19', '22:00')).toBe('tomorrow 9:00 AM')
  })
  it('respects weekdays, intervals and start dates', () => {
    // 2026-10-19 is a Monday.
    expect(nextDoseText([s({ kind: 'weekdays', weekdays: [5], times: ['08:00'] })], '2026-10-19', '07:00')).toBe('Fri, Oct 23 8:00 AM')
    expect(nextDoseText([s({ kind: 'interval', interval_days: 3, start_date: '2026-10-18', times: ['08:00'] })], '2026-10-19', '07:00')).toBe('Wed, Oct 21 8:00 AM')
    expect(nextDoseText([s({ start_date: '2026-10-25', times: ['08:00'] })], '2026-10-19', '07:00')).toBe('Sun, Oct 25 8:00 AM')
  })
  it('null for as-needed or an ended schedule', () => {
    expect(nextDoseText([s({ kind: 'prn', times: [] })], '2026-10-19', '07:00')).toBeNull()
    expect(nextDoseText([s({ end_date: '2026-10-18' })], '2026-10-19', '07:00')).toBeNull()
  })
})

describe('MedCard', () => {
  it('stock chip: plural, singular, red when low', () => {
    const { unmount } = card(med({ stock: 1 }), [sch({})])
    expect(screen.getByText('1 tablet left').className).toContain('chip-low')
    unmount()
    card(med({ stock: 100 }), [sch({})])
    expect(screen.getByText('100 tablets left').className).not.toContain('chip-low')
  })
  it('stock unit fits the form', () => {
    const { unmount } = card(med({ form: 'liquid', stock: 120 }), [sch({})])
    expect(screen.getByText('120 mL left')).toBeTruthy()
    unmount()
    card(med({ form: null, stock: 5 }), [sch({})])
    expect(screen.getByText('5 units left')).toBeTruthy()
  })
  it('main action is Edit; the rest sit in a menu with Delete marked destructive', () => {
    const onEdit = vi.fn()
    card(med(), [sch({})], { onEdit })
    const menu = screen.getByLabelText('More actions for Aspirin').closest('details')!
    expect(menu.contains(screen.getByRole('button', { name: 'Edit' }))).toBe(false)
    for (const name of ['Pause', 'Refilled']) expect(menu.contains(screen.getByRole('button', { name }))).toBe(true)
    const del = screen.getByRole('button', { name: 'Delete…' })
    expect(menu.contains(del)).toBe(true)
    expect(del.className).toContain('danger')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(onEdit).toHaveBeenCalled()
  })
  it('Pause is not shown as a pressed toggle', () => {
    card(med({ paused: true }), [sch({})])
    expect(screen.getByRole('button', { name: 'Resume' }).hasAttribute('aria-pressed')).toBe(false)
  })
  it('no chip when stock untracked', () => {
    card(med({ stock: null }), [sch({})])
    expect(screen.queryByText(/left/)).toBeNull()
  })
  it('Log dose only for prn, as the main action with Edit in the menu', () => {
    const { unmount } = card(med(), [sch({})])
    expect(screen.queryByRole('button', { name: 'Log dose' })).toBeNull()
    unmount()
    const onLogDose = vi.fn()
    card(med(), [sch({ kind: 'prn', times: [] })], { onLogDose })
    const menu = screen.getByLabelText('More actions for Aspirin').closest('details')!
    expect(menu.contains(screen.getByRole('button', { name: 'Log dose' }))).toBe(false)
    expect(menu.contains(screen.getByRole('button', { name: 'Edit' }))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Log dose' }))
    expect(onLogDose).toHaveBeenCalled()
  })
  it('Refilled asks for a positive quantity', () => {
    const onRefill = vi.fn()
    card(med(), [sch({})], { onRefill })
    fireEvent.click(screen.getByRole('button', { name: 'Refilled' }))
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Quantity added (tablets)'), { target: { value: '30' } })
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
