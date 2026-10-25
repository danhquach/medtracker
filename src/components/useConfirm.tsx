import { useCallback, useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'

type Ask = { title: string; message: string; confirmLabel: string; danger?: boolean }

/** An awaitable stand-in for window.confirm: `if (!(await confirm({...}))) return`. Render `dialog` somewhere on screen. */
export function useConfirm() {
  const [ask, setAsk] = useState<(Ask & { resolve: (ok: boolean) => void }) | null>(null)
  const confirm = useCallback((opts: Ask) => new Promise<boolean>((resolve) => setAsk({ ...opts, resolve })), [])
  const close = (ok: boolean) => {
    ask?.resolve(ok)
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
