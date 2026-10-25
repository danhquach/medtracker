// The one "are you sure?" dialog (MT-91): every destructive or lossy action asks through this, never window.confirm.
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'

const FOCUSABLE = 'input, select, textarea, button:not(:disabled), a[href]'

// Back (Android or browser) with a dialog open cancels it instead of leaving the screen (MT-110). The step
// back is stopped before the router hears it and undone with a step forward, which is stopped too; nothing is
// added to history, so closing the dialog any other way leaves no extra step behind.
let onBack: (() => void) | null = null
let undoing = false
window.addEventListener(
  'popstate',
  (e) => {
    if (undoing) undoing = false
    else if (onBack) {
      undoing = true
      history.go(1)
      onBack()
    } else return
    e.stopImmediatePropagation()
  },
  true,
)

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
    // The rest of the page can't be tabbed to, clicked or read while the dialog is open.
    const backdrop = ref.current?.parentElement
    const page = [...document.body.children].filter((el) => el !== backdrop && !el.hasAttribute('inert'))
    page.forEach((el) => el.setAttribute('inert', ''))
    // An input to fill in comes first; otherwise Cancel, so a stray Enter never confirms.
    const input = ref.current?.querySelector<HTMLElement>('input, select, textarea')
    ;(input ?? ref.current?.querySelector<HTMLElement>('[data-cancel]'))?.focus()
    return () => {
      page.forEach((el) => el.removeAttribute('inert'))
      // An opener inside a menu that closed (e.g. a med card's More menu) hands focus to the menu's toggle.
      const closedMenu = opener?.closest('details:not([open])')
      ;(closedMenu?.querySelector('summary') ?? opener)?.focus()
    }
  }, [returnFocus])

  // On the document, so Escape still works after focus drops out of the dialog (e.g. a click on its text).
  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [busy, onCancel])

  useEffect(() => {
    onBack = () => {
      if (!busy) onCancel()
    }
    return () => {
      onBack = null
    }
  }, [busy, onCancel])

  function onKeyDown(e: React.KeyboardEvent) {
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
