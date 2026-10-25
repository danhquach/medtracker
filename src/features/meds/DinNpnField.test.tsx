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
  lists: { din: { status: 'ready' }, npn: { status: 'ready' } } as Record<string, { status: string }>,
}))
vi.mock('../dinLookup/dataVersion', () => ({
  PRODUCT_DATA: {
    generatedAt: '2026-10-25',
    get lists() {
      return mock.shipped
    },
  },
}))
vi.mock('../dinLookup/useProductLists', () => ({ useProductLists: () => ({ lists: mock.lists, ensure: () => mock.ensure() }) }))
const scanMock = vi.hoisted(() => ({ can: true, scan: vi.fn<() => Promise<string[] | 'cancelled' | 'no-camera'>>() }))
vi.mock('../../native/labelScan', () => ({ canScanLabel: () => scanMock.can, scanLabel: () => scanMock.scan() }))

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
  scanMock.can = true
  scanMock.scan.mockReset()
  mock.shipped = ['din', 'npn']
  mock.ensure = () => Promise.resolve(both)
  mock.lists = { din: { status: 'ready' }, npn: { status: 'ready' } }
})

describe('DinNpnField', () => {
  it('shows the label row and the "or search by name" divider', () => {
    render(<Harness />)
    expect(field().getAttribute('inputmode')).toBe('numeric')
    expect(field().hasAttribute('maxlength')).toBe(false)
    expect(screen.getByText('or search by name')).toBeTruthy()
  })

  it('shows a spinner with "Loading product data…" while the lists download, then the result', async () => {
    let finish: (lists: Lists) => void = () => {}
    mock.ensure = () => new Promise((resolve) => (finish = resolve))
    mock.lists = { din: { status: 'loading' }, npn: { status: 'idle' } }
    render(<Harness />)
    type('99999999')
    expect(status().textContent).toBe('Loading product data…')
    expect(status().getAttribute('aria-busy')).toBe('true')
    expect(status().querySelector('.spinner')).toBeTruthy()
    await act(async () => finish(both))
    expect(status().textContent).toBe('No product found for 99999999. Check the number or add by name.')
    expect(status().hasAttribute('aria-busy')).toBe(false)
    expect(status().querySelector('.spinner')).toBeNull()
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

  it('has no Scan button without the scanner (web, older app installs)', () => {
    scanMock.can = false
    render(<Harness />)
    expect(screen.queryByRole('button', { name: /scan/i })).toBeNull()
  })

  describe('label scan (MT-105)', () => {
    const scanButton = () => screen.getByRole('button', { name: '📷 Scan' })
    const scanReturns = async (result: string[] | 'cancelled' | 'no-camera') => {
      scanMock.scan.mockResolvedValueOnce(result)
      await act(async () => fireEvent.click(scanButton()))
    }

    it('shows a spinner with "Reading the label…" while a scan runs', async () => {
      let finish: (r: string[]) => void = () => {}
      scanMock.scan.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
      render(<Harness />)
      fireEvent.click(scanButton())
      expect(status().textContent).toBe('Reading the label…')
      expect(status().querySelector('.spinner')).toBeTruthy()
      await act(async () => finish(['80012345']))
      expect(status().textContent).toBe('Read: 8001 2345. Does this match the label?')
      expect(status().querySelector('.spinner')).toBeNull()
    })

    it('one number asks to confirm; Use fills the field and looks it up with viaScan true', async () => {
      render(<Harness />)
      await scanReturns(['80012345'])
      expect(status().textContent).toBe('Read: 8001 2345. Does this match the label?')
      expect(screen.getByText('8001 2345').classList.contains('label-number')).toBe(true)
      expect(onChange).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Use' }))
      expect((field() as HTMLInputElement).value).toBe('80012345')
      await vi.waitFor(() => expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ number: '80012345' }), true))
      expect(screen.queryByRole('group', { name: 'Number from the photo' })).toBeNull()
    })

    it('several numbers ask which one is next to DIN/NPN', async () => {
      render(<Harness />)
      await scanReturns(['02242963', '12345678'])
      expect(status().textContent).toBe('Which number is on the label next to DIN/NPN?')
      expect(screen.getByRole('button', { name: '1234 5678' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: '0224 2963' }))
      await vi.waitFor(() => expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ number: '02242963' }), true))
    })

    it('no number found offers Retake, which scans again', async () => {
      render(<Harness />)
      await scanReturns([])
      expect(status().textContent).toBe("Couldn't find an 8-digit DIN/NPN in the photo.")
      expect(screen.queryByRole('button', { name: 'Use' })).toBeNull()
      scanMock.scan.mockResolvedValueOnce(['80012345'])
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retake' })))
      expect(scanMock.scan).toHaveBeenCalledTimes(2)
      expect(status().textContent).toBe('Read: 8001 2345. Does this match the label?')
    })

    it('no camera app says to type the number', async () => {
      render(<Harness />)
      await scanReturns('no-camera')
      expect(status().textContent).toBe("Couldn't open the camera. Type the number instead.")
      expect(screen.queryByRole('button', { name: 'Retake' })).toBeNull()
    })

    it('closing the camera without a photo changes nothing', async () => {
      render(<Harness />)
      type('0224')
      await scanReturns('cancelled')
      expect(status().textContent).toBe('')
      expect((field() as HTMLInputElement).value).toBe('0224')
    })

    it('typing after a scan drops the scanned choices', async () => {
      render(<Harness />)
      await scanReturns(['80012345'])
      type('1')
      expect(screen.queryByRole('button', { name: 'Use' })).toBeNull()
      expect(status().textContent).toBe('')
    })

    it('a product picked from several after a scan keeps viaScan true', async () => {
      mock.ensure = () =>
        Promise.resolve({ din: ready({ '80012345': ADVIL }), npn: ready({ '80012345': { ...GLUCO, hm: true } }) })
      render(<Harness />)
      await scanReturns(['80012345'])
      fireEvent.click(screen.getByRole('button', { name: 'Use' }))
      fireEvent.click(await screen.findByRole('button', { name: 'DIN · ADVIL' }))
      expect(onMatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'DIN' }), true)
    })
  })
})
