import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ queries: [] as string[] }))
vi.mock('../autocomplete/useSuggestions', () => ({
  useSuggestions: (q: string) => {
    seen.queries.push(q)
    return { mine: [], ca: { items: [], state: 'idle' }, us: { items: q ? [{ source: 'us', name: 'Picked Name' }] : [], state: 'done' } }
  },
}))
import NameAutocomplete from './NameAutocomplete'

describe('NameAutocomplete privacy', () => {
  it('opening with a stored name searches nothing; typing searches typed text; picking stops searching', () => {
    seen.queries.length = 0
    const onPick = vi.fn()
    render(<NameAutocomplete value="Stored Med" onChange={() => {}} onPick={onPick} meds={[]} remoteEnabled />)
    expect(new Set(seen.queries)).toEqual(new Set(['']))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ibu' } })
    expect(seen.queries.at(-1)).toBe('ibu')
    fireEvent.click(screen.getByRole('button', { name: 'Picked Name' }))
    expect(onPick).toHaveBeenCalled()
    expect(seen.queries.at(-1)).toBe('')
  })
})

describe('NameAutocomplete list', () => {
  const setup = () => {
    render(<NameAutocomplete value="" onChange={() => {}} onPick={() => {}} meds={[]} remoteEnabled />)
    const input = screen.getByLabelText('Name')
    fireEvent.change(input, { target: { value: 'ibu' } })
    expect(screen.getByRole('button', { name: 'Picked Name' })).toBeTruthy()
    return input
  }
  it('closes on Escape', () => {
    const input = setup()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Picked Name' })).toBeNull()
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })
  it('closes when focus leaves the field, but not when it moves into the list', () => {
    const input = setup()
    fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'Picked Name' }) })
    expect(screen.getByRole('button', { name: 'Picked Name' })).toBeTruthy()
    fireEvent.blur(input, { relatedTarget: null })
    expect(screen.queryByRole('button', { name: 'Picked Name' })).toBeNull()
  })
})
