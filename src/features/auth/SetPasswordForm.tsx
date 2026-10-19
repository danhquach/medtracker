import { useState } from 'react'
import { setPassword } from './auth'

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
        <input type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPw(e.target.value)} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" className="primary">
        Set your password
      </button>
    </form>
  )
}
