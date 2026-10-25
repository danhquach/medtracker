import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

type Ask = { title: string; message: string; confirmLabel: string; danger?: boolean }

/** An awaitable stand-in for window.confirm: `if (!(await confirm({...}))) return`. Render `dialog` somewhere on screen. */
export function useConfirm() {
  const [ask, setAsk] = useState<Ask | null>(null)
  // Every question gets an answer: a newer one or leaving the screen counts as Cancel.
  const pending = useRef<((ok: boolean) => void) | null>(null)
  const settle = (ok: boolean) => {
    pending.current?.(ok)
    pending.current = null
  }
  const confirm = useCallback((opts: Ask) => {
    pending.current?.(false)
    return new Promise<boolean>((resolve) => {
      pending.current = resolve
      setAsk(opts)
    })
  }, [])
  useEffect(() => () => pending.current?.(false), [])

  const close = (ok: boolean) => {
    settle(ok)
    setAsk(null)
  }
  const dialog = ask && (
    <ConfirmDialog
      title={ask.title}
      confirmLabel={ask.confirmLabel}
      danger={ask.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    >
      <p>{ask.message}</p>
    </ConfirmDialog>
  )
  return [confirm, dialog] as const
}
