// The one "are you sure?" dialog (MT-91): every destructive or lossy action asks through this, never window.confirm.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

const FOCUSABLE = 'input, select, textarea, button:not(:disabled), a[href]'

/** Takes focus on open, keeps Tab inside, cancels on Escape, and hands focus back to the opener. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy = false,
  confirmDisabled,
  returnFocus,
  onConfirm,
  onCancel,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  confirmDisabled?: boolean
  /** Defaults to whatever had focus when the dialog opened. */
  returnFocus?: RefObject<HTMLElement | null>
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    const opener = returnFocus?.current ?? (document.activeElement as HTMLElement | null)
    // An input to fill in comes first; otherwise Cancel, so a stray Enter never confirms.
    const input = ref.current?.querySelector<HTMLElement>('input, select, textarea')
    ;(input ?? ref.current?.querySelector<HTMLElement>('[data-cancel]'))?.focus()
    return () => opener?.focus()
  }, [returnFocus])

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !busy) {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last?.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first?.focus()
    }
  }

  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-body`}
        className="dialog stack"
        onKeyDown={onKeyDown}
      >
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-body`} className="stack">
          {children}
        </div>
        <div className="row dialog-actions">
          <Button data-cancel disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} disabled={confirmDisabled} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
