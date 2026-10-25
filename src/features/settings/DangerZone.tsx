import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Button } from '../../components/Button'
import { signOut } from '../auth/auth'
import DeleteDialog from './DeleteDialog'
import { msg } from './msg'

export default function DangerZone({ onError }: { onError: (error: string | null) => void }) {
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleteButton = useRef<HTMLButtonElement>(null)

  async function deleteProfile() {
    setBusy(true)
    onError(null)
    try {
      const { error: fnError } = await supabase.functions.invoke('delete-account')
      if (fnError) throw fnError
      try {
        await signOut()
      } catch {
        await supabase.auth.signOut({ scope: 'local' })
      }
    } catch (e) {
      onError(msg(e, 'Could not delete the profile'))
      setBusy(false)
    }
  }

  return (
    <section className="settings-group danger-zone" aria-labelledby="st-danger">
      <h3 id="st-danger">Danger zone</h3>
      <p className="list-row-desc">Deleting your profile removes all your meds and history. This can't be undone.</p>
      <Button ref={deleteButton} variant="danger" onClick={() => setDeleting(true)}>
        Delete profile
      </Button>
      {deleting && (
        <DeleteDialog busy={busy} returnFocus={deleteButton} onConfirm={() => void deleteProfile()} onClose={() => setDeleting(false)} />
      )}
    </section>
  )
}
