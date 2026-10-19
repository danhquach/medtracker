import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { DeviceNotificationState } from '../notifications/useDeviceNotificationState'
import { readGuestBannerDismissedAt, shouldShowGuestBanner, writeGuestBannerDismissedAt } from '../auth/guestBanner.ts'

export interface LowMed {
  id: string
  name: string
  daysLeft: number | null
}

/** Everything on Today that wants the user's attention, in one card below the doses. Each item links to its fix. */
export default function NeedsAttention({
  guest,
  notifications,
  enableError,
  onTurnOn,
  low,
}: {
  guest: boolean
  notifications: DeviceNotificationState | null
  enableError: string | null
  onTurnOn: () => void
  low: LowMed[]
}) {
  const [dismissedAt, setDismissedAt] = useState(readGuestBannerDismissedAt)
  const [mountedAt] = useState(Date.now)
  const showGuest = shouldShowGuestBanner(guest, dismissedAt, mountedAt)
  const showNotifications = notifications !== null && notifications !== 'on'
  if (!showGuest && !showNotifications && low.length === 0) return null

  return (
    <section className="attention" aria-labelledby="attention-title">
      <h2 id="attention-title">Needs attention</h2>
      <ul>
        {showGuest && (
          <li>
            <p>Your data is only on this device. Create a profile to secure it and use it on other devices.</p>
            <div className="row">
              <Link to="/settings?account=create">Create profile</Link>
              <button
                type="button"
                onClick={() => {
                  const now = Date.now()
                  writeGuestBannerDismissedAt(now)
                  setDismissedAt(now)
                }}
              >
                Not now
              </button>
            </div>
          </li>
        )}
        {showNotifications && (
          <li>
            <p>Notifications are off on this device</p>
            {notifications === 'off' && (
              <button type="button" onClick={onTurnOn}>
                Turn on
              </button>
            )}
            {notifications === 'denied' && <p>Notifications are blocked. Enable them for this site in your browser settings.</p>}
            {enableError && <p role="alert">{enableError}</p>}
          </li>
        )}
        {low.map((m) => (
          <li key={m.id}>
            <p className="low">
              {m.name}: running low{m.daysLeft !== null ? ` (about ${Math.max(0, Math.floor(m.daysLeft))} days left)` : ''}
            </p>
            <Link to={`/meds/${m.id}/edit`} aria-label={`Update ${m.name} stock`}>
              Update stock
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
