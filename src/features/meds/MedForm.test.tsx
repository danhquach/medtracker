import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Suggestion } from '../autocomplete/sources'

type Group = { items: Suggestion[]; state: 'idle' | 'loading' | 'error' | 'done' }
const sugg = vi.hoisted(() => ({
  value: {
    mine: [] as Suggestion[],
    ca: { items: [], state: 'idle' } as Group,
    us: { items: [], state: 'idle' } as Group,
  },
}))
vi.mock('../autocomplete/useSuggestions', () => ({ useSuggestions: () => sugg.value }))

import MedForm from './MedForm'

const onSave = vi.fn((_m: unknown, _s: unknown) => Promise.resolve())
const onCancel = vi.fn()

beforeEach(() => {
  onSave.mockClear()
  sugg.value = { mine: [], ca: { items: [], state: 'idle' }, us: { items: [], state: 'idle' } }
})

const renderForm = () =>
  render(<MedForm meds={[]} remoteSuggestions today="2026-10-19" onSave={onSave} onCancel={onCancel} />)

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))
/** The error text a field points at via aria-describedby. */
const errorFor = (label: string) => {
  const el = screen.getByLabelText(label)
  expect(el.getAttribute('aria-invalid')).toBe('true')
  return document.getElementById(el.getAttribute('aria-describedby')!)?.textContent
}

describe('MedForm', () => {
  it('picking a US suggestion with strengths shows strength chips and fills strength on tap', () => {
    sugg.value.us = {
      items: [{ source: 'us', name: 'Ibuprofen (Oral Pill)', strengths: ['200 mg Tab', '400 mg Tab'] }],
      state: 'done',
    }
    renderForm()
    type('Name', 'ibu')
    fireEvent.click(screen.getByRole('button', { name: 'Ibuprofen (Oral Pill)' }))
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Ibuprofen (Oral Pill)')
    fireEvent.click(screen.getByRole('button', { name: '400 mg Tab' }))
    expect((screen.getByLabelText('Strength') as HTMLInputElement).value).toBe('400 mg Tab')
  })

  it('free-text name saves without picking a suggestion', async () => {
    renderForm()
    type('Name', 'My custom med')
    submit()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const [med, schedules] = onSave.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>[]]
    expect(med).toMatchObject({ name: 'My custom med', units_per_dose: 1, stock: null, refill_threshold_days: 7, notify: true })
    expect(typeof med.units_per_dose).toBe('number')
    expect(schedules).toEqual([
      { kind: 'daily', times: ['09:00:00'], weekdays: null, interval_days: null, start_date: null, end_date: null },
    ])
  })

  it('suggestion groups render in order Your meds, Canada, United States with those headings', () => {
    sugg.value = {
      mine: [{ source: 'mine', name: 'Advil' }],
      ca: { items: [{ source: 'ca', name: 'ADVIL CA' }], state: 'done' },
      us: { items: [{ source: 'us', name: 'Advil US' }], state: 'done' },
    }
    renderForm()
    type('Name', 'adv')
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)
    expect(headings).toEqual(['Your meds', 'Canada', 'United States'])
  })

  it('shows unavailable note for an errored group and hides empty done groups', () => {
    sugg.value = {
      mine: [],
      ca: { items: [], state: 'error' },
      us: { items: [], state: 'done' },
    }
    renderForm()
    type('Name', 'adv')
    expect(screen.getByText('Canada')).toBeTruthy()
    expect(screen.getByText('unavailable')).toBeTruthy()
    expect(screen.queryByText('United States')).toBeNull()
    expect(screen.queryByText('Your meds')).toBeNull()
  })

  it('weekdays schedule requires ≥1 day', async () => {
    renderForm()
    type('Name', 'Med')
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'weekdays' } })
    submit()
    const days = screen.getByRole('group', { name: 'Days' })
    expect(days.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(days.getAttribute('aria-describedby')!)?.textContent).toMatch(/at least one day/i)
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Mon' }))
    submit()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0]?.[1]).toMatchObject([{ kind: 'weekdays', weekdays: [1] }])
  })

  it('interval requires interval_days ≥ 2', async () => {
    renderForm()
    type('Name', 'Med')
    fireEvent.change(screen.getByLabelText('How often'), { target: { value: 'interval' } })
    type('Every (days)', '1')
    submit()
    expect(errorFor('Every (days)')).toMatch(/2 or more days/i)
    expect(onSave).not.toHaveBeenCalled()
    type('Every (days)', '3')
    submit()
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const sch = (onSave.mock.calls[0] as unknown as [unknown, Record<string, unknown>[]])[1][0]
    expect(sch).toMatchObject({ kind: 'interval', interval_days: 3, start_date: '2026-10-19' })
  })

  it('leads with Name, How often and Time; the rest sits under More details', () => {
    renderForm()
    const more = screen.getByText('More details').closest('details')!
    expect(more.open).toBe(false)
    for (const label of ['Strength', 'Form', 'Notes', 'Stock (units)', 'Refill threshold (days)'])
      expect(more.contains(screen.getByLabelText(label))).toBe(true)
    for (const label of ['Name', 'How often', 'Time 1']) expect(more.contains(screen.getByLabelText(label))).toBe(false)
  })

  it('shows each error beside its field, opens collapsed sections and focuses the first', () => {
    renderForm()
    type('Stock (units)', '-1')
    submit()
    expect(errorFor('Name')).toBe('Name is required')
    expect(errorFor('Stock (units)')).toMatch(/Stock must be 0 or more/)
    expect(screen.getByText('More details').closest('details')!.open).toBe(true)
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('stock and dose amount use a unit that fits the form', () => {
    renderForm()
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'liquid' } })
    expect(screen.getByLabelText('Stock (mL)')).toBeTruthy()
    expect(screen.getByLabelText('Amount per dose (mL)')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Form'), { target: { value: 'capsule' } })
    expect(screen.getByLabelText('Stock (capsules)')).toBeTruthy()
  })

  it('surfaces a save failure in an alert', async () => {
    onSave.mockRejectedValueOnce(new Error('boom'))
    renderForm()
    type('Name', 'Med')
    submit()
    expect(within(await screen.findByRole('alert')).getByText('boom')).toBeTruthy()
  })
})
