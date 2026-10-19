import { useState } from 'react'
import { createProfile, GUEST_LEFT_BEHIND, signIn, signUp } from './auth'

export type CredentialsMode = 'signup' | 'signin' | 'upgrade'

const LABEL: Record<CredentialsMode, string> = { signup: 'Create profile', signin: 'Sign in', upgrade: 'Create profile' }

export default function CredentialsForm({
  mode,
  guest = false,
  onCancel,
}: {
  mode: CredentialsMode
  guest?: boolean
  onCancel?: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const needsGuestConfirm = mode === 'signin' && guest && !confirmed

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (needsGuestConfirm) {
      setConfirmed(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (mode === 'signin') await signIn(email, password)
      else if (mode === 'signup') {
        if (!(await signUp(email, password))) setNotice('Check your email to confirm')
      } else if ((await createProfile(email, password)) === 'confirm') setNotice('Check your email to confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  if (notice) return <p role="status">{notice}</p>

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
          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {confirmed && <p role="alert">{GUEST_LEFT_BEHIND}</p>}
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
