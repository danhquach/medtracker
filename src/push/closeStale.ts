/** Close shown notifications whose dose is no longer pending (tag = dose id). Refill tags are left alone. */
export async function closeStaleNotifications(pendingDoseIds: Set<string>): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return
    for (const n of await reg.getNotifications()) {
      if (n.tag && !n.tag.startsWith('refill-') && !pendingDoseIds.has(n.tag)) n.close()
    }
  } catch (e) {
    console.error('could not close stale notifications', e)
  }
}
