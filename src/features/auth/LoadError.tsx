import { Button } from '../../components/Button'
import { Notice } from '../../components/layout'

export default function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stack">
      <Notice tone="error">
        Couldn't load this. Check your connection and try again.
        <br />
        <span className="muted">{message}</span>
      </Notice>
      <Button onClick={onRetry}>
        Retry
      </Button>
    </div>
  )
}
