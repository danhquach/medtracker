import type { User } from '@supabase/supabase-js'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings'

const renderSettings = (at = '/settings') =>
  render(
    <MemoryRouter initialEntries={[at]}>
      <Settings />
    </MemoryRouter>,
  )

const m = vi.hoisted(() => ({
  session: { user: null as unknown },
  getProfile: vi.fn(),
  updateProfile: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
  unsynced: vi.fn(() => Promise.resolve(0)),
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
}))
vi.mock('../../data/meds', () => ({ listMeds: () => Promise.resolve([]), listSchedules: () => Promise.resolve([]) }))
vi.mock('../auth/auth', async (orig) => ({
  ...(await orig<typeof import('../auth/auth')>()),
  signOut: m.signOut,
  unsyncedBeforeSignOut: m.unsynced,
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
  renderSettings()
  await screen.findByLabelText(/Snooze length/)
}

describe('Settings', () => {
  it('saves the time zone', async () => {
    await loaded()
    fireEvent.change(screen.getByLabelText(/Time zone/), { target: { value: 'Europe/London' } })
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ time_zone: 'Europe/London' }))
  })

  it('shows why a time zone save failed', async () => {
    m.updateProfile.mockRejectedValueOnce(new Error('bad zone'))
    await loaded()
    fireEvent.change(screen.getByLabelText(/Time zone/), { target: { value: 'Europe/London' } })
    expect((await screen.findByRole('alert')).textContent).toContain('bad zone')
  })

  it('saves snooze length, suggestions toggle and nickname', async () => {
    await loaded()
    fireEvent.change(screen.getByLabelText(/Snooze length/), { target: { value: '30' } })
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ snooze_minutes: 30 }))
    fireEvent.click(screen.getByRole('switch', { name: /suggestions/i }))
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ suggestions_enabled: false }))
  })

  it('saves the nickname on leaving the field, with no Save button, and confirms it', async () => {
    await loaded()
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
    const input = screen.getByLabelText(/Nickname/)
    fireEvent.change(input, { target: { value: ' Alex ' } })
    fireEvent.blur(input)
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ nickname: 'Alex' }))
    expect((await screen.findByText('Saved')).closest('label')?.textContent).toContain('Nickname')
  })

  it('does not save an unchanged nickname', async () => {
    await loaded()
    fireEvent.blur(screen.getByLabelText(/Nickname/))
    expect(m.updateProfile).not.toHaveBeenCalled()
  })

  it('confirms every setting with Saved next to it', async () => {
    await loaded()
    fireEvent.change(screen.getByLabelText(/Snooze length/), { target: { value: '30' } })
    expect((await screen.findByText('Saved')).closest('label')?.textContent).toContain('Snooze length')
    fireEvent.click(screen.getByRole('switch', { name: /suggestions/i }))
    await waitFor(() => expect(screen.getByText('Saved').closest('label')?.textContent).toContain('suggestions'))
  })

  it('searches time zones and only saves a real zone; a partial entry reverts on leaving', async () => {
    await loaded()
    const input = screen.getByLabelText(/Time zone/) as HTMLInputElement
    expect(input.getAttribute('list')).toBe('st-zones')
    expect(document.querySelector('#st-zones option[value="Europe/London"]')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'Europe/Lon' } })
    fireEvent.blur(input)
    expect(m.updateProfile).not.toHaveBeenCalled()
    expect(input.value).toBe('America/Toronto')
  })

  it("offers the device's detected time zone when it differs", async () => {
    m.getProfile.mockResolvedValue({ ...profile, time_zone: 'Pacific/Auckland' })
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: `Use this device's time zone (${detected})` }))
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledWith({ time_zone: detected }))
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

  it('marks the device switch busy while it changes', async () => {
    m.enablePush.mockImplementation(() => new Promise(() => {}))
    await loaded()
    const sw = screen.getByRole('switch', { name: /on this device/i })
    fireEvent.click(sw)
    await waitFor(() => expect(sw.getAttribute('aria-busy')).toBe('true'))
  })

  it.each(['off', 'denied', 'unsupported'])('hides Send test notification when notifications are %s', async (state) => {
    m.deviceState.state = state
    await loaded()
    expect(screen.queryByRole('button', { name: 'Send test notification' })).toBeNull()
  })

  it('says at the top that reminders are on, with the time zone city', async () => {
    m.deviceState.state = 'on'
    await loaded()
    expect(screen.getByText('Reminders are on')).toBeTruthy()
    expect(screen.getByText('This device · Toronto time')).toBeTruthy()
  })

  it.each([
    ['off', 'Reminders are off on this device'],
    ['denied', "Reminders can't reach this device"],
    ['unsupported', "This browser can't show reminders"],
  ])('says at the top when reminders are %s', async (state, title) => {
    m.deviceState.state = state
    await loaded()
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.queryByText('Reminders are on')).toBeNull()
  })

  it('describes each setting in plain language', async () => {
    m.deviceState.state = 'on'
    await loaded()
    const desc = (el: HTMLElement) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent
    expect(desc(screen.getByRole('switch', { name: /on this device/i }))).toMatch(/dose is due/)
    expect(desc(screen.getByLabelText(/Snooze length/))).toMatch(/Snooze waits/)
    expect(desc(screen.getByLabelText(/Time zone/))).toMatch(/Dose times follow/)
    expect(desc(screen.getByRole('switch', { name: /suggestions/i }))).toMatch(/as you type/)
  })

  it('shows the Android lock-screen and battery tip', async () => {
    m.deviceState.state = 'on'
    await loaded()
    expect(screen.getByText(/lock screen/)).toBeTruthy()
    expect(screen.getByText(/Unrestricted/)).toBeTruthy()
  })

  it('hides the Android tip when the browser cannot receive notifications', async () => {
    m.deviceState.state = 'unsupported'
    await loaded()
    expect(screen.queryByText(/Unrestricted/)).toBeNull()
    expect(screen.queryByText(/lock screen/)).toBeNull()
  })

  it('sends a local test notification', async () => {
    m.deviceState.state = 'on'
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

  it('opens the create-profile form directly from the guest banner link', async () => {
    asUser({ is_anonymous: true })
    renderSettings('/settings?account=create')
    expect(await screen.findByLabelText('Email')).toBeTruthy()
    expect(screen.getByText('At least 8 characters.')).toBeTruthy()
  })

  it('signed-in user can sign out', async () => {
    await loaded()
    const confirm = vi.spyOn(window, 'confirm')
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(m.signOut).toHaveBeenCalled())
    expect(confirm).not.toHaveBeenCalled()
  })

  it('sign-out with pending changes asks before clearing', async () => {
    m.unsynced.mockResolvedValueOnce(2)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(confirm).toHaveBeenCalledWith("2 changes haven't synced and will be lost. Sign out anyway?"))
    expect(m.signOut).not.toHaveBeenCalled()
  })

  it('sign-out with pending changes proceeds when confirmed', async () => {
    m.unsynced.mockResolvedValueOnce(1)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
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

  it('applies only the latest of two out-of-order saves', async () => {
    let first!: (v: unknown) => void
    m.updateProfile.mockImplementationOnce(() => new Promise((r) => (first = r)))
    await loaded()
    fireEvent.change(screen.getByLabelText(/Snooze length/), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('switch', { name: /suggestions/i }))
    await waitFor(() => expect(m.updateProfile).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((screen.getByRole('switch', { name: /suggestions/i }) as HTMLInputElement).checked).toBe(false))
    first({ ...profile, snooze_minutes: 30, suggestions_enabled: true }) // stale row resolves last
    await new Promise((r) => setTimeout(r, 20))
    expect((screen.getByRole('switch', { name: /suggestions/i }) as HTMLInputElement).checked).toBe(false)
  })

  it('ignores a second device toggle click while one is pending', async () => {
    let done!: (v: string) => void
    m.enablePush.mockImplementation(() => new Promise((r) => (done = r)))
    await loaded()
    const sw = screen.getByRole('switch', { name: /on this device/i }) as HTMLInputElement
    fireEvent.click(sw)
    fireEvent.click(sw)
    expect(m.enablePush).toHaveBeenCalledTimes(1)
    expect(sw.disabled).toBe(true)
    done('ok')
    await waitFor(() => expect(sw.disabled).toBe(false))
  })

  it('refetches the profile when a save fails so the UI shows server truth', async () => {
    m.updateProfile.mockRejectedValueOnce(new Error('regenerate failed'))
    m.getProfile.mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile, time_zone: 'Europe/London' })
    await loaded()
    fireEvent.change(screen.getByLabelText(/Time zone/), { target: { value: 'Europe/London' } })
    await screen.findByRole('alert')
    await waitFor(() => expect((screen.getByLabelText(/Time zone/) as HTMLInputElement).value).toBe('Europe/London'))
    expect(m.getProfile).toHaveBeenCalledTimes(2)
  })

  it('shows an error with Retry when the profile cannot load', async () => {
    m.getProfile.mockRejectedValueOnce(new Error('offline'))
    renderSettings()
    expect((await screen.findByRole('alert')).textContent).toContain('offline')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByLabelText(/Snooze length/)).toBeTruthy()
  })

  describe('delete profile', () => {
    const open = async () => {
      await loaded()
      fireEvent.click(screen.getByRole('button', { name: 'Delete profile' }))
    }

    it('sits in a separate danger section', async () => {
      await loaded()
      const section = screen.getByRole('region', { name: 'Danger zone' })
      expect(section.contains(screen.getByRole('button', { name: 'Delete profile' }))).toBe(true)
    })

    it('moves focus into the dialog, keeps Tab inside, and returns focus on Escape', async () => {
      await open()
      const dialog = screen.getByRole('dialog', { name: 'Delete profile?' })
      const input = screen.getByLabelText('Type DELETE to confirm')
      expect(document.activeElement).toBe(input)
      const cancel = screen.getByRole('button', { name: 'Cancel' })
      cancel.focus()
      fireEvent.keyDown(cancel, { key: 'Tab' })
      expect(document.activeElement).toBe(input)
      fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
      expect(document.activeElement).toBe(cancel)
      fireEvent.keyDown(dialog, { key: 'Escape' })
      expect(screen.queryByRole('dialog')).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete profile' })))
    })

    it('requires typing DELETE, then deletes and signs out', async () => {
      await open()
      const confirm = screen.getByRole('button', { name: 'Delete my profile' }) as HTMLButtonElement
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
      fireEvent.click(screen.getByRole('button', { name: 'Delete my profile' }))
      expect((await screen.findByRole('alert')).textContent).toContain('boom')
      expect(m.signOut).not.toHaveBeenCalled()
    })

    it('falls back to a local sign-out when the server-side one fails', async () => {
      m.signOut.mockRejectedValueOnce(new Error('user gone'))
      await open()
      fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
      fireEvent.click(screen.getByRole('button', { name: 'Delete my profile' }))
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
