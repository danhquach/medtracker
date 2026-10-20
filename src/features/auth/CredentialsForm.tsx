import { useState } from 'react'
import { changes } from '../../components/syncCopy'
import { pendingCount } from '../../data/offline/sync'
import { createProfile, GUEST_LEFT_BEHIND, signIn, signUp } from './auth'

export type CredentialsMode = 'signup' | 'signin' | 'upgrade'

const LABEL: Record<CredentialsMode, string> = { signup: 'Create profile', signin: 'Sign in', upgrade: 'Create profile' }

export default function CredentialsForm({
  mode,
  guest = false,
  onCancel,
  onSignIn,
}: {
  mode: CredentialsMode
  guest?: boolean
  onCancel?: () => void
  /** Shown as "Back to sign in" once sign-up is waiting on email confirmation. */
  onSignIn?: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [unsynced, setUnsynced] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const needsGuestConfirm = mode === 'signin' && guest && !confirmed
  const newPassword = mode !== 'signin'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (needsGuestConfirm) {
      setUnsynced(await pendingCount())
      setConfirmed(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') await signIn(email, password)
      else if (mode === 'signup') {
        if (!(await signUp(email, password))) setNotice(`Check ${email} for a link to confirm your profile, then sign in.`)
      } else if ((await createProfile(email, password)) === 'confirm')
        setNotice(`Check ${email} for a link to confirm your profile. Your data stays on this device until then.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (notice) {
    const back = onSignIn ?? onCancel
    return (
      <div className="stack">
        <p role="status">{notice}</p>
        {back && (
          <button type="button" onClick={back}>
            {onSignIn ? 'Back to sign in' : 'Back'}
          </button>
        )}
      </div>
    )
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete={newPassword ? 'new-password' : 'current-password'}
          required
          minLength={8}
          aria-describedby={newPassword ? 'password-rule' : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {newPassword && (
        <p id="password-rule" className="muted hint">
          At least 8 characters.
        </p>
      )}
      {confirmed && (
        <p role="alert">
          {GUEST_LEFT_BEHIND}
          {unsynced > 0 && ` ${changes(unsynced)} made offline ${unsynced === 1 ? "hasn't" : "haven't"} synced and will be lost.`}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <button type="submit" className="primary" disabled={busy}>
          {confirmed ? 'Continue' : LABEL[mode]}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Back
          </button>
        )}
      </div>
    </form>
  )
}
