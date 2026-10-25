import { useEffect, useRef, useState } from 'react'
import { changes } from '../../components/syncCopy'
import { pendingCount } from '../../data/offline/sync'
import { createProfile, GUEST_LEFT_BEHIND, signIn, signUp } from './auth'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { emailError, PASSWORD_RULE, passwordError } from './validate'

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
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)

  const needsGuestConfirm = mode === 'signin' && guest && !confirmed
  const newPassword = mode !== 'signin'
  // Errors show from the first submit on and update as the user fixes them.
  const errors = attempt > 0 ? { email: emailError(email), password: passwordError(password) } : {}

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempt])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setAttempt((n) => n + 1)
    if (emailError(email) || passwordError(password)) return
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
          <Button onClick={back}>
            {onSignIn ? 'Back to sign in' : 'Back'}
          </Button>
        )}
      </div>
    )
  }

  return (
    <form className="stack" onSubmit={submit} noValidate ref={formRef}>
      <TextField
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        error={errors.email}
      />
      <TextField
        label="Password"
        type="password"
        autoComplete={newPassword ? 'new-password' : 'current-password'}
        required
        minLength={8}
        hint={newPassword ? PASSWORD_RULE : undefined}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
      />
      {confirmed && (
        <p role="alert">
          {GUEST_LEFT_BEHIND}
          {unsynced > 0 && ` ${changes(unsynced)} made offline ${unsynced === 1 ? "hasn't" : "haven't"} synced and will be lost.`}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="row">
        <Button type="submit" variant="primary" disabled={busy}>
          {confirmed ? 'Continue' : LABEL[mode]}
        </Button>
        {onCancel && (
          <Button onClick={onCancel}>
            Back
          </Button>
        )}
      </div>
    </form>
  )
}
