import { supabase } from '../lib/supabase'
import { enableReminders, forgetReminders, isNativeApp, nativeDeviceState, setRemindersEnabled } from '../native/reminders'

// In the Android app every function here manages on-phone reminders instead of web push.

export type DeviceState = 'on' | 'off' | 'denied' | 'unsupported'

const supported = () =>
  typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (b64url + '='.repeat((4 - (b64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function enablePushOnThisDevice(label: string): Promise<'ok' | 'denied' | 'unsupported'> {
  if (isNativeApp()) return enableReminders()
  if (!supported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(import.meta.env.VITE_VAPID_PUBLIC_KEY as string),
    }))
  const keys = sub.toJSON().keys
  if (!keys?.p256dh || !keys.auth) throw new Error('Push subscription is missing its keys')
  const { error } = await supabase.rpc('claim_push_endpoint', {
    p_endpoint: sub.endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
    p_label: label,
  })
  if (error) throw error
  return 'ok'
}

/** Flips `enabled` on this browser's row. Turning on needs a subscription: use enablePushOnThisDevice first. */
export async function setDeviceEnabled(enabled: boolean): Promise<void> {
  if (isNativeApp()) return setRemindersEnabled(enabled)
  if (!supported()) return
  const sub = await currentSubscription()
  if (!sub) return
  const { error } = await supabase.from('push_subscriptions').update({ enabled }).eq('endpoint', sub.endpoint)
  if (error) throw error
}

export async function getDeviceState(): Promise<DeviceState> {
  if (isNativeApp()) return nativeDeviceState()
  if (!supported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'off'
  try {
    const sub = await currentSubscription()
    if (!sub) return 'off'
    const { data, error } = await supabase
      .from('push_subscriptions')
      .select('enabled')
      .eq('endpoint', sub.endpoint)
      .maybeSingle()
    return !error && data?.enabled ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

const REMOVE_TIMEOUT_MS = 3000

async function removeNow(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = (await reg?.pushManager.getSubscription()) ?? null
  if (sub) {
    try {
      const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      if (error) console.error('could not delete push subscription row', error)
    } catch (e) {
      console.error('could not delete push subscription row', e)
    }
    // Always unsubscribe: the endpoint dies (410) and the server prunes the row even if the delete failed.
    try {
      await sub.unsubscribe()
    } catch (e) {
      console.error('could not unsubscribe', e)
    }
  }
  try {
    for (const n of (await reg?.getNotifications()) ?? []) n.close()
  } catch (e) {
    console.error('could not close notifications', e)
  }
}

/** Sign-out helper: forget this device while the session is still valid. Best-effort, never throws, ~3 s cap. */
export async function removeThisDeviceSubscription(timeoutMs = REMOVE_TIMEOUT_MS): Promise<void> {
  if (isNativeApp()) return forgetReminders().catch((e: unknown) => console.error('could not clear reminders', e))
  if (!supported()) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([removeNow(), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeoutMs)))])
  } catch (e) {
    console.error('could not remove push subscription', e)
  } finally {
    clearTimeout(timer)
  }
}

/** Short human label from the user agent, e.g. "Chrome on macOS". */
export function deviceLabel(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'
  return `${browser} on ${os}`
}
