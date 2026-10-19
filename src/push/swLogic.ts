// Dependency-free push/notificationclick decisions for the service worker (unit-tested).
import type { PushPayload } from '../../supabase/functions/_shared/reminderRun'

export type NotificationData = { type: PushPayload['type']; token?: string }

export type NotificationSpec = {
  title: string
  options: {
    body: string
    tag: string
    data: NotificationData
    icon: string
    badge: string
    requireInteraction?: boolean
    renotify?: boolean
    actions?: { action: string; title: string }[]
  }
}

export type ActionDeps = {
  fetch: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean }>
  openToday: () => Promise<unknown>
  close: () => void
  endpoint: string
  apikey: string
}

/** `scope` is the SW registration scope (ends with '/'), so URLs stay correct under a sub-path deploy. */
export const todayUrl = (scope: string): string => `${scope}today`

export function notificationFromPayload(raw: Partial<PushPayload> | null | undefined, scope = '/'): NotificationSpec {
  const ICON = `${scope}icon-192.png`
  const p = raw ?? {}
  const title = p.title || 'MedTracker'
  const body = p.body || 'You have a reminder.'
  const base = { body, tag: p.tag ?? 'medtracker', icon: ICON, badge: ICON }
  if (p.type === 'dose') {
    return {
      title,
      options: {
        ...base,
        data: { type: 'dose', token: p.actionToken },
        requireInteraction: false,
        renotify: true,
        actions: [
          { action: 'taken', title: 'Taken' },
          { action: 'snooze', title: 'Snooze' },
        ],
      },
    }
  }
  return { title, options: { ...base, data: { type: 'refill' } } }
}

/** Action button -> POST to dose-action; anything else (body tap, failure) -> open Today. */
export async function handleAction(ev: { action: string; data: NotificationData }, d: ActionDeps): Promise<void> {
  d.close()
  const token = ev.data?.token
  if ((ev.action === 'taken' || ev.action === 'snooze') && token) {
    try {
      const res = await d.fetch(d.endpoint, {
        method: 'POST',
        headers: { apikey: d.apikey, 'content-type': 'application/json' },
        body: JSON.stringify({ token, action: ev.action }),
      })
      if (res.ok) return
    } catch {
      // fall through: open the app instead
    }
  }
  await d.openToday()
}
