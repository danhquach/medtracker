// Copy shared by the sync status line, sign-out and the guest sign-in warning.

export const changes = (n: number) => `${n} ${n === 1 ? 'change' : 'changes'}`

export const unsyncedWarning = (n: number) =>
  `${changes(n)} ${n === 1 ? "hasn't" : "haven't"} synced and will be lost. Sign out anyway?`
