import { useState } from 'react'
import { continueAsGuest } from './auth'
import CredentialsForm from './CredentialsForm'
import EmailLinkNotice from './EmailLinkNotice'

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
        <button
          className="primary"
          onClick={() => {
            setError(null)
            continueAsGuest().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not start'))
          }}
        >
          Start now
        </button>
        <button onClick={() => setView('signin')}>Sign in</button>
        <button className="link" onClick={() => setView('signup')}>
          Create a profile
        </button>
        <p className="muted">No profile needed to start. Your data stays on this device until you create a profile.</p>
      </div>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
