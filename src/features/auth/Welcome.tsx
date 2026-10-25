import { useState } from 'react'
import { continueAsGuest } from './auth'
import CredentialsForm from './CredentialsForm'
import EmailLinkNotice from './EmailLinkNotice'
import { Button } from '../../components/Button'

export default function Welcome() {
  const [view, setView] = useState<'menu' | 'signup' | 'signin'>('menu')
  const [error, setError] = useState<string | null>(null)

  if (view !== 'menu') {
    return (
      <main className="welcome">
        <h1>MedTracker</h1>
        <CredentialsForm mode={view} onCancel={() => setView('menu')} onSignIn={() => setView('signin')} />
      </main>
    )
  }

  return (
    <main className="welcome">
      <h1>MedTracker</h1>
      <EmailLinkNotice />
      <p className="muted">Keep track of your medications and never miss a dose.</p>
      <div className="stack">
        <Button
          variant="primary"
          onClick={() => {
            setError(null)
            continueAsGuest().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not start'))
          }}
        >
          Start now
        </Button>
        <Button onClick={() => setView('signin')}>Sign in</Button>
        <Button variant="link" onClick={() => setView('signup')}>
          Create a profile
        </Button>
        <p className="muted">No profile needed to start. Your data stays on this device until you create a profile.</p>
      </div>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
