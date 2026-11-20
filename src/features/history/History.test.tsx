import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import History from './History'

const renderHistory = (path = '/history') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/history" element={<History />} />
        <Route path="/history/:medId" element={<History />} />
      </Routes>
    </MemoryRouter>,
  )

const api = vi.hoisted(() => ({
  listDoses: vi.fn(),
  firstDoseAt: vi.fn(),
  listMeds: vi.fn(),
  setDoseStatus: vi.fn(),
  closeOne: vi.fn(),
  profile: { profile: { time_zone: 'America/Toronto' } as unknown, error: null as string | null, retry: vi.fn() },
}))
vi.mock('../auth/useProfile', () => ({ useProfileState: () => api.profile }))
vi.mock('../../data/meds', () => ({ listMeds: api.listMeds }))
vi.mock('../../data/doses', () => ({
  listDoses: api.listDoses,
  firstDoseAt: api.firstDoseAt,
  setDoseStatus: api.setDoseStatus,
  STALE_DOSE: 'stale dose',
}))
vi.mock('../../native/shareFile', () => ({ canShareFile: () => false, shareFile: vi.fn() }))
vi.mock('../../push/closeStale', () => ({ closeDoseNotification: api.closeOne }))

const med = (id: string, name: string, paused = false) => ({ id, name, paused })
const dose = (id: string, medication_id: string, scheduled_for: string, status: string) => ({
  id, medication_id, scheduled_for, status,
})

afterEach(() => vi.unstubAllGlobals())

// "today" in Toronto = 2026-10-19
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  api.profile = { profile: { time_zone: 'America/Toronto' }, error: null, retry: vi.fn() }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T16:00:00Z'))
  api.listMeds.mockResolvedValue([med('m1', 'Aspirin'), med('m2', 'Paused med', true)])
  // Aug 1 01:00Z = Jul 31 in Toronto: records go back to July.
  api.firstDoseAt.mockResolvedValue('2026-08-01T01:00:00Z')
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
  it('shows every med with labelled, coloured icons per local day; past pending reads as Missed', async () => {
    renderHistory()
    const row = (await screen.findByRole('link', { name: 'Aspirin' })).closest('tr') as HTMLElement
    const cells = within(row).getAllByRole('cell')
    expect(cells).toHaveLength(7)
    // oldest -> today: Oct 13..19
    expect(within(cells[3]).getByRole('img', { name: 'Missed' })).toBeTruthy()
    expect(within(cells[4]).getByRole('img', { name: 'Missed' }).className).toContain('dose-missed')
    expect(within(cells[5]).getByRole('img', { name: 'Skipped' }).className).toContain('dose-skipped')
    expect(within(cells[6]).getAllByRole('img').map((e) => e.getAttribute('aria-label'))).toEqual(['Taken', 'Missed'])
    expect(within(cells[0]).queryAllByRole('img')).toHaveLength(0)
  })

  it('keeps a paused med and its past doses, marked as paused, after the active ones', async () => {
    renderHistory()
    const link = await screen.findByRole('link', { name: 'Paused med' })
    const row = link.closest('tr') as HTMLElement
    expect(within(row).getByText('Paused')).toBeTruthy()
    expect(within(within(row).getAllByRole('cell')[6]).getByRole('img', { name: 'Taken' })).toBeTruthy()
    const names = screen.getAllByRole('rowheader').map((h) => h.querySelector('a')?.textContent)
    expect(names).toEqual(['Aspirin', 'Paused med'])
  })

  it('heads each day with a short weekday and date, and shows a legend', async () => {
    renderHistory()
    const heads = (await screen.findAllByRole('columnheader')).slice(1)
    expect(heads[0].textContent).toContain('Tue')
    expect(heads[0].textContent).toContain('13')
    expect(heads[6].textContent).toContain('Mon, Oct 19')
    const legend = within(screen.getByRole('list', { name: 'Legend' }))
    expect(legend.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Taken', 'Skipped', 'Missed', 'Pending'])
  })

  it('opens a 30-day list on tap', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('link', { name: 'Aspirin' }))
    expect(screen.getByRole('heading', { name: /Aspirin/ })).toBeTruthy()
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(6)
    expect(within(items[items.length - 1]).getByRole('img', { name: 'Taken' })).toBeTruthy()
    expect(items[0].textContent).toContain('10:00 PM')
  })

  it('opens a med history from its own address', async () => {
    renderHistory('/history/m1')
    expect(await screen.findByRole('heading', { name: /Aspirin/ })).toBeTruthy()
  })

  it('opens a paused med history, marked as paused', async () => {
    renderHistory('/history/m2')
    const heading = await screen.findByRole('heading', { name: /Paused med/ })
    expect(within(heading).getByText('Paused')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Taken' })).toBeTruthy()
  })

  it('redirects an unknown med to the grid', async () => {
    renderHistory('/history/nope')
    await waitFor(() => expect(screen.getByRole('table')).toBeTruthy())
  })

  it('changes any past dose to Taken, Skipped or Not taken', async () => {
    api.closeOne.mockClear()
    api.setDoseStatus.mockImplementation((id: string, status: string) =>
      Promise.resolve({ ...dose(id, 'm1', '2026-10-17T13:00:00Z', status) }),
    )
    renderHistory('/history/m1')
    const group = await screen.findByRole('group', { name: /Sat, Oct 17/ })
    const btn = (name: string) => within(group).getByRole('button', { name })
    expect(btn('Not taken').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(btn('Taken'))
    await waitFor(() => expect(btn('Taken').getAttribute('aria-pressed')).toBe('true'))
    expect(api.setDoseStatus).toHaveBeenLastCalledWith('d3', 'taken')
    expect(api.closeOne).toHaveBeenLastCalledWith('d3') // its reminder goes away (MT-147)
    const item = group.closest('li') as HTMLElement
    expect(within(item).getByRole('img', { name: 'Taken' })).toBeTruthy()

    fireEvent.click(btn('Not taken'))
    expect(api.setDoseStatus).toHaveBeenLastCalledWith('d3', 'pending')
    // Past day: back to pending reads as Missed straight away.
    await waitFor(() => expect(within(item).getByRole('img', { name: 'Missed' })).toBeTruthy())
    expect(api.closeOne).toHaveBeenCalledTimes(1) // due again: nothing to clear
  })

  it('shows today\'s Not taken dose as Pending', async () => {
    api.setDoseStatus.mockImplementation((id: string, status: string) =>
      Promise.resolve({ ...dose(id, 'm1', '2026-10-19T13:00:00Z', status) }),
    )
    renderHistory('/history/m1')
    const group = await screen.findByRole('group', { name: /Mon, Oct 19 9:00 AM/ })
    fireEvent.click(within(group).getByRole('button', { name: 'Not taken' }))
    const item = group.closest('li') as HTMLElement
    await waitFor(() => expect(within(item).getByRole('img', { name: 'Pending' })).toBeTruthy())
  })

  it('reports a failed change and keeps the old status', async () => {
    api.setDoseStatus.mockRejectedValue(new Error('offline'))
    renderHistory('/history/m1')
    const group = await screen.findByRole('group', { name: /Sun, Oct 18/ })
    fireEvent.click(within(group).getByRole('button', { name: 'Taken' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    expect(within(group).getByRole('button', { name: 'Skipped' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('says so when the dose was regenerated on another device', async () => {
    api.setDoseStatus.mockResolvedValue(null)
    renderHistory('/history/m1')
    const group = await screen.findByRole('group', { name: /Sun, Oct 18/ })
    fireEvent.click(within(group).getByRole('button', { name: 'Taken' }))
    expect((await screen.findByRole('alert')).textContent).toBe('stale dose')
    expect(screen.queryByRole('group', { name: /Sun, Oct 18/ })).toBeNull()
  })

  it('queries a 30 local-day window', async () => {
    renderHistory()
    await screen.findByRole('table')
    const [from, to] = api.listDoses.mock.calls[0]
    expect(from).toBe('2026-09-20T04:00:00.000Z')
    expect(to).toBe('2026-10-20T04:00:00.000Z')
  })

  it('switches to a month calendar that starts on the right weekday and loads that month', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy()
    const firstWeek = within(screen.getByRole('table', { name: 'October 2026' })).getAllByRole('row')[1]
    const cells = within(firstWeek).getAllByRole('cell')
    // Oct 1 2026 is a Thursday: Sun..Wed are blank.
    expect(cells.slice(0, 4).every((c) => c.textContent === '')).toBe(true)
    expect(within(cells[4]).getByRole('button').textContent).toContain('1')
    expect(screen.getByRole('button', { name: /^Sat, Oct 17: 1 Missed$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Mon, Oct 19: 2 Taken, 1 Missed$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Mon, Oct 12: no doses$/ })).toBeTruthy()
    const [from, to] = api.listDoses.mock.calls.at(-1)!
    expect(from).toBe('2026-10-01T04:00:00.000Z')
    expect(to).toBe('2026-11-01T04:00:00.000Z')
    expect(screen.getByRole('list', { name: 'Legend' })).toBeTruthy()
  })

  it('pages back to earlier months but not past the current one', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    expect((screen.getByRole('button', { name: 'Next month' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeTruthy()
    const [from, to] = api.listDoses.mock.calls.at(-1)!
    expect(from).toBe('2026-09-01T04:00:00.000Z')
    expect(to).toBe('2026-10-01T04:00:00.000Z')
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(await screen.findByRole('heading', { name: 'August 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(await screen.findByRole('heading', { name: 'September 2026' })).toBeTruthy()
  })

  it('pages back only as far as the oldest dose record, by local day', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    const prev = () => screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement
    for (const m of ['September', 'August', 'July']) {
      fireEvent.click(prev())
      await screen.findByRole('heading', { name: `${m} 2026` })
    }
    await waitFor(() => expect(prev().disabled).toBe(true))
  })

  it('stays on the current month when there are no dose records at all', async () => {
    api.firstDoseAt.mockResolvedValue(null)
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('reports the month to date in total and per med, matching the calendar', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    const report = await screen.findByRole('region', { name: 'Month-to-date report' })
    expect(within(report).getByText(/October 2026, through Mon, Oct 19/)).toBeTruthy()
    const rows = within(within(report).getByRole('table')).getAllByRole('row').map((r) =>
      [...r.children].map((c) => c.textContent?.trim()),
    )
    expect(rows).toEqual([
      ['Med', 'Scheduled', 'Taken', 'Skipped', 'Missed', 'Taken %'],
      ['All meds', '7', '3', '1', '3', '43%'],
      ['Aspirin', '6', '2', '1', '3', '33%'],
      ['Paused med (paused)', '1', '1', '0', '0', '100%'],
    ])
    expect(within(report).getByRole('button', { name: 'Print report' })).toBeTruthy()
  })

  it('prints the report', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Print report' }))
    expect(print).toHaveBeenCalled()
  })

  it('shares the report as text through the browser share sheet', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, share })
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Share report' }))
    await waitFor(() => expect(share).toHaveBeenCalled())
    const { title, text } = share.mock.calls[0][0]
    expect(title).toBe('MedTracker dose report: October 2026')
    expect(text).toContain('Aspirin: 6 scheduled, 2 taken, 1 skipped, 3 missed, 33% taken')
  })

  it('shows an empty state, not zeros, for a month with no dose records', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    api.listDoses.mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    await screen.findByRole('heading', { name: 'September 2026' })
    const report = await screen.findByRole('region', { name: 'Monthly report' })
    expect(within(report).getByText('No doses recorded in September 2026.')).toBeTruthy()
    expect(within(report).queryByRole('table')).toBeNull()
  })

  it("shows a day's doses when the day is tapped", async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Mon, Oct 19:/ }))
    const day = screen.getByRole('region', { name: 'Mon, Oct 19' })
    const items = within(day).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').trim())
    expect(items).toEqual(['Aspirin 9:00 AM Taken', 'Paused med 9:00 AM Taken', 'Aspirin 10:00 PM Missed'])
    fireEvent.click(screen.getByRole('button', { name: /^Mon, Oct 12:/ }))
    expect(within(screen.getByRole('region', { name: 'Mon, Oct 12' })).getByText('No doses on this day.')).toBeTruthy()
  })

  it('remembers the chosen view', async () => {
    const first = renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    first.unmount()
    renderHistory()
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Month' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(await screen.findByRole('link', { name: 'Aspirin' })).toBeTruthy()
  })

  it('reports a failed month load', async () => {
    renderHistory()
    fireEvent.click(await screen.findByRole('button', { name: 'Month' }))
    await screen.findByRole('heading', { name: 'October 2026' })
    api.listDoses.mockRejectedValueOnce(new Error('offline'))
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
  })

  it('shows an error with Retry instead of a blank page when the profile fails', () => {
    api.profile = { profile: null, error: 'no profile', retry: vi.fn() }
    renderHistory()
    expect(screen.getByRole('alert').textContent).toContain('no profile')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(api.profile.retry).toHaveBeenCalled()
  })
})
