import { Button } from '../../components/Button'

export default function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stack">
      <p role="alert">
        Couldn't load this. Check your connection and try again.
        <br />
        <span className="muted">{message}</span>
      </p>
      <Button onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
