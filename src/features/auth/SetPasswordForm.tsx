import { useEffect, useRef, useState } from 'react'
import { setPassword } from './auth'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Field'
import { PASSWORD_RULE, passwordError } from './validate'

export default function SetPasswordForm({ onDone }: { onDone?: () => void }) {
  const [password, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const formRef = useRef<HTMLFormElement>(null)
  const fieldError = attempt > 0 ? passwordError(password) : undefined

  useEffect(() => {
    if (attempt > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempt])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setAttempt((n) => n + 1)
    if (passwordError(password)) return
    try {
      await setPassword(password)
      setDone(true)
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
  }

  if (done) return <p role="status">Password set.</p>
  return (
    <form className="stack" onSubmit={submit} noValidate ref={formRef}>
      <h3>Set your password</h3>
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        hint={PASSWORD_RULE}
        value={password}
        onChange={(e) => setPw(e.target.value)}
        error={fieldError}
      />
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary">
        Set your password
      </Button>
    </form>
  )
}
