import type { ReactNode } from 'react'

/** Visible while a screen's data loads (a blank screen reads as broken). */
export function Loading() {
  return (
    <p className="muted" role="status" aria-busy="true">
      Loading…
    </p>
  )
}

/** Nothing to show yet: say so, and offer the next step when there is one. */
export function Empty({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="stack empty">
      <p className="muted">{children}</p>
      {action}
    </div>
  )
}
