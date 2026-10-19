import { useCallback, useEffect, useRef, useState } from 'react'
import { listMeds, listSchedules } from '../../data/meds'
import { getProfile, markTimeZoneChosen, updateProfile, type ProfilePatch } from '../../data/profile'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { deviceLabel, enablePushOnThisDevice, setDeviceEnabled } from '../../push/subscribe'
import { isGuest, needsPasswordFinish, signOut } from '../auth/auth'
import CredentialsForm from '../auth/CredentialsForm'
import LoadError from '../auth/LoadError'
import SetPasswordForm from '../auth/SetPasswordForm'
import { useSession } from '../auth/useSession'
import { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { toCsv } from './exportCsv'

const SNOOZE = [5, 10, 15, 30, 60] as const
export const BATTERY_TIP = "Reminders late? In Android settings, set Chrome's battery use to Unrestricted."

function timeZones(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return all.includes(current) ? all : [current, ...all]
}

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export default function Settings() {
  const { user } = useSession()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [nickname, setNickname] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [guestView, setGuestView] = useState<'menu' | 'signin' | 'create'>('menu')
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const device = useDeviceNotificationState()

  const [profileError, setProfileError] = useState<string | null>(null)
  const [pendingDevice, setPendingDevice] = useState(false)
  const alive = useRef(true)
  const saveSeq = useRef(0)

  const loadProfile = useCallback(async () => {
    try {
      const p = await getProfile()
      if (!alive.current) return
      setProfile(p)
      setNickname(p.nickname ?? '')
      setProfileError(null)
    } catch (e) {
      console.error('profile load failed', e)
      if (alive.current) setProfileError(msg(e, 'Could not load your profile'))
    }
  }, [])

  useEffect(() => {
    alive.current = true
    queueMicrotask(() => void loadProfile())
    return () => {
      alive.current = false
    }
  }, [loadProfile])

  // Only the most recent save may write state; on failure, show what the server actually holds.
  async function save(patch: ProfilePatch, after?: () => void) {
    setError(null)
    const seq = ++saveSeq.current
    try {
      const saved = await updateProfile(patch)
      if (seq === saveSeq.current) setProfile(saved)
      after?.()
    } catch (e) {
      setError(msg(e, 'Could not save'))
      if (seq === saveSeq.current) await loadProfile()
    }
  }

  async function toggleDevice() {
    if (pendingDevice) return
    setPendingDevice(true)
    setError(null)
    setNotice(null)
    try {
      if (device.state === 'on') await setDeviceEnabled(false)
      else {
        const result = await enablePushOnThisDevice(deviceLabel())
        if (result === 'ok') await setDeviceEnabled(true)
        else setNotice(result === 'denied' ? 'Notifications are blocked for this site.' : 'This browser cannot receive notifications.')
      }
    } catch (e) {
      setError(msg(e, 'Could not change notifications'))
    }
    device.refresh()
    setPendingDevice(false)
  }

  async function sendTest() {
    setError(null)
    try {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('Test', { body: 'Notifications are working on this device.' })
    } catch (e) {
      setError(msg(e, 'Could not show a test notification'))
    }
  }

  async function exportPlan() {
    setError(null)
    try {
      const [meds, schedules] = await Promise.all([listMeds(), listSchedules()])
      const url = URL.createObjectURL(new Blob([toCsv(meds, schedules)], { type: 'text/csv;charset=utf-8' }))
      const a = document.createElement('a')
      a.href = url
      a.download = 'medtracker-plan.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError(msg(e, 'Could not export'))
    }
  }

  async function doSignOut() {
    setError(null)
    try {
      await signOut()
    } catch (e) {
      setError(msg(e, 'Could not sign out'))
    }
  }

  async function deleteAccount() {
    setBusy(true)
    setError(null)
    try {
      const { error: fnError } = await supabase.functions.invoke('delete-account')
      if (fnError) throw fnError
      try {
        await signOut()
      } catch {
        await supabase.auth.signOut({ scope: 'local' })
      }
    } catch (e) {
      setError(msg(e, 'Could not delete the account'))
      setBusy(false)
    }
  }

  const guest = isGuest(user)

  return (
    <main className="stack">
      <h2>Settings</h2>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {profileError && !profile && <LoadError message={profileError} onRetry={() => void loadProfile()} />}
      {needsPasswordFinish(user, profile) && <SetPasswordForm />}

      <section className="stack" aria-labelledby="st-account">
        <h3 id="st-account">Account</h3>
        <p>{guest ? 'Guest' : (user?.email ?? '')}</p>
        {profile && (
          <>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                void save({ nickname: nickname.trim() || null })
              }}
            >
              <label>
                Nickname
                <input value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} />
              </label>
              <button type="submit">Save nickname</button>
            </form>
            <label>
              Time zone
              <select
                value={profile.time_zone}
                onChange={(e) => {
                  const tz = e.target.value
                  void save({ time_zone: tz }, () => user && markTimeZoneChosen(user.id))
                }}
              >
                {timeZones(profile.time_zone).map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        {guest ? (
          guestView === 'menu' ? (
            <div className="stack">
              <p>Your data is only on this device. Create a profile to secure it and use it on other devices.</p>
              <div className="row">
                <button type="button" className="primary" onClick={() => setGuestView('create')}>
                  Create profile
                </button>
                <button type="button" onClick={() => setGuestView('signin')}>
                  Sign in
                </button>
              </div>
            </div>
          ) : (
            <CredentialsForm
              mode={guestView === 'create' ? 'upgrade' : 'signin'}
              guest={guestView === 'signin'}
              onCancel={() => setGuestView('menu')}
            />
          )
        ) : (
          <button type="button" onClick={() => void doSignOut()}>
            Sign out
          </button>
        )}
      </section>

      <section className="stack" aria-labelledby="st-notif">
        <h3 id="st-notif">Notifications on this device</h3>
        {device.state === 'unsupported' && <p className="muted">This browser cannot receive notifications.</p>}
        {device.state === 'denied' && (
          <p role="status">Notifications are blocked. Allow them for this site in your browser settings, then reload.</p>
        )}
        {(device.state === 'on' || device.state === 'off') && (
          <label>
            <input type="checkbox" role="switch" checked={device.state === 'on'} disabled={pendingDevice} onChange={() => void toggleDevice()} /> Notifications
            on this device
          </label>
        )}
        <button type="button" onClick={() => void sendTest()}>
          Send test notification
        </button>
        <p className="muted">{BATTERY_TIP}</p>
      </section>

      {profile && (
        <section className="stack" aria-labelledby="st-prefs">
          <h3 id="st-prefs">Preferences</h3>
          <label>
            Snooze length
            <select
              value={profile.snooze_minutes}
              onChange={(e) => void save({ snooze_minutes: Number(e.target.value) as Profile['snooze_minutes'] })}
            >
              {SNOOZE.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              role="switch"
              checked={profile.suggestions_enabled}
              onChange={(e) => void save({ suggestions_enabled: e.target.checked })}
            />{' '}
            Medication name suggestions
          </label>
        </section>
      )}

      <section className="stack" aria-labelledby="st-data">
        <h3 id="st-data">Your data</h3>
        <button type="button" onClick={() => void exportPlan()}>
          Export med plan (CSV)
        </button>
        {!deleting ? (
          <button type="button" onClick={() => setDeleting(true)}>
            Delete account
          </button>
        ) : (
          <div role="dialog" aria-modal="true" aria-label="Delete account" className="stack">
            <p>This permanently deletes your account and all your medications and history. Type DELETE to confirm.</p>
            <input aria-label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <div className="row">
              <button type="button" disabled={confirmText !== 'DELETE' || busy} onClick={() => void deleteAccount()}>
                Delete my account
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setDeleting(false)
                  setConfirmText('')
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
