import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listMeds, listSchedules } from '../../data/meds'
import { getProfile, markTimeZoneChosen, updateProfile, type ProfilePatch } from '../../data/profile'
import { supabase } from '../../lib/supabase'
import type { Profile } from '../../lib/types'
import { useGoBack } from '../../lib/useGoBack'
import { deviceLabel, enablePushOnThisDevice, setDeviceEnabled } from '../../push/subscribe'
import { isGuest, needsPasswordFinish, signOut } from '../auth/auth'
import CredentialsForm from '../auth/CredentialsForm'
import LoadError from '../auth/LoadError'
import SetPasswordForm from '../auth/SetPasswordForm'
import { useSession } from '../auth/useSession'
import { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { csvBlob, toCsv } from './exportCsv'

const SNOOZE = [5, 10, 15, 30, 60] as const
export const BATTERY_TIP = "Reminders late? In Android settings, set Chrome's battery use to Unrestricted."

// The saved and detected zones are always valid choices, even when the list omits them (e.g. "UTC").
function timeZones(...known: (string | null)[]): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set([...known.filter((z): z is string => !!z), ...all])]
}

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

type SettingKey = keyof ProfilePatch

const Saved = ({ show }: { show: boolean }) => (
  <span className="saved" role="status">
    {show ? 'Saved' : ''}
  </span>
)

const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

export default function Settings() {
  const { user } = useSession()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [nickname, setNickname] = useState('')
  const [zoneText, setZoneText] = useState('')
  const [saved, setSaved] = useState<SettingKey | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  // A URL param, not state, so the phone's Back button closes the form instead of leaving Settings.
  const [params, setParams] = useSearchParams()
  const account = params.get('account')
  const guestView = account === 'signin' || account === 'create' ? account : 'menu'
  const closeGuestForm = useGoBack('/settings')
  const setGuestView = (v: 'menu' | 'signin' | 'create') => (v === 'menu' ? closeGuestForm() : setParams({ account: v }))
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleteButton = useRef<HTMLButtonElement>(null)
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
      setZoneText(p.time_zone)
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

  // Every setting saves on change. Only the most recent save may write state; on failure, show what the server actually holds.
  async function save(patch: ProfilePatch, after?: () => void) {
    setError(null)
    setSaved(null)
    const seq = ++saveSeq.current
    try {
      const row = await updateProfile(patch)
      if (seq === saveSeq.current) {
        setProfile(row)
        setZoneText(row.time_zone)
        setSaved(Object.keys(patch)[0] as SettingKey)
      }
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
      const url = URL.createObjectURL(csvBlob(toCsv(meds, schedules)))
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

  function saveNickname() {
    const next = nickname.trim() || null
    if (profile && next !== (profile.nickname ?? null)) void save({ nickname: next })
  }

  function saveZone(tz: string) {
    if (profile && tz !== profile.time_zone) void save({ time_zone: tz }, () => user && markTimeZoneChosen(user.id))
  }

  async function deleteProfile() {
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
      setError(msg(e, 'Could not delete the profile'))
      setBusy(false)
    }
  }

  const guest = isGuest(user)
  const detectedZone = deviceZone()
  const zones = profile ? timeZones(profile.time_zone, detectedZone) : []

  return (
    <main className="stack">
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {profileError && !profile && <LoadError message={profileError} onRetry={() => void loadProfile()} />}
      {needsPasswordFinish(user, profile) && <SetPasswordForm />}

      <section className="stack" aria-labelledby="st-profile">
        <h3 id="st-profile">Profile</h3>
        <p>{guest ? 'Guest' : (user?.email ?? '')}</p>
        {profile && (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                saveNickname()
              }}
            >
              <label>
                Nickname <Saved show={saved === 'nickname'} />
                <input value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} onBlur={saveNickname} />
              </label>
            </form>
            <label>
              Time zone <Saved show={saved === 'time_zone'} />
              <input
                list="st-zones"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="st-zone-hint"
                value={zoneText}
                onChange={(e) => {
                  setZoneText(e.target.value)
                  if (zones.includes(e.target.value)) saveZone(e.target.value)
                }}
                onBlur={() => setZoneText(profile.time_zone)}
              />
            </label>
            <datalist id="st-zones">
              {zones.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <p id="st-zone-hint" className="muted hint">
              Type a city to search, for example Toronto.
            </p>
            {detectedZone && detectedZone !== profile.time_zone && (
              <button type="button" onClick={() => saveZone(detectedZone)}>
                Use this device's time zone ({detectedZone})
              </button>
            )}
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
            <input
              type="checkbox"
              role="switch"
              checked={device.state === 'on'}
              disabled={pendingDevice}
              aria-busy={pendingDevice}
              onChange={() => void toggleDevice()}
            />{' '}
            Notifications on this device
          </label>
        )}
        {device.state === 'on' && (
          <button type="button" onClick={() => void sendTest()}>
            Send test notification
          </button>
        )}
        {device.state !== 'unsupported' && <p className="muted">{BATTERY_TIP}</p>}
      </section>

      {profile && (
        <section className="stack" aria-labelledby="st-prefs">
          <h3 id="st-prefs">Preferences</h3>
          <label>
            Snooze length <Saved show={saved === 'snooze_minutes'} />
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
            Medication name suggestions <Saved show={saved === 'suggestions_enabled'} />
          </label>
        </section>
      )}

      <section className="stack" aria-labelledby="st-data">
        <h3 id="st-data">Your data</h3>
        <button type="button" onClick={() => void exportPlan()}>
          Export med plan (CSV)
        </button>
      </section>

      <section className="stack danger-zone" aria-labelledby="st-danger">
        <h3 id="st-danger">Danger zone</h3>
        <button ref={deleteButton} type="button" className="danger" onClick={() => setDeleting(true)}>
          Delete profile
        </button>
        {deleting && (
          <DeleteDialog busy={busy} returnFocus={deleteButton} onConfirm={() => void deleteProfile()} onClose={() => setDeleting(false)} />
        )}
      </section>
    </main>
  )
}

/** Takes focus on open, keeps Tab inside, closes on Escape, and hands focus back to the opener. */
function DeleteDialog({
  busy,
  returnFocus,
  onConfirm,
  onClose,
}: {
  busy: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => {
    const opener = returnFocus.current
    ref.current?.querySelector('input')?.focus()
    return () => opener?.focus()
  }, [returnFocus])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>('input, button:not(:disabled)')]
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="st-delete-title" className="stack" onKeyDown={onKeyDown}>
      <h4 id="st-delete-title">Delete profile?</h4>
      <p>This permanently deletes your profile and all your medications and history. Type DELETE to confirm.</p>
      <input aria-label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
      <div className="row">
        <button type="button" className="danger" disabled={confirmText !== 'DELETE' || busy} aria-busy={busy} onClick={onConfirm}>
          {busy ? 'Deleting…' : 'Delete my profile'}
        </button>
        <button type="button" disabled={busy} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  )
}
