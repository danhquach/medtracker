import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { readGuestBannerDismissedAt, shouldShowGuestBanner, writeGuestBannerDismissedAt } from './guestBanner.ts'

export default function GuestBanner({ guest }: { guest: boolean }) {
  const navigate = useNavigate()
  const [dismissedAt, setDismissedAt] = useState(readGuestBannerDismissedAt)
  const [mountedAt] = useState(Date.now)
  if (!shouldShowGuestBanner(guest, dismissedAt, mountedAt)) return null
  return (
    <section className="banner" aria-label="Guest mode">
      <p>Your data is only on this device. Create a profile to secure it and use it on other devices.</p>
      <div className="row">
        <button className="primary" onClick={() => navigate('/settings')}>
          Create profile
        </button>
        <button
          onClick={() => {
            const now = Date.now()
            writeGuestBannerDismissedAt(now)
            setDismissedAt(now)
          }}
        >
          Not now
        </button>
      </div>
    </section>
  )
}
