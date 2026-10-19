import webpush from 'npm:web-push@3.6.7'
import { classifyPushStatus, isAllowedPushEndpoint } from './pushPolicy.ts'
import type { PushPayload, SendResult } from './reminderRun.ts'

export type { PushPayload }
export type PushSubRow = { id: string; endpoint: string; p256dh: string; auth: string }

let configured = false

export function vapidConfigured(): boolean {
  return ['VAPID_SUBJECT', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].every((k) => !!Deno.env.get(k))
}

function configure() {
  if (configured) return
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
  configured = true
}

// 'gone' = dead subscription (caller deletes it). 'disallowed' = endpoint outside the allowlist, never
// contacted (SSRF guard, row kept). 'error' = transient (network, 401/403/429/5xx): caller may retry.
export async function sendPush(sub: PushSubRow, payload: PushPayload): Promise<SendResult> {
  if (!isAllowedPushEndpoint(sub.endpoint)) return 'disallowed'
  try {
    configure()
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      // High urgency so battery-saver phones deliver reminders on time instead of batching them.
      { TTL: 3600, timeout: 10_000, urgency: 'high' },
    )
    return 'ok'
  } catch (e) {
    const status = (e as { statusCode?: unknown }).statusCode
    return typeof status === 'number' ? classifyPushStatus(status) : 'error'
  }
}
