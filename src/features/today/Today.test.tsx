import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Today from './Today'
import { addDays, todayIn } from './dayRange'

const api = vi.hoisted(() => ({
  profile: { profile: { time_zone: 'America/Toronto' } as unknown, error: null as string | null, retry: vi.fn() },
  setDoseStatus: vi.fn((id: string, _status: string) => Promise.resolve<unknown>({ id })),
  guest: false,
  meds: [] as unknown[],
  listDoses: vi.fn(),
  closeStale: vi.fn(() => Promise.resolve()),
  closeOne: vi.fn(() => Promise.resolve()),
  snoozeDose: vi.fn((id: string, _minutes: number) => Promise.resolve<unknown>({ id })),
  online: true,
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
vi.mock('../../data/doses', () => ({
  listDoses: api.listDoses,
  setDoseStatus: api.setDoseStatus,
  snoozeDose: api.snoozeDose,
  SNOOZE_MINUTES: [5, 10, 15, 30, 60],
  STALE_DOSE: 'stale dose',
}))
vi.mock('../../data/offline/sync', () => ({
  subscribe: (fn: (s: { online: boolean }) => void) => (fn({ online: api.online }), () => {}),
}))

const defaultDoses = () =>
  Promise.resolve([
    dose('d1', '2026-10-19T13:00:00Z', 'pending'),
    dose('d2', '2026-10-19T13:00:00Z', 'pending'),
    dose('d3', '2026-10-19T17:00:00Z', 'taken', '2026-10-19T17:02:00Z'),
  ])

beforeEach(() => {
  api.profile = { profile: { time_zone: 'America/Toronto', snooze_minutes: 10 }, error: null, retry: vi.fn() }
  api.guest = false
  api.online = true
  api.snoozeDose.mockReset()
  api.snoozeDose.mockImplementation((id) => Promise.resolve({ id }))
  api.meds = [med]
  api.setDoseStatus.mockReset()
  api.setDoseStatus.mockImplementation((id) => Promise.resolve({ id }))
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
  it('a day after tomorrow previews its scheduled doses, with nothing to mark (until paused)', async () => {
    const later = addDays(todayIn('America/Toronto'), 3)
    const view = render(
      <MemoryRouter initialEntries={[`/today?date=${later}`]}>
        <Routes>
          <Route path="/today" element={<Today />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: '9:00 AM' })).toBeTruthy()
    expect(screen.getByRole('link', { name: /Aspirin 81 mg.*Upcoming/ }).getAttribute('href')).toBe('/history/m1')
    expect(screen.queryByRole('button', { name: /^Taken/ })).toBeNull()
    expect(screen.queryByText(/taken$/)).toBeNull()
    view.unmount()

    api.meds = [{ ...med, paused: true }]
    render(
      <MemoryRouter initialEntries={[`/today?date=${later}`]}>
        <Routes>
          <Route path="/today" element={<Today />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('Nothing scheduled for this day.')).toBeTruthy()
  })

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

  it('shows the strength apart from the bold name, on due and done rows (MT-128)', async () => {
    renderToday()
    const links = [
      ...(await screen.findAllByRole('link', { name: 'Aspirin 81 mg' })),
      screen.getByRole('link', { name: /Aspirin 81 mg.*Taken/ }),
    ]
    for (const link of links) {
      expect(link.querySelector('strong')?.textContent).toBe('Aspirin')
      expect(link.querySelector('.dose-strength')?.textContent?.trim()).toBe('81 mg')
    }
  })

  it('Taken is the primary action and applies before the server answers', async () => {
    let finish!: () => void
    api.setDoseStatus.mockImplementation(() => new Promise((r) => (finish = () => r({ id: 'd1' }))))
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

  it('marking a dose regenerated on another device says so and reloads', async () => {
    api.setDoseStatus.mockImplementation(() => Promise.resolve(null))
    renderToday()
    const taken = (await screen.findAllByRole('button', { name: /^Taken Aspirin/ }))[0]
    taken.click()
    expect((await screen.findByRole('alert')).textContent).toBe('stale dose')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Taken Aspirin/ })).toHaveLength(2))
    expect(api.closeOne).not.toHaveBeenCalled()
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

  it('Skip sits apart from Taken as a quiet button, away from the edge Taken holds', async () => {
    renderToday()
    const taken = (await screen.findAllByRole('button', { name: /^Taken Aspirin/ }))[0]
    const skip = screen.getAllByRole('button', { name: /^Skip Aspirin/ })[0]
    expect(skip.className).toContain('quiet')
    expect(taken.parentElement).toBe(skip.parentElement)
    expect(taken.parentElement!.className).toContain('dose-actions')
    expect(taken.parentElement!.firstElementChild).toBe(skip) // Skip first, Snooze between
    expect(taken.parentElement!.lastElementChild).toBe(taken) // Taken last, at the row's edge
    expect(taken.parentElement!.previousElementSibling!.className).toBe('dose-info') // actions sit under the name
  })

  describe('Snooze', () => {
    const picker = () => screen.getByRole('group', { name: /^Snooze Aspirin 81 mg for/ })

    it('opens a 5/10/15/30/60 min picker with the Settings length marked and focused', async () => {
      renderToday()
      const btn = (await screen.findAllByRole('button', { name: /^Snooze Aspirin/ }))[0]
      expect(btn.className).toContain('quiet')
      expect(btn.getAttribute('aria-expanded')).toBe('false')
      act(() => btn.click())
      expect(btn.getAttribute('aria-expanded')).toBe('true')
      const lengths = [...picker().querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
      expect(lengths).toEqual(['5 minutes', '10 minutes', '15 minutes', '30 minutes', '60 minutes'])
      const preset = screen.getByRole('button', { name: '10 minutes' })
      expect(preset.className).toContain('is-preset')
      expect(document.activeElement).toBe(preset)
      expect(api.snoozeDose).not.toHaveBeenCalled() // opening alone changes nothing
    })

    it('picking a length snoozes that dose, shows when it reminds again, and closes its notification', async () => {
      renderToday()
      const btn = (await screen.findAllByRole('button', { name: /^Snooze Aspirin/ }))[0]
      act(() => btn.click())
      act(() => screen.getByRole('button', { name: '30 minutes' }).click())
      expect(screen.queryByRole('group', { name: /^Snooze Aspirin/ })).toBeNull()
      expect(await screen.findByText(/^Snoozed · reminds /)).toBeTruthy()
      await waitFor(() => expect(api.snoozeDose).toHaveBeenCalledWith('d1', 30))
      await waitFor(() => expect(api.closeOne).toHaveBeenCalledWith('d1'))
      expect(api.setDoseStatus).not.toHaveBeenCalled()
    })

    it('tapping Snooze again or Escape closes the picker without snoozing', async () => {
      renderToday()
      const btn = (await screen.findAllByRole('button', { name: /^Snooze Aspirin/ }))[0]
      act(() => btn.click())
      act(() => btn.click())
      expect(screen.queryByRole('group', { name: /^Snooze Aspirin/ })).toBeNull()
      act(() => btn.click())
      fireEvent.keyDown(screen.getByRole('button', { name: '10 minutes' }), { key: 'Escape' })
      expect(screen.queryByRole('group', { name: /^Snooze Aspirin/ })).toBeNull()
      expect(api.snoozeDose).not.toHaveBeenCalled()
    })

    it('a failed snooze shows the error and reloads the real state', async () => {
      api.snoozeDose.mockImplementation(() => Promise.reject(new Error('invalid snooze minutes')))
      renderToday()
      const btn = (await screen.findAllByRole('button', { name: /^Snooze Aspirin/ }))[0]
      act(() => btn.click())
      act(() => screen.getByRole('button', { name: '5 minutes' }).click())
      expect((await screen.findByRole('alert')).textContent).toContain('invalid snooze minutes')
      await waitFor(() => expect(screen.queryByText(/^Snoozed · reminds /)).toBeNull())
      expect(api.closeOne).not.toHaveBeenCalled()
    })

    it('a dose no longer pending on the server says so', async () => {
      api.snoozeDose.mockImplementation(() => Promise.resolve(null))
      renderToday()
      const btn = (await screen.findAllByRole('button', { name: /^Snooze Aspirin/ }))[0]
      act(() => btn.click())
      act(() => screen.getByRole('button', { name: '10 minutes' }).click())
      expect((await screen.findByRole('alert')).textContent).toBe('stale dose')
    })

    it('offline: Snooze is disabled and says it needs a connection', async () => {
      api.online = false
      renderToday()
      const btn = (await screen.findAllByRole('button', { name: /^Snooze Aspirin 81 mg \(needs a connection\)/ }))[0]
      expect((btn as HTMLButtonElement).disabled).toBe(true)
    })

    it('guests get no Snooze (no reminders to bring back)', async () => {
      api.guest = true
      renderToday()
      await screen.findAllByRole('button', { name: /^Taken Aspirin/ })
      expect(screen.queryByRole('button', { name: /^Snooze/ })).toBeNull()
    })

    it('only due pending doses offer Snooze: not missed, not later today, not done', async () => {
      const later = new Date(Date.now() + 3_600_000).toISOString()
      api.listDoses.mockImplementation(() =>
        Promise.resolve([
          dose('m', '2026-10-19T13:00:00Z', 'missed'),
          dose('f', later, 'pending'),
          dose('t', '2026-10-19T17:00:00Z', 'taken', '2026-10-19T17:02:00Z'),
        ]),
      )
      renderToday()
      expect(await screen.findAllByRole('button', { name: /^Taken Aspirin/ })).toHaveLength(2)
      expect(screen.queryByRole('button', { name: /^Snooze/ })).toBeNull()
    })

    it('an active snooze shows its reminder time; an expired one does not', async () => {
      api.listDoses.mockImplementation(() =>
        Promise.resolve([
          { ...dose('a', '2026-10-19T13:00:00Z', 'pending'), snoozed_until: new Date(Date.now() + 600_000).toISOString() },
          { ...dose('b', '2026-10-19T13:00:00Z', 'pending'), snoozed_until: new Date(Date.now() - 600_000).toISOString() },
        ]),
      )
      renderToday()
      expect(await screen.findAllByText(/^Snoozed · reminds /)).toHaveLength(1)
    })

    describe('while the screen stays open', () => {
      // 2026-10-20 10:00 in Toronto
      beforeEach(() => vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: new Date('2026-10-20T14:00:00Z') }))
      afterEach(() => vi.useRealTimers())

      it('a dose becoming due gets Snooze and an ended snooze drops its label, without a reload', async () => {
        api.listDoses.mockImplementation(() =>
          Promise.resolve([
            dose('soon', '2026-10-20T14:02:00Z', 'pending'),
            { ...dose('snoozed', '2026-10-20T13:00:00Z', 'pending'), snoozed_until: '2026-10-20T14:01:00Z' },
          ]),
        )
        renderToday()
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0)
        })
        const loads = api.listDoses.mock.calls.length
        expect(screen.getAllByRole('button', { name: /^Snooze Aspirin/ })).toHaveLength(1) // only the overdue one
        expect(screen.getByText(/^Snoozed · reminds /)).toBeTruthy()

        await act(async () => {
          await vi.advanceTimersByTimeAsync(61_000) // snooze ends
        })
        expect(screen.queryByText(/^Snoozed · reminds /)).toBeNull()
        expect(screen.getAllByRole('button', { name: /^Snooze Aspirin/ })).toHaveLength(1)

        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000) // the 10:02 dose is due
        })
        expect(screen.getAllByRole('button', { name: /^Snooze Aspirin/ })).toHaveLength(2)
        expect(api.listDoses.mock.calls.length).toBe(loads)
      })
    })
  })

  it('a wrong tap can be undone on Today, putting the dose back to due', async () => {
    const saved: Record<string, string> = {}
    api.setDoseStatus.mockImplementation((id, status) => ((saved[id] = status), Promise.resolve({ id })))
    api.listDoses.mockImplementation(() =>
      defaultDoses().then((ds) => ds.map((d) => (saved[d.id] ? { ...d, status: saved[d.id] } : d))),
    )
    renderToday()
    const skip = (await screen.findAllByRole('button', { name: /^Skip Aspirin/ }))[0]
    act(() => skip.click())
    const undo = await screen.findByRole('button', { name: /^Undo Skipped Aspirin/ })
    api.closeOne.mockClear()
    act(() => undo.click())
    await waitFor(() => expect(api.setDoseStatus).toHaveBeenCalledWith('d1', 'pending'))
    expect(await screen.findAllByRole('button', { name: /^Taken Aspirin/ })).toHaveLength(2)
    expect(api.closeOne).not.toHaveBeenCalled()
  })

  it('a taken dose offers Undo', async () => {
    renderToday()
    expect(await screen.findByRole('button', { name: /^Undo Taken Aspirin/ })).toBeTruthy()
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
