import type { User } from '@supabase/supabase-js'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const session = vi.hoisted(() => ({ value: { loading: false, user: null as User | null } }))
const auth = vi.hoisted(() => ({ continueAsGuest: vi.fn(() => Promise.resolve()) }))

vi.mock('./features/auth/useSession', () => ({ useSession: () => session.value }))
vi.mock('./features/auth/auth', async (orig) => ({
  ...(await orig<typeof import('./features/auth/auth')>()),
  continueAsGuest: auth.continueAsGuest,
}))
vi.mock('./data/boot', () => ({ bootSession: () => Promise.resolve() }))
vi.mock('./data/profile', () => ({
  DEFAULT_TIME_ZONE: 'America/Toronto',
  getProfile: () => Promise.resolve({ time_zone: 'America/Toronto', password_set: true }),
}))
vi.mock('./data/meds', () => ({ listMeds: () => Promise.resolve([]), listSchedules: () => Promise.resolve([]) }))
vi.mock('./data/doses', () => ({ listDoses: () => Promise.resolve([]) }))

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

const signedIn = (extra: Partial<User> = {}) => {
  session.value = { loading: false, user: { id: 'u1', is_anonymous: false, ...extra } as User }
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  })
  signedIn()
})

describe('App (signed in)', () => {
  it('renders bottom tabs', async () => {
    renderAt('/today')
    for (const name of ['Today', 'Meds', 'History']) {
      expect(screen.getByRole('link', { name })).toBeTruthy()
    }
    await screen.findByRole('heading', { name: 'Today' })
  })

  it('redirects / to /today', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
  })

  it('shows the guest banner for guests only', async () => {
    signedIn({ is_anonymous: true })
    renderAt('/today')
    expect(await screen.findByText(/Your data is only on this device/)).toBeTruthy()
  })

  it('hides the guest banner for full profiles', async () => {
    renderAt('/today')
    await screen.findByText('Nothing scheduled for this day.')
    expect(screen.queryByText(/Your data is only on this device/)).toBeNull()
  })
})

describe('App (routes and header)', () => {
  const title = (name: string) => screen.findByRole('heading', { level: 1, name })

  it.each([
    ['/today', 'Today'],
    ['/meds', 'Meds'],
    ['/history', 'History'],
  ])('%s shows its title, marks its tab and offers Settings', async (path, name) => {
    renderAt(path)
    expect(await title(name)).toBeTruthy()
    expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
  })

  it('Settings has a back button and no tab marked', async () => {
    renderAt('/settings')
    expect(await title('Settings')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Settings' })).toBeNull()
    for (const name of ['Today', 'Meds', 'History']) {
      expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBeNull()
    }
    screen.getByRole('button', { name: 'Back' }).click()
    expect(await title('Today')).toBeTruthy()
  })

  it('Add med is its own screen, and Back returns to the list', async () => {
    renderAt('/meds')
    ;(await screen.findByRole('button', { name: '+ Add' })).click()
    expect(await title('Add med')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Meds' }).getAttribute('aria-current')).toBe('page')
    screen.getByRole('button', { name: 'Back' }).click()
    expect(await title('Meds')).toBeTruthy()
  })

  it('Today titles another selected day by its date', async () => {
    renderAt('/today?date=2026-01-06')
    expect(await title('Tue, Jan 6')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  it('an unknown address goes to Today', async () => {
    renderAt('/nope')
    expect(await title('Today')).toBeTruthy()
  })
})

describe('App (auth gate)', () => {
  it('no session → Welcome with three buttons, no tab bar', () => {
    session.value = { loading: false, user: null }
    renderAt('/today')
    for (const name of ['Create profile', 'Sign in', 'Continue without profile']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('link', { name: 'Meds' })).toBeNull()
  })

  it('Continue without profile starts a guest session', () => {
    session.value = { loading: false, user: null }
    renderAt('/today')
    screen.getByRole('button', { name: 'Continue without profile' }).click()
    expect(auth.continueAsGuest).toHaveBeenCalled()
  })
})
