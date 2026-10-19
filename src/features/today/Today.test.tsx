import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Today from './Today'

const api = vi.hoisted(() => ({
  profile: { profile: { time_zone: 'America/Toronto' } as unknown, error: null as string | null, retry: vi.fn() },
  setDoseStatus: vi.fn((_id: string, _status: string) => Promise.resolve(null)),
  guest: false,
  meds: [] as unknown[],
  listDoses: vi.fn(),
  closeStale: vi.fn(() => Promise.resolve()),
  closeOne: vi.fn(() => Promise.resolve()),
}))

const med = {
  id: 'm1', name: 'Aspirin', strength: '81 mg', stock: 3, units_per_dose: 1,
  refill_threshold_days: 7, paused: false,
}
const sched = { medication_id: 'm1', kind: 'daily', times: ['09:00:00'], weekdays: null, interval_days: null }
const dose = (id: string, scheduled_for: string, status: string, acted_at: string | null = null) => ({
  id, medication_id: 'm1', scheduled_for, status, acted_at,
})

vi.mock('../auth/useProfile', () => ({ useProfileState: () => api.profile }))
vi.mock('../auth/useSession', () => ({ useSession: () => ({ loading: false, user: { is_anonymous: api.guest } }) }))
vi.mock('../../data/meds', () => ({
  listMeds: () => Promise.resolve(api.meds),
  listSchedules: () => Promise.resolve([sched]),
}))
vi.mock('../../push/closeStale', () => ({ closeStaleNotifications: api.closeStale, closeDoseNotification: api.closeOne }))
vi.mock('../../data/doses', () => ({ listDoses: api.listDoses, setDoseStatus: api.setDoseStatus }))

const defaultDoses = () =>
  Promise.resolve([
    dose('d1', '2026-10-19T13:00:00Z', 'pending'),
    dose('d2', '2026-10-19T13:00:00Z', 'pending'),
    dose('d3', '2026-10-19T17:00:00Z', 'taken', '2026-10-19T17:02:00Z'),
  ])

beforeEach(() => {
  api.profile = { profile: { time_zone: 'America/Toronto' }, error: null, retry: vi.fn() }
  api.guest = false
  api.meds = [med]
  api.setDoseStatus.mockReset()
  api.setDoseStatus.mockImplementation(() => Promise.resolve(null))
  api.closeStale.mockClear()
  api.closeOne.mockClear()
  api.listDoses.mockReset()
  api.listDoses.mockImplementation(defaultDoses)
})

function Where() {
  const { pathname, search } = useLocation()
  return <output data-testid="where">{pathname + search}</output>
}

const renderToday = () =>
  render(
    <MemoryRouter initialEntries={['/today']}>
      <Routes>
        <Route path="/today" element={<Today />} />
        <Route path="*" element={null} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
const where = () => screen.getByTestId('where').textContent

describe('Today', () => {
  it('groups doses by local time; a taken dose stays in place and links to its History', async () => {
    renderToday()
    expect(await screen.findByRole('heading', { name: '9:00 AM' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '1:00 PM' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Taken Aspirin/ })).toHaveLength(2)
    const done = screen.getByRole('link', { name: /Aspirin 81 mg.*Taken 1:02 PM/ })
    expect(done.getAttribute('href')).toBe('/history/m1')
    expect(screen.getByText('1 of 3 taken')).toBeTruthy()
  })

  it('a due dose links to its med history by name', async () => {
    renderToday()
    const links = await screen.findAllByRole('link', { name: 'Aspirin 81 mg' })
    expect(links).toHaveLength(2)
    act(() => links[0].click())
    expect(where()).toBe('/history/m1')
  })

  it('Taken is the primary action and applies before the server answers', async () => {
    let finish!: () => void
    api.setDoseStatus.mockImplementation(() => new Promise((r) => (finish = () => r(null))))
    renderToday()
    const taken = (await screen.findAllByRole('button', { name: /^Taken Aspirin/ }))[0]
    expect(taken.className).toContain('primary')
    expect(screen.getAllByRole('button', { name: /^Skip Aspirin/ })[0].className).not.toContain('primary')
    act(() => taken.click())
    expect(await screen.findByText('2 of 3 taken')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: /Taken/ })).toHaveLength(2)
    expect(api.setDoseStatus).toHaveBeenCalledWith('d1', 'taken')
    finish()
  })

  it('a failed Taken shows an error and reloads the real state', async () => {
    api.setDoseStatus.mockImplementation(() => Promise.reject(new Error('offline')))
    renderToday()
    const taken = (await screen.findAllByRole('button', { name: /^Taken Aspirin/ }))[0]
    taken.click()
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Taken Aspirin/ })).toHaveLength(2))
  })

  it('shows statuses in sentence case', async () => {
    api.listDoses.mockImplementation(() => Promise.resolve([dose('m', '2026-10-19T13:00:00Z', 'missed')]))
    renderToday()
    expect(await screen.findByText('Missed')).toBeTruthy()
  })

  it('collects guest, notifications and low stock into one Needs attention card after the doses', async () => {
    api.guest = true
    renderToday()
    const card = await screen.findByRole('region', { name: 'Needs attention' })
    await waitFor(() => expect(card.textContent).toContain('Notifications are off on this device'))
    expect(card.textContent).toContain('Your data is only on this device')
    expect(card.textContent).toMatch(/Aspirin: running low/)
    expect(screen.getByRole('link', { name: 'Create profile' }).getAttribute('href')).toBe('/settings?account=create')
    expect(screen.getByRole('link', { name: 'Update Aspirin stock' }).getAttribute('href')).toBe('/meds/m1/edit')
    const firstDose = screen.getByRole('heading', { name: '9:00 AM' })
    expect(firstDose.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('picking another day puts it in the URL; picking today clears it', async () => {
    renderToday()
    await screen.findByRole('heading', { name: '9:00 AM' })
    const days = screen.getByRole('group', { name: 'Week' }).querySelectorAll('button')
    ;(days[4] as HTMLButtonElement).click()
    await waitFor(() => expect(where()).toMatch(/^\/today\?date=\d{4}-\d{2}-\d{2}$/))
    ;(days[3] as HTMLButtonElement).click()
    await waitFor(() => expect(where()).toBe('/today'))
  })

  it('a new user with no meds is offered Add a med', async () => {
    api.meds = []
    api.listDoses.mockImplementation(() => Promise.resolve([]))
    renderToday()
    expect((await screen.findByRole('link', { name: 'Add a med' })).getAttribute('href')).toBe('/meds/new')
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
