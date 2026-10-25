import { useState } from 'react'
import type { Profile } from '../../lib/types'
import { isNativeApp, showTestReminder } from '../../native/reminders'
import { deviceLabel, enablePushOnThisDevice, setDeviceEnabled } from '../../push/subscribe'
import { Button } from '../../components/Button'
import { Row, RowGroup } from '../../components/layout'
import type { useDeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { msg } from './msg'
import Saved, { type SaveSetting, type SettingKey } from './Saved'

const SNOOZE = [5, 10, 15, 30, 60] as const
export const ANDROID_TIP =
  "On Android: in Notifications settings, let MedTracker show on the lock screen, and set Chrome's battery use to Unrestricted so reminders aren't late."
const APP_TIP = 'Reminders are set on this phone, so they ring on time even offline. Keep the notification volume up to hear them.'

const ZONES: [zone: string, label: string][] = [
  ['America/St_Johns', 'Newfoundland (NT) — St. John’s'],
  ['America/Halifax', 'Atlantic (AT) — Halifax'],
  ['America/Toronto', 'Eastern (ET) — Toronto, New York'],
  ['America/Winnipeg', 'Central (CT) — Winnipeg, Chicago'],
  ['America/Edmonton', 'Mountain (MT) — Edmonton, Denver'],
  ['America/Phoenix', 'Arizona (MST, no daylight saving) — Phoenix'],
  ['America/Vancouver', 'Pacific (PT) — Vancouver, Los Angeles'],
  ['America/Anchorage', 'Alaska (AKT) — Anchorage'],
  ['Pacific/Honolulu', 'Hawaii (HST) — Honolulu'],
]

// The saved and detected zones are always valid choices, even when the short list omits them (e.g. "Europe/London").
function timeZones(...known: (string | null)[]): [string, string][] {
  const listed = new Set(ZONES.map(([z]) => z))
  const extra = [...new Set(known.filter((z): z is string => !!z && !listed.has(z)))]
  return [...extra.map((z): [string, string] => [z, z.replace(/_/g, ' ')]), ...ZONES]
}

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}

export default function RemindersSection({
  device,
  profile,
  saved,
  save,
  onError,
  onNotice,
}: {
  device: ReturnType<typeof useDeviceNotificationState>
  profile: Profile | null
  saved: SettingKey | null
  save: SaveSetting
  onError: (error: string | null) => void
  onNotice: (notice: string | null) => void
}) {
  const [pendingDevice, setPendingDevice] = useState(false)

  async function toggleDevice() {
    if (pendingDevice) return
    setPendingDevice(true)
    onError(null)
    onNotice(null)
    try {
      if (device.state === 'on') await setDeviceEnabled(false)
      else {
        const result = await enablePushOnThisDevice(deviceLabel())
        if (result === 'ok') await setDeviceEnabled(true)
        else onNotice(result === 'denied' ? 'Notifications are blocked for this site.' : 'This browser cannot receive notifications.')
      }
    } catch (e) {
      onError(msg(e, 'Could not change notifications'))
    }
    device.refresh()
    setPendingDevice(false)
  }

  async function sendTest() {
    onError(null)
    try {
      if (isNativeApp()) return await showTestReminder()
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('Test', { body: 'Notifications are working on this device.' })
    } catch (e) {
      onError(msg(e, 'Could not show a test notification'))
    }
  }

  function saveZone(tz: string) {
    if (profile && tz !== profile.time_zone) void save({ time_zone: tz })
  }

  const detectedZone = deviceZone()
  const zones = profile ? timeZones(profile.time_zone, detectedZone) : []

  return (
    <section className="settings-group" aria-labelledby="st-reminders">
      <h3 id="st-reminders">Reminders & dose times</h3>
      <RowGroup>
        {device.state === 'unsupported' && <p className="muted">This browser cannot receive notifications.</p>}
        {device.state === 'denied' && (
          <p role="status">
            {isNativeApp()
              ? 'Notifications are blocked. Allow them for MedTracker in Android settings, then come back.'
              : 'Notifications are blocked. Allow them for this site in your browser settings, then reload.'}
          </p>
        )}
        {(device.state === 'on' || device.state === 'off') && (
          <Row htmlFor="st-device" name="Notifications on this device" desc="Alerts you when a dose is due.">
            <input
              id="st-device"
              type="checkbox"
              role="switch"
              aria-describedby="st-device-desc"
              checked={device.state === 'on'}
              disabled={pendingDevice}
              aria-busy={pendingDevice}
              onChange={() => void toggleDevice()}
            />
          </Row>
        )}
        {device.state === 'on' && (
          <Row desc="Check that alerts arrive on this device." wide>
            <Button onClick={() => void sendTest()}>
              Send test notification
            </Button>
          </Row>
        )}
        {profile && (
          <Row
            htmlFor="st-snooze"
            name={
              <>
                Snooze length <Saved show={saved === 'snooze_minutes'} />
              </>
            }
            desc="How long Snooze waits before reminding you again. A reminder you don't answer also repeats this often, up to 5 times."
          >
            <select
              id="st-snooze"
              aria-describedby="st-snooze-desc"
              value={profile.snooze_minutes}
              onChange={(e) => void save({ snooze_minutes: Number(e.target.value) as Profile['snooze_minutes'] })}
            >
              {SNOOZE.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </Row>
        )}
        {profile && (
          <Row
            htmlFor="st-zone"
            name={
              <>
                Time zone <Saved show={saved === 'time_zone'} />
              </>
            }
            desc="Dose times follow this time zone."
            wide
          >
            <select
              id="st-zone"
              aria-describedby="st-zone-desc"
              value={profile.time_zone}
              onChange={(e) => saveZone(e.target.value)}
            >
              {zones.map(([z, label]) => (
                <option key={z} value={z}>
                  {label}
                </option>
              ))}
            </select>
            {detectedZone && detectedZone !== profile.time_zone && (
              <Button onClick={() => saveZone(detectedZone)}>
                Use this device's time zone ({detectedZone})
              </Button>
            )}
          </Row>
        )}
      </RowGroup>
      {device.state !== 'unsupported' && <p className="muted settings-note">{isNativeApp() ? APP_TIP : ANDROID_TIP}</p>}
    </section>
  )
}
