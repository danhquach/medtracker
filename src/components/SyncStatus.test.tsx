import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OutboxItem } from '../data/offline/store'
import type { SyncStatus as Status } from '../data/offline/sync'
import SyncStatus, { changes } from './SyncStatus'

const m = vi.hoisted(() => ({
  listeners: new Set<(s: unknown) => void>(),
  status: {} as unknown,
  dismissFailed: vi.fn(() => Promise.resolve()),
}))
vi.mock('../data/offline/sync', () => ({
  subscribe: (fn: (s: unknown) => void) => (m.listeners.add(fn), fn(m.status), () => m.listeners.delete(fn)),
  dismissFailed: m.dismissFailed,
  snapshot: () => Promise.resolve({ meds: [{ id: 'm1', name: 'Aspirin' }], schedules: [], doses: [], profile: null }),
}))

const base: Status = { online: true, syncing: false, pending: 0, failed: [], needsSignIn: false }
const set = (s: Partial<Status>) => {
  m.status = { ...base, ...s }
  act(() => m.listeners.forEach((fn) => fn(m.status)))
}
const failed = (seq: number): OutboxItem => ({
  seq, state: 'failed', tries: 1, error: 'medication not found',
  op: { opId: `o${seq}`, at: '', kind: 'addStock', medId: 'm1', qty: 5 },
})

beforeEach(() => {
  m.status = base
  m.dismissFailed.mockClear()
})

describe('SyncStatus', () => {
  it('hidden when online and empty', () => {
    const { container } = render(<SyncStatus />)
    expect(container.textContent).toBe('')
  })

  it('shows offline with pending count', () => {
    render(<SyncStatus />)
    set({ online: false, pending: 2 })
    expect(screen.getByRole('status').textContent).toBe('Offline — 2 changes waiting')
    set({ online: false, pending: 1 })
    expect(screen.getByRole('status').textContent).toBe('Offline — 1 change waiting')
  })

  it('shows offline with nothing waiting', () => {
    render(<SyncStatus />)
    set({ online: false })
    expect(screen.getByRole('status').textContent).toBe('Offline')
  })

  it('shows syncing while pending changes are sent', () => {
    render(<SyncStatus />)
    set({ syncing: true, pending: 1 })
    expect(screen.getByRole('status').textContent).toBe('Syncing…')
  })

  it('shows sign in again when needsSignIn', () => {
    render(<SyncStatus />)
    set({ needsSignIn: true, pending: 1 })
    expect(screen.getByRole('status').textContent).toBe('Sign in again to sync')
  })

  it('failed items can be dismissed', async () => {
    render(<SyncStatus />)
    set({ failed: [failed(7)] })
    fireEvent.click(screen.getByRole('button', { name: "1 change couldn't sync" }))
    expect(await screen.findByText(/Add stock · Aspirin/)).toBeTruthy()
    expect(screen.getByText(/medication not found/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(m.dismissFailed).toHaveBeenCalledWith(7)
  })

  it('changes() pluralizes', () => {
    expect(changes(1)).toBe('1 change')
    expect(changes(3)).toBe('3 changes')
  })
})
