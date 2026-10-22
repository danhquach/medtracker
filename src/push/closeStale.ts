import { isNativeApp, resyncSoon } from '../native/reminders'

// In the Android app both re-plan the phone's reminders, which also clears ones no longer due.

/** Close shown notifications whose dose is no longer pending (tag = dose id). Refill tags are left alone. */
export async function closeStaleNotifications(pendingDoseIds: Set<string>): Promise<void> {
  if (isNativeApp()) return resyncSoon()
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

/** Close this device's notification for one dose (tag = dose id), e.g. after marking it in the app. */
export async function closeDoseNotification(doseId: string): Promise<void> {
  if (isNativeApp()) return resyncSoon()
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    for (const n of (await reg?.getNotifications({ tag: doseId })) ?? []) n.close()
  } catch (e) {
    console.error('could not close dose notification', e)
  }
}
