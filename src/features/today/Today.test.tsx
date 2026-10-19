import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Today from './Today'

const api = vi.hoisted(() => ({
  profile: { profile: { time_zone: 'America/Toronto' } as unknown, error: null as string | null, retry: vi.fn() },
  setDoseStatus: vi.fn(() => Promise.resolve(null)),
  listDoses: vi.fn(),
  closeStale: vi.fn(() => Promise.resolve()),
  closeOne: vi.fn(() => Promise.resolve()),
}))

const med = {
  id: 'm1', name: 'Aspirin', strength: '81 mg', stock: 3, units_per_dose: 1,
  refill_threshold_days: 7, paused: false,
}
const sched = { medication_id: 'm1', kind: 'daily', times: ['09:00:00'], weekdays: null, interval_days: null }
const dose = (id: string, scheduled_for: string, status: string) => ({
  id, medication_id: 'm1', scheduled_for, status,
})

vi.mock('../auth/useProfile', () => ({ useProfileState: () => api.profile }))
vi.mock('../auth/useSession', () => ({ useSession: () => ({ loading: false, user: { is_anonymous: false } }) }))
vi.mock('../../data/meds', () => ({
  listMeds: () => Promise.resolve([med]),
  listSchedules: () => Promise.resolve([sched]),
}))
vi.mock('../../push/closeStale', () => ({ closeStaleNotifications: api.closeStale, closeDoseNotification: api.closeOne }))
vi.mock('../../data/doses', () => ({ listDoses: api.listDoses, setDoseStatus: api.setDoseStatus }))

const defaultDoses = () =>
  Promise.resolve([
    dose('d1', '2026-10-19T13:00:00Z', 'pending'),
    dose('d2', '2026-10-19T13:00:00Z', 'pending'),
    dose('d3', '2026-10-19T17:00:00Z', 'taken'),
  ])

beforeEach(() => {
  api.profile = { profile: { time_zone: 'America/Toronto' }, error: null, retry: vi.fn() }
  api.setDoseStatus.mockClear()
  api.closeStale.mockClear()
  api.closeOne.mockClear()
  api.listDoses.mockReset()
  api.listDoses.mockImplementation(defaultDoses)
})

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
    expect(await screen.findByText('Notifications are off on this device')).toBeTruthy()
  })

  it('cold open closes notifications for doses that are no longer pending', async () => {
    renderToday()
    await waitFor(() => expect(api.closeStale).toHaveBeenCalled())
    expect(api.closeStale).toHaveBeenCalledWith(new Set(['d1', 'd2']))
  })

  it('marking a dose in the app closes its notification', async () => {
    renderToday()
    const skip = (await screen.findAllByRole('button', { name: /^Skip Aspirin/ }))[0]
    skip.click()
    await waitFor(() => expect(api.closeOne).toHaveBeenCalledWith('d1'))
  })

  it('Skip calls setDoseStatus', async () => {
    renderToday()
    const skip = (await screen.findAllByRole('button', { name: /^Skip Aspirin/ }))[0]
    skip.click()
    await waitFor(() => expect(api.setDoseStatus).toHaveBeenCalledWith('d1', 'skipped'))
  })

  it('discards a stale response when the first day switch resolves last', async () => {
    renderToday()
    await screen.findByRole('heading', { name: '9:00 AM' })
    const resolvers: Array<(v: unknown[]) => void> = []
    api.listDoses.mockImplementation(() => new Promise((r) => resolvers.push(r)))
    const days = screen.getByRole('group', { name: 'Week' }).querySelectorAll('button')
    ;(days[0] as HTMLButtonElement).click()
    await waitFor(() => expect(resolvers).toHaveLength(1))
    ;(days[1] as HTMLButtonElement).click()
    await waitFor(() => expect(resolvers).toHaveLength(2))
    resolvers[1]([dose('b1', '2026-10-20T10:00:00Z', 'pending')]) // second day answers first
    expect(await screen.findByRole('heading', { name: '6:00 AM' })).toBeTruthy()
    resolvers[0]([dose('a1', '2026-10-19T14:00:00Z', 'pending')]) // stale first answer
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByRole('heading', { name: '6:00 AM' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '10:00 AM' })).toBeNull()
  })

  it('shows an error with Retry when the profile fails to load', async () => {
    api.profile = { profile: null, error: 'no profile', retry: vi.fn() }
    renderToday()
    expect((await screen.findByRole('alert')).textContent).toContain('no profile')
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(api.profile.retry).toHaveBeenCalled()
  })

  describe('crossing local midnight while open', () => {
    // 2026-10-19 23:59:30 in Toronto (EDT, UTC-4)
    beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: new Date('2026-10-20T03:59:30Z') }))
    afterEach(() => vi.useRealTimers())

    // ignore the 72h notification-cleanup query; keep the one-day view queries
    const lastFrom = () =>
      (api.listDoses.mock.calls as unknown as string[][])
        .filter(([f, t]) => Date.parse(t) - Date.parse(f) <= 25 * 3_600_000)
        .at(-1)![0]

    it('moves to the new day when the user had not picked another day', async () => {
      renderToday()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(lastFrom()).toBe('2026-10-19T04:00:00.000Z')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000) // past midnight
      })
      expect(lastFrom()).toBe('2026-10-20T04:00:00.000Z')
    })

    it('keeps a day the user picked explicitly', async () => {
      renderToday()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      const days = screen.getByRole('group', { name: 'Week' }).querySelectorAll('button')
      await act(async () => {
        ;(days[0] as HTMLButtonElement).click() // Oct 16
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(lastFrom()).toBe('2026-10-16T04:00:00.000Z')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })
      expect(lastFrom()).toBe('2026-10-16T04:00:00.000Z')
    })

    it('re-reads the clock when the tab becomes visible again', async () => {
      renderToday()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      vi.setSystemTime(new Date('2026-10-20T10:00:00Z')) // timers throttled while hidden: no midnight tick
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(lastFrom()).toBe('2026-10-20T04:00:00.000Z')
    })
  })
})
