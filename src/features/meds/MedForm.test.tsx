import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Suggestion } from '../autocomplete/sources'
import type { Medication } from '../../lib/types'
import type { ListState } from '../dinLookup/lookup'
import type { ListKind, ProductRow } from '../dinLookup/types'

type Group = { items: Suggestion[]; state: 'idle' | 'loading' | 'error' | 'done' }
const sugg = vi.hoisted(() => ({
  value: {
    mine: [] as Suggestion[],
    ca: { items: [], state: 'idle' } as Group,
    us: { items: [], state: 'idle' } as Group,
  },
}))
const queries = vi.hoisted(() => [] as string[])
vi.mock('../autocomplete/useSuggestions', () => ({
  useSuggestions: (q: string) => {
    queries.push(q)
    return sugg.value
  },
}))

const ready = (products: Record<string, ProductRow>): ListState => ({ status: 'ready', products })
const ADVIL: ProductRow = { name: 'ADVIL', form: 'tablet', strength: '200 mg', discontinued: false }
const GLUCO: ProductRow = { name: 'GLUCOSAMINE', form: 'capsule', strength: '500 mg', discontinued: true }
const lists: Record<ListKind, ListState> = { din: ready({ '02242963': ADVIL }), npn: ready({ '80012345': GLUCO }) }
vi.mock('../dinLookup/dataVersion', () => ({ PRODUCT_DATA: { generatedAt: '2026-10-25', lists: ['din', 'npn'] } }))
vi.mock('../dinLookup/useProductLists', () => ({ useProductLists: () => ({ ensure: () => Promise.resolve(lists) }) }))

import MedForm from './MedForm'

const onSave = vi.fn((_m: unknown, _s: unknown) => Promise.resolve())
const onCancel = vi.fn()

beforeEach(() => {
  onSave.mockClear()
  queries.length = 0
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

  it('editing a med offers Pause, Stop and Delete; a new med does not', () => {
    const m: Medication = {
      id: 'm1', user_id: 'u1', name: 'Ibuprofen', strength: null, form: 'tablet', notes: null, units_per_dose: 1,
      stock: null, refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null, created_at: '', updated_at: '',
    }
    const daily = { id: 's', user_id: 'u1', medication_id: 'm1', kind: 'daily' as const, times: ['09:00:00'], weekdays: null, interval_days: null, start_date: null, end_date: null }
    const manage = { onPause: vi.fn(), onStop: vi.fn(), onDelete: vi.fn() }
    const view = render(
      <MedForm med={m} schedules={[daily]} meds={[m]} remoteSuggestions today="2026-10-19" onSave={onSave} onCancel={onCancel} manage={manage} />,
    )
    const group = within(screen.getByRole('group', { name: 'Manage medication' }))
    fireEvent.click(group.getByRole('button', { name: 'Pause' }))
    fireEvent.click(group.getByRole('button', { name: 'Stop…' }))
    fireEvent.click(group.getByRole('button', { name: 'Delete…' }))
    expect([manage.onPause, manage.onStop, manage.onDelete].every((f) => f.mock.calls.length === 1)).toBe(true)
    expect(onSave).not.toHaveBeenCalled()
    view.unmount()
    renderForm()
    expect(screen.queryByRole('group', { name: 'Manage medication' })).toBeNull()
  })

  it('a new med has the DIN/NPN row above the name search; editing does not (MT-103)', () => {
    const view = renderForm()
    const din = screen.getByLabelText('DIN or NPN (on the label)')
    const divider = screen.getByText('or search by name')
    const name = screen.getByLabelText('Name')
    expect(din.compareDocumentPosition(divider) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(divider.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    view.unmount()
    const m: Medication = {
      id: 'm1', user_id: 'u1', name: 'Ibuprofen', strength: null, form: 'tablet', notes: null, units_per_dose: 1,
      stock: null, refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null, created_at: '', updated_at: '',
    }
    render(<MedForm med={m} meds={[m]} remoteSuggestions today="2026-10-19" onSave={onSave} onCancel={onCancel} />)
    expect(screen.queryByLabelText('DIN or NPN (on the label)')).toBeNull()
    expect(screen.queryByText('or search by name')).toBeNull()
  })

  describe('editing keeps stock changed elsewhere (MT-11)', () => {
    const existing: Medication = {
      id: 'm1', user_id: 'u1', name: 'Ibuprofen', strength: null, form: 'tablet', notes: null, units_per_dose: 1,
      stock: 10, refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null,
      created_at: '2026-10-19T00:00:00Z', updated_at: '2026-10-19T00:00:00Z',
    }
    const renderEdit = () =>
      render(<MedForm med={existing} meds={[existing]} remoteSuggestions today="2026-10-19" onSave={onSave} onCancel={onCancel} />)
    const savedMed = () => onSave.mock.calls[0]?.[0] as Record<string, unknown>

    it('leaves stock out of the save when the field was not changed', async () => {
      renderEdit()
      type('Notes', 'with food')
      submit()
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(savedMed()).toMatchObject({ id: 'm1', notes: 'with food' })
      expect(savedMed()).not.toHaveProperty('stock')
    })

    it('sends stock when the user changed it', async () => {
      renderEdit()
      type('Stock (tablets)', '30')
      submit()
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(savedMed()).toMatchObject({ id: 'm1', stock: 30 })
    })

    it('sends stock when the user cleared it to stop tracking', async () => {
      renderEdit()
      type('Stock (tablets)', '')
      submit()
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(savedMed()).toMatchObject({ id: 'm1', stock: null })
    })
  })

  describe('filling from a DIN/NPN (MT-104)', () => {
    const DIN = 'DIN or NPN (on the label)'
    const TICK = "I've checked these details against the label."
    const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value
    const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    const banner = () => screen.queryByText(/^Filled from/)?.closest('[role="status"]')
    const fill = async (number = '02242963') => {
      type(DIN, number)
      await screen.findByText(new RegExp(`Filled from \\S+ ${number}`))
    }

    it('a match fills name, strength and form, opens More details and shows the banner with the number', async () => {
      renderForm()
      await fill()
      expect(value('Name')).toBe('ADVIL')
      expect(value('Strength')).toBe('200 mg')
      expect(value('Form')).toBe('tablet')
      expect((screen.getByText('More details').closest('details') as HTMLDetailsElement).open).toBe(true)
      expect(banner()?.textContent).toBe(
        '⚠️ Filled from DIN 02242963. Please check every detail against your label before saving. ' +
          'The number or the product details may be wrong or out of date.',
      )
      expect(screen.queryByText(/discontinued/)).toBeNull()
    })

    it('filled fields carry the from-label tag until edited', async () => {
      renderForm()
      await fill()
      const tagOf = (label: string) => {
        const el = screen.getByLabelText(label)
        return [el.classList.contains('from-label'), document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent]
      }
      expect(tagOf('Name')).toEqual([true, 'from label'])
      expect(tagOf('Strength')).toEqual([true, 'from label'])
      expect(tagOf('Form')).toEqual([true, 'from label'])
      type('Strength', '400 mg')
      expect(tagOf('Strength')).toEqual([false, undefined])
      expect(banner()).toBeTruthy()
    })

    it('Save is disabled until the tick is checked, then saves the filled values', async () => {
      renderForm()
      await fill()
      expect(saveButton().disabled).toBe(true)
      fireEvent.click(screen.getByLabelText(TICK))
      expect(saveButton().disabled).toBe(false)
      submit()
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
      expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'ADVIL', strength: '200 mg', form: 'tablet' })
    })

    it('submitting the form while unticked does not save', async () => {
      renderForm()
      await fill()
      fireEvent.submit(saveButton().closest('form')!)
      await Promise.resolve()
      expect(onSave).not.toHaveBeenCalled()
    })

    it('the hint explains the disabled Save', async () => {
      renderForm()
      await fill()
      const tick = screen.getByLabelText(TICK)
      expect(document.getElementById(tick.getAttribute('aria-describedby')!)?.textContent).toBe('Tick to confirm before saving')
      fireEvent.click(tick)
      expect(tick.getAttribute('aria-describedby')).toBeNull()
      expect(screen.queryByText('Tick to confirm before saving')).toBeNull()
    })

    it('a new matching number refills and unticks', async () => {
      renderForm()
      await fill()
      fireEvent.click(screen.getByLabelText(TICK))
      await fill('80012345')
      expect(value('Name')).toBe('GLUCOSAMINE')
      expect(value('Form')).toBe('capsule')
      expect((screen.getByLabelText(TICK) as HTMLInputElement).checked).toBe(false)
      expect(saveButton().disabled).toBe(true)
    })

    it('clearing the number clears only untouched label fields', async () => {
      renderForm()
      await fill()
      type('Name', 'Advil Liqui-Gels')
      type(DIN, '')
      expect(value('Name')).toBe('Advil Liqui-Gels')
      expect(value('Strength')).toBe('')
      expect(value('Form')).toBe('')
      expect(banner()).toBeFalsy()
      expect(screen.queryByLabelText(TICK)).toBeNull()
      expect(saveButton().disabled).toBe(false)
    })

    it('editing the number to an unknown one detaches the fill', async () => {
      renderForm()
      await fill()
      type(DIN, '0224296')
      expect(banner()).toBeFalsy()
      expect(value('Name')).toBe('')
      type(DIN, '02242964')
      expect(await screen.findByText('No product found for 02242964. Check the number or add by name.')).toBeTruthy()
      expect(value('Name')).toBe('')
      expect(screen.queryByLabelText(TICK)).toBeNull()
    })

    it('discontinued product adds the discontinued sentence', async () => {
      renderForm()
      await fill('80012345')
      expect(banner()?.textContent).toMatch(/Filled from NPN 80012345\..*This product is marked discontinued by Health Canada\.$/)
    })

    it('a fill sends nothing to remote name search', async () => {
      renderForm()
      await fill()
      expect(queries.some((q) => /advil/i.test(q))).toBe(false)
    })

    it('adding by name shows no tick and the schedule is left as is', async () => {
      renderForm()
      expect(screen.queryByLabelText(TICK)).toBeNull()
      await fill()
      expect(screen.getByLabelText('How often')).toBeTruthy()
      expect((screen.getAllByLabelText(/^Time/)[0] as HTMLInputElement).value).toBe('09:00')
    })
  })

  it('surfaces a save failure in an alert', async () => {
    onSave.mockRejectedValueOnce(new Error('boom'))
    renderForm()
    type('Name', 'Med')
    submit()
    expect(within(await screen.findByRole('alert')).getByText('boom')).toBeTruthy()
  })
})
