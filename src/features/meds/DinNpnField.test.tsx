import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListState } from '../dinLookup/lookup'
import type { ListKind, ProductRow } from '../dinLookup/types'

type Lists = Record<ListKind, ListState>
const ready = (products: Record<string, ProductRow>): ListState => ({ status: 'ready', products })
const ADVIL: ProductRow = { name: 'ADVIL', form: 'tablet', strength: '200 mg', discontinued: false }
const GLUCO: ProductRow = { name: 'GLUCOSAMINE', form: 'capsule', strength: '500 mg', discontinued: false }

const mock = vi.hoisted(() => ({
  shipped: ['din', 'npn'] as ListKind[],
  ensure: (() => Promise.resolve({})) as () => Promise<unknown>,
}))
vi.mock('../dinLookup/dataVersion', () => ({
  PRODUCT_DATA: {
    generatedAt: '2026-10-25',
    get lists() {
      return mock.shipped
    },
  },
}))
vi.mock('../dinLookup/useProductLists', () => ({ useProductLists: () => ({ ensure: () => mock.ensure() }) }))

import DinNpnField from './DinNpnField'

const both: Lists = { din: ready({ '02242963': ADVIL }), npn: ready({ '80012345': GLUCO }) }
const onMatch = vi.fn()
const onChange = vi.fn()

function Harness() {
  const [value, setValue] = useState('')
  return (
    <DinNpnField
      value={value}
      onChange={(d) => {
        onChange(d)
        setValue(d)
      }}
      onMatch={onMatch}
    />
  )
}

const field = () => screen.getByLabelText('DIN or NPN (on the label)')
const type = (value: string) => fireEvent.change(field(), { target: { value } })
const status = () => screen.getByRole('status')

beforeEach(() => {
  onMatch.mockClear()
  onChange.mockClear()
  mock.shipped = ['din', 'npn']
  mock.ensure = () => Promise.resolve(both)
})

describe('DinNpnField', () => {
  it('shows the label row and the "or search by name" divider', () => {
    render(<Harness />)
    expect(field().getAttribute('inputmode')).toBe('numeric')
    expect(field().hasAttribute('maxlength')).toBe(false)
    expect(screen.getByText('or search by name')).toBeTruthy()
  })

  it('typing keeps only digits, capped at 8', () => {
    render(<Harness />)
    type('80a01-23456789')
    expect(onChange).toHaveBeenLastCalledWith('80012345')
    expect((field() as HTMLInputElement).value).toBe('80012345')
  })

  it('pasting a spaced number keeps the 8 digits with leading zero', () => {
    render(<Harness />)
    fireEvent.paste(field(), { clipboardData: { getData: () => 'DIN 0224 2963' } })
    expect(onChange).toHaveBeenLastCalledWith('02242963')
  })

  it('pasting "LOT 1234 NPN 80012345" keeps the NPN and looks it up', async () => {
    render(<Harness />)
    fireEvent.paste(field(), { clipboardData: { getData: () => 'LOT 1234 NPN 80012345' } })
    expect(onChange).toHaveBeenLastCalledWith('80012345')
    await vi.waitFor(() => expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ number: '80012345', kind: 'NPN' }), false))
  })

  it('a paste without an 8-digit number is left to the browser', () => {
    render(<Harness />)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.assign(event, { clipboardData: { getData: () => '2963' } })
    field().dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('focus starts loading the lists', () => {
    const ensure = vi.fn(() => Promise.resolve(both))
    mock.ensure = ensure
    render(<Harness />)
    fireEvent.focus(field())
    expect(ensure).toHaveBeenCalled()
  })

  it('8 digits with a match calls onMatch once with viaScan false', async () => {
    render(<Harness />)
    type('0224296')
    type('02242963')
    await vi.waitFor(() => expect(onMatch).toHaveBeenCalledTimes(1))
    expect(onMatch).toHaveBeenCalledWith({ ...ADVIL, number: '02242963', kind: 'DIN' }, false)
    expect(status().textContent).toBe('')
  })

  it('a stale lookup result is dropped', async () => {
    const pending: ((l: Lists) => void)[] = []
    mock.ensure = () => new Promise<Lists>((r) => pending.push(r))
    render(<Harness />)
    type('80012345')
    type('02242963')
    await act(async () => pending.forEach((r) => r(both)))
    expect(onMatch).toHaveBeenCalledTimes(1)
    expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ number: '02242963' }), false)
  })

  it('a lookup still running when the number is cleared shows nothing', async () => {
    let resolve!: (l: Lists) => void
    mock.ensure = () => new Promise<Lists>((r) => (resolve = r))
    render(<Harness />)
    type('99999999')
    type('9999999')
    await act(async () => resolve(both))
    expect(onMatch).not.toHaveBeenCalled()
    expect(status().textContent).toBe('')
  })

  it('typing 8 digits while the list loads shows no message until loaded', async () => {
    let resolve!: (l: Lists) => void
    mock.ensure = () => new Promise<Lists>((r) => (resolve = r))
    render(<Harness />)
    type('99999999')
    await act(async () => {})
    expect(status().textContent).toBe('')
    await act(async () => resolve(both))
    expect(status().textContent).toBe('No product found for 99999999. Check the number or add by name.')
  })

  it('unknown number shows no-product message and does not call onMatch', async () => {
    render(<Harness />)
    type('99999999')
    await vi.waitFor(() => expect(status().textContent).toBe('No product found for 99999999. Check the number or add by name.'))
    expect(onMatch).not.toHaveBeenCalled()
  })

  it('changing the number clears the message', async () => {
    render(<Harness />)
    type('99999999')
    await vi.waitFor(() => expect(status().textContent).not.toBe(''))
    type('9999999')
    expect(status().textContent).toBe('')
  })

  it('offline first use shows not-downloaded message', async () => {
    mock.ensure = () => Promise.resolve({ din: { status: 'error' }, npn: { status: 'error' } })
    render(<Harness />)
    type('02242963')
    await vi.waitFor(() =>
      expect(status().textContent).toBe("Product data hasn't downloaded yet. Connect once to enable lookup."),
    )
    expect(onMatch).not.toHaveBeenCalled()
  })

  it('npn not shipped shows NPN-unavailable message', async () => {
    mock.shipped = ['din']
    mock.ensure = () => Promise.resolve({ din: ready({ '02242963': ADVIL }), npn: { status: 'idle' } })
    render(<Harness />)
    type('80012345')
    await vi.waitFor(() => expect(status().textContent).toBe("NPN lookup isn't available yet. Add by name for now."))
  })

  it('two matches show a chooser and picking one calls onMatch', async () => {
    mock.ensure = () =>
      Promise.resolve({ din: ready({ '80012345': ADVIL }), npn: ready({ '80012345': { ...GLUCO, hm: true } }) })
    render(<Harness />)
    type('80012345')
    const pick = await screen.findByRole('button', { name: 'DIN-HM · GLUCOSAMINE' })
    expect(screen.getByRole('button', { name: 'DIN · ADVIL' })).toBeTruthy()
    expect(status().textContent).toBe('2 products have this number. Pick the one on your label.')
    expect(onMatch).not.toHaveBeenCalled()
    fireEvent.click(pick)
    expect(status().textContent).toBe('')
    expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'DIN-HM', name: 'GLUCOSAMINE' }), false)
    expect(screen.queryByRole('group', { name: 'Matching products' })).toBeNull()
  })

  it('has no Scan button', () => {
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /scan/i })).toBeNull()
  })
})
