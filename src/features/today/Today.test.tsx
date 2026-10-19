import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Today from './Today'

const api = vi.hoisted(() => ({ setDoseStatus: vi.fn(() => Promise.resolve(null)) }))

const med = {
  id: 'm1', name: 'Aspirin', strength: '81 mg', stock: 3, units_per_dose: 1,
  refill_threshold_days: 7, paused: false,
}
const sched = { medication_id: 'm1', kind: 'daily', times: ['09:00:00'], weekdays: null, interval_days: null }
const dose = (id: string, scheduled_for: string, status: string) => ({
  id, medication_id: 'm1', scheduled_for, status,
})

vi.mock('../auth/useProfile', () => ({ useProfile: () => ({ time_zone: 'America/Toronto' }) }))
vi.mock('../auth/useSession', () => ({ useSession: () => ({ loading: false, user: { is_anonymous: false } }) }))
vi.mock('../../data/meds', () => ({
  listMeds: () => Promise.resolve([med]),
  listSchedules: () => Promise.resolve([sched]),
}))
vi.mock('../../data/doses', () => ({
  listDoses: () =>
    Promise.resolve([
      dose('d1', '2026-10-19T13:00:00Z', 'pending'),
      dose('d2', '2026-10-19T13:00:00Z', 'pending'),
      dose('d3', '2026-10-19T17:00:00Z', 'taken'),
    ]),
  setDoseStatus: api.setDoseStatus,
}))

beforeEach(() => api.setDoseStatus.mockClear())

const renderToday = () =>
  render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>,
  )

describe('Today', () => {
  it('groups open doses by local time and collapses resolved ones', async () => {
    renderToday()
    expect(await screen.findByRole('heading', { name: '9:00 AM' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Taken Aspirin/ })).toHaveLength(3)
    expect(screen.getByText('Resolved (1)')).toBeTruthy()
  })

  it('shows refill chip and notifications banner', async () => {
    renderToday()
    expect(await screen.findByText(/Aspirin: running low/)).toBeTruthy()
    expect(screen.getByText('Notifications are off on this device')).toBeTruthy()
  })

  it('Skip calls setDoseStatus', async () => {
    renderToday()
    const skip = (await screen.findAllByRole('button', { name: /^Skip Aspirin/ }))[0]
    skip.click()
    await waitFor(() => expect(api.setDoseStatus).toHaveBeenCalledWith('d1', 'skipped'))
  })
})
