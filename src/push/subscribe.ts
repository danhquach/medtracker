import { supabase } from '../lib/supabase'

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
  const json = sub.toJSON()
  const { error } = await supabase.rpc('claim_push_endpoint', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_label: label,
  })
  if (error) throw error
  return 'ok'
}

/** Flips `enabled` on this browser's row. Turning on needs a subscription: use enablePushOnThisDevice first. */
export async function setDeviceEnabled(enabled: boolean): Promise<void> {
  if (!supported()) return
  const sub = await currentSubscription()
  if (!sub) return
  const { error } = await supabase.from('push_subscriptions').update({ enabled }).eq('endpoint', sub.endpoint)
  if (error) throw error
}

export async function getDeviceState(): Promise<DeviceState> {
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

/** Sign-out helper: drop this device's row while the session is still valid. Best-effort, never throws. */
export async function removeThisDeviceSubscription(): Promise<void> {
  try {
    if (!supported()) return
    const sub = await currentSubscription()
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  } catch (e) {
    console.error('could not remove push subscription', e)
  }
}

/** Short human label from the user agent, e.g. "Chrome on macOS". */
export function deviceLabel(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device'
  return `${browser} on ${os}`
}
