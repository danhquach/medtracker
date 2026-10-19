import type { User } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const m = vi.hoisted(() => ({
  session: { user: null as unknown },
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  markTimeZoneChosen: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  invoke: vi.fn(),
  localSignOut: vi.fn(() => Promise.resolve({ error: null })),
  deviceState: { state: 'off' as string | null },
  refresh: vi.fn(),
  enablePush: vi.fn(),
  setDeviceEnabled: vi.fn(() => Promise.resolve()),
  showNotification: vi.fn(() => Promise.resolve()),
}))

vi.mock('../auth/useSession', () => ({ useSession: () => ({ loading: false, user: m.session.user }) }))
vi.mock('../../data/profile', () => ({
  getProfile: m.getProfile,
  updateProfile: m.updateProfile,
  markTimeZoneChosen: m.markTimeZoneChosen,
}))
vi.mock('../../data/meds', () => ({ listMeds: () => Promise.resolve([]), listSchedules: () => Promise.resolve([]) }))
vi.mock('../auth/auth', async (orig) => ({
  ...(await orig<typeof import('../auth/auth')>()),
  signOut: m.signOut,
}))
vi.mock('../../lib/supabase', () => ({
  supabase: { functions: { invoke: m.invoke }, auth: { signOut: m.localSignOut } },
}))
vi.mock('../notifications/useDeviceNotificationState', () => ({
  useDeviceNotificationState: () => ({ state: m.deviceState.state, refresh: m.refresh }),
}))
vi.mock('../../push/subscribe', () => ({
  enablePushOnThisDevice: m.enablePush,
  setDeviceEnabled: m.setDeviceEnabled,
  deviceLabel: () => 'Chrome on macOS',
}))

const profile = {
  user_id: 'u1', nickname: 'Sam', time_zone: 'America/Toronto', snooze_minutes: 10,
  suggestions_enabled: true, password_set: true,
}
const asUser = (extra: Partial<User> = {}) => {
  m.session.user = { id: 'u1', email: 'a@b.c', is_anonymous: false, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  asUser()
  m.deviceState.state = 'off'
  m.getProfile.mockResolvedValue(profile)
  m.updateProfile.mockImplementation((patch) => Promise.resolve({ ...profile, ...patch }))
  m.invoke.mockResolvedValue({ data: {}, error: null })
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { ready: Promise.resolve({ showNotification: m.showNotification }) },
  })
})

const loaded = async () => {
  render(<Settings />)
  await screen.findByLabelText('Snooze length')
}

describe('Settings', () => {
  it('saves the time zone and marks it as chosen', async () => {
    await loaded()
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } })
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ time_zone: 'Europe/London' }))
    await waitFor(() => expect(m.markTimeZoneChosen).toHaveBeenCalledWith('u1'))
  })

  it('does not mark the zone chosen when the save fails', async () => {
    m.updateProfile.mockRejectedValueOnce(new Error('bad zone'))
    await loaded()
    fireEvent.change(screen.getByLabelText('Time zone'), { target: { value: 'Europe/London' } })
    expect((await screen.findByRole('alert')).textContent).toContain('bad zone')
    expect(m.markTimeZoneChosen).not.toHaveBeenCalled()
  })

  it('saves snooze length, suggestions toggle and nickname', async () => {
    await loaded()
    fireEvent.change(screen.getByLabelText('Snooze length'), { target: { value: '30' } })
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ snooze_minutes: 30 }))
    fireEvent.click(screen.getByRole('switch', { name: /suggestions/i }))
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ suggestions_enabled: false }))
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: ' Alex ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save nickname' }))
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ nickname: 'Alex' }))
  })

  it('turns notifications on for this device', async () => {
    m.enablePush.mockResolvedValue('ok')
    await loaded()
    fireEvent.click(screen.getByRole('switch', { name: /on this device/i }))
    await waitFor(() => expect(m.setDeviceEnabled).toHaveBeenCalledWith(true))
    expect(m.enablePush).toHaveBeenCalledWith('Chrome on macOS')
    expect(m.refresh).toHaveBeenCalled()
  })

  it('turns notifications off for this device', async () => {
    m.deviceState.state = 'on'
    await loaded()
    fireEvent.click(screen.getByRole('switch', { name: /on this device/i }))
    await waitFor(() => expect(m.setDeviceEnabled).toHaveBeenCalledWith(false))
    expect(m.enablePush).not.toHaveBeenCalled()
  })

  it('shows guidance instead of a toggle when permission is denied', async () => {
    m.deviceState.state = 'denied'
    await loaded()
    expect(screen.queryByRole('switch', { name: /on this device/i })).toBeNull()
    expect(screen.getByText(/blocked/i)).toBeTruthy()
  })

  it('sends a local test notification', async () => {
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Send test notification' }))
    await waitFor(() => expect(m.showNotification).toHaveBeenCalledWith('Test', expect.any(Object)))
  })

  it('shows the Android battery tip', async () => {
    await loaded()
    expect(screen.getByText(/Unrestricted/)).toBeTruthy()
  })

  it('guest sees Create profile and Sign in with the left-behind warning', async () => {
    asUser({ is_anonymous: true, email: undefined })
    await loaded()
    expect(screen.getByText('Guest')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@y.z' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect((await screen.findByRole('alert')).textContent).toContain('left behind')
  })

  it('guest can open the create-profile form', async () => {
    asUser({ is_anonymous: true })
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('signed-in user can sign out', async () => {
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(m.signOut).toHaveBeenCalled())
  })

  it('shows the password form when the password is not set yet', async () => {
    asUser({ email_confirmed_at: '2026-01-01', user_metadata: {} })
    m.getProfile.mockResolvedValue({ ...profile, password_set: false })
    await loaded()
    expect(await screen.findByRole('button', { name: 'Set your password' })).toBeTruthy()
  })

  describe('delete account', () => {
    const open = async () => {
      await loaded()
      fireEvent.click(screen.getByRole('button', { name: 'Delete account' }))
    }

    it('requires typing DELETE, then deletes and signs out', async () => {
      await open()
      const confirm = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
      expect(confirm.disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } })
      expect(confirm.disabled).toBe(true)
      fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
      expect(confirm.disabled).toBe(false)
      fireEvent.click(confirm)
      await waitFor(() => expect(m.signOut).toHaveBeenCalled())
      expect(m.invoke).toHaveBeenCalledWith('delete-account')
    })

    it('surfaces an error and does not sign out', async () => {
      m.invoke.mockResolvedValue({ data: null, error: new Error('boom') })
      await open()
      fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
      fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
      expect((await screen.findByRole('alert')).textContent).toContain('boom')
      expect(m.signOut).not.toHaveBeenCalled()
    })

    it('falls back to a local sign-out when the server-side one fails', async () => {
      m.signOut.mockRejectedValueOnce(new Error('user gone'))
      await open()
      fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
      fireEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
      await waitFor(() => expect(m.localSignOut).toHaveBeenCalledWith({ scope: 'local' }))
    })
  })

  it('exports the plan as medtracker-plan.csv via a blob URL', async () => {
    const create = vi.fn(() => 'blob:x')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }))
    const names: string[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download)
    })
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: /Export med plan/ }))
    await waitFor(() => expect(names).toEqual(['medtracker-plan.csv']))
    expect(create).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:x')
    click.mockRestore()
  })
})
