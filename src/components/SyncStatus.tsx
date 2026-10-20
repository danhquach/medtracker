import { useEffect, useState } from 'react'
import type { Op } from '../data/offline/ops'
import { dismissFailed, snapshot, subscribe, type SyncStatus as Status } from '../data/offline/sync'

export const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`

export const unsyncedWarning = (n: number) =>
  `${changes(n)} ${n === 1 ? "hasn't" : "haven't"} synced and will be lost. Sign out anyway?`

function describe(op: Op): string {
  switch (op.kind) {
    case 'doseStatus':
      return op.status === 'pending' ? 'Undo dose' : `Mark dose ${op.status}`
    case 'prn':
      return 'Log dose'
    case 'saveMed':
      return op.create ? 'Add med' : 'Edit med'
    case 'deleteMed':
      return 'Delete med'
    case 'setPaused':
      return op.paused ? 'Pause med' : 'Resume med'
    case 'addStock':
      return 'Add stock'
    case 'updateProfile':
      return 'Settings change'
  }
}

const medIdOf = (op: Op) => ('medId' in op ? op.medId : op.kind === 'saveMed' ? op.med.id : null)

/** Offline / syncing / failed-sync line under the header. Renders nothing when all is synced. */
export default function SyncStatus() {
  const [s, setS] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => subscribe(setS), [])
  const failed = s?.failed ?? []
  useEffect(() => {
    if (!open || failed.length === 0) return
    let alive = true
    void snapshot().then((c) => alive && c && setNames(Object.fromEntries(c.meds.map((m) => [m.id, m.name]))))
    return () => {
      alive = false
    }
  }, [open, failed.length])
  if (!s) return null

  const line = s.needsSignIn
    ? 'Sign in again to sync'
    : !s.online
      ? s.pending > 0
        ? `Offline — ${changes(s.pending)} waiting`
        : 'Offline'
      : s.syncing && s.pending > 0
        ? 'Syncing…'
        : null
  if (!line && failed.length === 0) return null

  return (
    <div className="sync-status">
      {line && <p role="status">{line}</p>}
      {failed.length > 0 && (
        <>
          <button type="button" className="link-button sync-failed" aria-expanded={open} onClick={() => setOpen(!open)}>
            {`${changes(failed.length)} couldn't sync`}
          </button>
          {open && (
            <ul className="sync-failed-list">
              {failed.map((item) => {
                const op = item.op
                const name = op.kind === 'saveMed' ? op.med.name : (names[medIdOf(op) ?? ''] ?? null)
                return (
                  <li key={item.seq}>
                    <span>
                      {describe(op)}
                      {name ? ` · ${name}` : ''} — {item.error}
                    </span>
                    <button type="button" onClick={() => void dismissFailed(item.seq)}>
                      Dismiss
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
