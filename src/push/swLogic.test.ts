import { describe, expect, it, vi } from 'vitest'
import { handleAction, notificationFromPayload, type ActionDeps } from './swLogic'

const dose = { type: 'dose', tag: 'd1', title: 'Time for X', body: 'Due 8:00', actionToken: 'tok' } as const
const refill = { type: 'refill', tag: 'refill-m1', title: 'X low', body: 'About 3 days left.' } as const

describe('notificationFromPayload', () => {
  it('dose: tag, actions, renotify, data token', () => {
    const n = notificationFromPayload(dose)
    expect(n.title).toBe('Time for X')
    expect(n.options).toMatchObject({
      body: 'Due 8:00',
      tag: 'd1',
      requireInteraction: false,
      renotify: true,
      data: { type: 'dose', token: 'tok' },
      actions: [
        { action: 'taken', title: 'Taken' },
        { action: 'snooze', title: 'Snooze' },
      ],
    })
  })

  it('missing title/body falls back to a generic notification', () => {
    const n = notificationFromPayload({ type: 'dose', tag: 'd1' } as never)
    expect(n.title).toBe('MedTracker')
    expect(n.options.body).toBe('You have a reminder.')
    const m = notificationFromPayload(null)
    expect(m.title).toBe('MedTracker')
    expect(m.options.body).toBe('You have a reminder.')
  })

  it('refill: no actions, no token', () => {
    const n = notificationFromPayload(refill)
    expect(n.options.actions).toBeUndefined()
    expect(n.options.data).toEqual({ type: 'refill' })
    expect(n.options.tag).toBe('refill-m1')
  })
})

function deps(res: () => Promise<{ ok: boolean }>): ActionDeps & { fetch: ReturnType<typeof vi.fn> } {
  return {
    fetch: vi.fn(res),
    openToday: vi.fn(async () => {}),
    close: vi.fn(),
    endpoint: 'https://x.test/functions/v1/dose-action',
    apikey: 'anon',
  }
}

describe('handleAction', () => {
  it('taken: posts token+action with apikey, closes, does not open', async () => {
    const d = deps(async () => ({ ok: true }))
    await handleAction({ action: 'taken', data: { type: 'dose', token: 'tok' } }, d)
    expect(d.fetch).toHaveBeenCalledWith('https://x.test/functions/v1/dose-action', {
      method: 'POST',
      headers: { apikey: 'anon', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'tok', action: 'taken' }),
    })
    expect(d.close).toHaveBeenCalled()
    expect(d.openToday).not.toHaveBeenCalled()
  })

  it('snooze posts snooze', async () => {
    const d = deps(async () => ({ ok: true }))
    await handleAction({ action: 'snooze', data: { type: 'dose', token: 'tok' } }, d)
    expect(JSON.parse(d.fetch.mock.calls[0][1].body)).toEqual({ token: 'tok', action: 'snooze' })
  })

  it('non-2xx opens Today', async () => {
    const d = deps(async () => ({ ok: false }))
    await handleAction({ action: 'taken', data: { type: 'dose', token: 'tok' } }, d)
    expect(d.openToday).toHaveBeenCalled()
    expect(d.close).toHaveBeenCalled()
  })

  it('network error opens Today', async () => {
    const d = deps(async () => {
      throw new Error('offline')
    })
    await handleAction({ action: 'taken', data: { type: 'dose', token: 'tok' } }, d)
    expect(d.openToday).toHaveBeenCalled()
  })

  it('body tap (no action) opens Today without fetching', async () => {
    const d = deps(async () => ({ ok: true }))
    await handleAction({ action: '', data: { type: 'dose', token: 'tok' } }, d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.openToday).toHaveBeenCalled()
    expect(d.close).toHaveBeenCalled()
  })

  it('action without a token opens Today', async () => {
    const d = deps(async () => ({ ok: true }))
    await handleAction({ action: 'taken', data: { type: 'refill' } }, d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.openToday).toHaveBeenCalled()
  })

  it('unknown action opens Today', async () => {
    const d = deps(async () => ({ ok: true }))
    await handleAction({ action: 'bogus', data: { type: 'dose', token: 'tok' } }, d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.openToday).toHaveBeenCalled()
  })
})
