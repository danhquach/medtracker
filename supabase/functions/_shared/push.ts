import webpush from 'npm:web-push@3.6.7'
import { classifyPushStatus, isAllowedPushEndpoint } from './pushPolicy.ts'

export type PushSubRow = { id: string; endpoint: string; p256dh: string; auth: string }

export type PushPayload =
  | { type: 'dose'; tag: string; title: string; body: string; actionToken: string }
  | { type: 'refill'; tag: string; title: string; body: string }

let configured = false

function configure() {
  if (configured) return
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  configured = true
}

// 'gone' = the push service says the subscription is dead (caller deletes it).
// Endpoints outside the allowlist are never contacted (SSRF guard) and count as 'error'.
export async function sendPush(sub: PushSubRow, payload: PushPayload): Promise<'ok' | 'gone' | 'error'> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'error'
  try {
    configure()
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 3600, timeout: 10_000 },
    )
    return 'ok'
  } catch (e) {
    const status = (e as { statusCode?: unknown }).statusCode
    return typeof status === 'number' ? classifyPushStatus(status) : 'error'
  }
}
