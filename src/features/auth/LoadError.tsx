export default function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="stack">
      <p role="alert">{message}</p>
      <button type="button" onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
