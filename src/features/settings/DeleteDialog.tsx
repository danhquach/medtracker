import { useState, type RefObject } from 'react'
import { ConfirmDialog } from '../../components/ConfirmDialog'

export default function DeleteDialog({
  busy,
  returnFocus,
  onConfirm,
  onClose,
}: {
  busy: boolean
  returnFocus: RefObject<HTMLButtonElement | null>
  onConfirm: () => void
  onClose: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  return (
    <ConfirmDialog
      title="Delete profile?"
      confirmLabel={busy ? 'Deleting…' : 'Delete my profile'}
      danger
      busy={busy}
      confirmDisabled={confirmText !== 'DELETE'}
      returnFocus={returnFocus}
      onConfirm={onConfirm}
      onCancel={onClose}
    >
      <p>This permanently deletes your profile and all your medications and history. Type DELETE to confirm.</p>
      <input aria-label="Type DELETE to confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
    </ConfirmDialog>
  )
}
