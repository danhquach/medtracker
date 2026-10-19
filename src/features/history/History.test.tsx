import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import History from './History'

const api = vi.hoisted(() => ({
  listDoses: vi.fn(),
  listMeds: vi.fn(),
  profile: { profile: { time_zone: 'America/Toronto' } as unknown, error: null as string | null, retry: vi.fn() },
}))
vi.mock('../auth/useProfile', () => ({ useProfileState: () => api.profile }))
vi.mock('../../data/meds', () => ({ listMeds: api.listMeds }))
vi.mock('../../data/doses', () => ({ listDoses: api.listDoses }))

const med = (id: string, name: string, paused = false) => ({ id, name, paused })
const dose = (id: string, medication_id: string, scheduled_for: string, status: string) => ({
  id, medication_id, scheduled_for, status,
})

// "today" in Toronto = 2026-10-19
beforeEach(() => {
  api.profile = { profile: { time_zone: 'America/Toronto' }, error: null, retry: vi.fn() }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T16:00:00Z'))
  api.listMeds.mockResolvedValue([med('m1', 'Aspirin'), med('m2', 'Paused med', true)])
  api.listDoses.mockResolvedValue([
    dose('d1', 'm1', '2026-10-19T13:00:00Z', 'taken'),
    dose('d2', 'm1', '2026-10-18T13:00:00Z', 'skipped'),
    dose('d3', 'm1', '2026-10-17T13:00:00Z', 'missed'),
    dose('d4', 'm1', '2026-10-16T13:00:00Z', 'pending'),
    // 2026-10-20 02:00Z = Oct 19 22:00 Toronto -> still Oct 19
    dose('d5', 'm1', '2026-10-20T02:00:00Z', 'missed'),
    dose('d6', 'm1', '2026-10-05T13:00:00Z', 'taken'),
    dose('d7', 'm2', '2026-10-19T13:00:00Z', 'taken'),
  ])
})

describe('History', () => {
  it('shows only active meds with labelled icons per local day', async () => {
    render(<History />)
    const row = (await screen.findByRole('button', { name: 'Aspirin' })).closest('tr') as HTMLElement
    expect(screen.queryByText('Paused med')).toBeNull()
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(7)
    // oldest -> today: Oct 13..19
    expect(within(cells[3]).getByRole('img', { name: 'Pending' })).toBeTruthy()
    expect(within(cells[4]).getByRole('img', { name: 'Missed' })).toBeTruthy()
    expect(within(cells[5]).getByRole('img', { name: 'Skipped' })).toBeTruthy()
    expect(within(cells[6]).getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual(['Taken', 'Missed'])
    expect(within(cells[0]).queryAllByRole('img')).toHaveLength(0)
  })

  it('opens a 30-day list on tap and goes back', async () => {
    render(<History />)
    fireEvent.click(await screen.findByRole('button', { name: 'Aspirin' }))
    expect(screen.getByRole('heading', { name: /Aspirin/ })).toBeTruthy()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(within(items[items.length - 1]).getByRole('img', { name: 'Taken' })).toBeTruthy()
    expect(items[0].textContent).toContain('10:00 PM')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
  })

  it('queries a 30 local-day window', async () => {
    render(<History />)
    await screen.findByRole('table')
    const [from, to] = api.listDoses.mock.calls[0]
    expect(from).toBe('2026-09-20T04:00:00.000Z')
    expect(to).toBe('2026-10-20T04:00:00.000Z')
  })

  it('shows an error with Retry instead of a blank page when the profile fails', () => {
    api.profile = { profile: null, error: 'no profile', retry: vi.fn() }
    render(<History />)
    expect(screen.getByRole('alert').textContent).toContain('no profile')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.profile.retry).toHaveBeenCalled()
  })
})
