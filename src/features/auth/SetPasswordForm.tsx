import { useState } from 'react'
import { setPassword } from './auth'
import { Button } from '../../components/Button'

export default function SetPasswordForm({ onDone }: { onDone?: () => void }) {
  const [password, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
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
    <form className="stack" onSubmit={submit}>
      <h3>Set your password</h3>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          aria-describedby="set-password-rule"
          value={password}
          onChange={(e) => setPw(e.target.value)}
        />
      </label>
      <p id="set-password-rule" className="muted hint">
        At least 8 characters.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button type="submit" variant="primary">
        Set your password
      </Button>
    </form>
  )
}
