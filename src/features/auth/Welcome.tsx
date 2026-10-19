import { useState } from 'react'
import { continueAsGuest } from './auth'
import CredentialsForm from './CredentialsForm'

export default function Welcome() {
  const [view, setView] = useState<'menu' | 'signup' | 'signin'>('menu')
  const [error, setError] = useState<string | null>(null)

  if (view !== 'menu') {
    return (
      <main className="welcome">
        <h1>MedTracker</h1>
        <CredentialsForm mode={view} onCancel={() => setView('menu')} />
      </main>
    )
  }

  return (
    <main className="welcome">
      <h1>MedTracker</h1>
      <p className="muted">Keep track of your medications and never miss a dose.</p>
      <div className="stack">
        <button className="primary" onClick={() => setView('signup')}>
          Create profile
        </button>
        <button onClick={() => setView('signin')}>Sign in</button>
        <button
          onClick={() => {
            setError(null)
            continueAsGuest().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not start'))
          }}
        >
          Continue without profile
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </main>
  )
}
