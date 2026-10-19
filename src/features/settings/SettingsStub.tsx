import { useEffect, useState } from 'react'
import { getProfile } from '../../data/profile'
import type { Profile } from '../../lib/types'
import { isGuest, needsPasswordFinish } from '../auth/auth'
import CredentialsForm from '../auth/CredentialsForm'
import SetPasswordForm from '../auth/SetPasswordForm'
import { useSession } from '../auth/useSession'

/** Placeholder until the Settings task (Task 10). */
export default function SettingsStub() {
  const { user } = useSession()
  const [profile, setProfile] = useState<Profile | null>(null)
  useEffect(() => {
    getProfile().then(setProfile, (e) => console.error('profile load failed', e))
  }, [])
  return (
    <main>
      <h2>Settings</h2>
      {needsPasswordFinish(user, profile) && <SetPasswordForm />}
      {isGuest(user) && (
        <section className="stack">
          <p>Your data is only on this device. Create a profile to secure it and use it on other devices.</p>
          <CredentialsForm mode="upgrade" />
        </section>
      )}
    </main>
  )
}
