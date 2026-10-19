// Service worker wiring. Decision logic lives in push/swLogic.ts (unit-tested).
// Typed minimally: the project compiles with the DOM lib, not WebWorker.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'
import { handleAction, notificationFromPayload, todayUrl, type NotificationData } from './push/swLogic'
import type { PushPayload } from '../supabase/functions/_shared/reminderRun'

type Ev = { waitUntil(p: Promise<unknown>): void }
type PushEv = Ev & { data: { json(): unknown } | null }
type ClickEv = Ev & { action: string; notification: { data: NotificationData; close(): void } }
type Win = { url: string; focus(): Promise<unknown> }
type SW = {
  registration: { scope: string; showNotification(title: string, o: object): Promise<void> }
  clients: { matchAll(o: object): Promise<Win[]>; openWindow(url: string): Promise<unknown> }
  skipWaiting(): Promise<void>
  addEventListener(type: string, fn: (e: never) => void): void
}
const sw = self as unknown as SW

cleanupOutdatedCaches()
// Must stay a literal `self.__WB_MANIFEST`: workbox injects the precache list there.
precacheAndRoute((self as unknown as { __WB_MANIFEST: { url: string; revision: string | null }[] }).__WB_MANIFEST)

sw.addEventListener('install', () => void sw.skipWaiting())

sw.addEventListener('push', (e: PushEv) => {
  let payload: PushPayload
  try {
    payload = e.data?.json() as PushPayload
  } catch {
    return
  }
  const n = notificationFromPayload(payload, sw.registration.scope)
  e.waitUntil(sw.registration.showNotification(n.title, n.options))
})

async function openToday(): Promise<unknown> {
  const wins = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
  const existing = wins[0]
  if (existing) {
    // Prefer an already-open window; fall back to opening one on Today.
    try {
      return await existing.focus()
    } catch {
      /* fall through */
    }
  }
  return sw.clients.openWindow(todayUrl(sw.registration.scope))
}

sw.addEventListener('notificationclick', (e: ClickEv) => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
  e.waitUntil(
    handleAction(
      { action: e.action, data: e.notification.data },
      {
        fetch: (url, init) => fetch(url, init),
        openToday,
        close: () => e.notification.close(),
        endpoint: `${supabaseUrl}/functions/v1/dose-action`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      },
    ),
  )
})
