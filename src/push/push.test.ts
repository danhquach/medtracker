import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ del: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: () => ({ delete: () => ({ eq: db.del }) }),
    rpc: db.rpc,
  },
}))

import { closeDoseNotification } from './closeStale'
import { enablePushOnThisDevice, removeThisDeviceSubscription } from './subscribe'

const note = (tag: string) => ({ tag, close: vi.fn() })

function stubBrowser(reg: object | undefined) {
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration: () => Promise.resolve(reg), ready: Promise.resolve(reg) }, userAgent: '' })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: () => Promise.resolve('granted') })
}

beforeEach(() => {
  db.del.mockReset()
  db.del.mockResolvedValue({ error: null })
  db.rpc.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('closeDoseNotification', () => {
  it('closes notifications with the dose tag', async () => {
    const n = note('d1')
    const getNotifications = vi.fn(async () => [n])
    stubBrowser({ getNotifications })
    await closeDoseNotification('d1')
    expect(getNotifications).toHaveBeenCalledWith({ tag: 'd1' })
    expect(n.close).toHaveBeenCalled()
  })
  it('no registration: no throw', async () => {
    stubBrowser(undefined)
    await expect(closeDoseNotification('d1')).resolves.toBeUndefined()
  })
})

describe('removeThisDeviceSubscription', () => {
  const mkReg = (unsubscribe = vi.fn(async () => true)) => {
    const n = note('d1')
    return { unsubscribe, n, reg: { pushManager: { getSubscription: async () => ({ endpoint: 'https://e', unsubscribe }) }, getNotifications: async () => [n] } }
  }

  it('deletes the row, unsubscribes, closes all notifications', async () => {
    const { reg, unsubscribe, n } = mkReg()
    stubBrowser(reg)
    await removeThisDeviceSubscription()
    expect(db.del).toHaveBeenCalledWith('endpoint', 'https://e')
    expect(unsubscribe).toHaveBeenCalled()
    expect(n.close).toHaveBeenCalled()
  })

  it('unsubscribes even when the delete returns an error or throws', async () => {
    for (const mock of [() => Promise.resolve({ error: { message: 'rls' } }), () => Promise.reject(new Error('net'))]) {
      db.del.mockImplementation(mock)
      const { reg, unsubscribe } = mkReg()
      stubBrowser(reg)
      await removeThisDeviceSubscription()
      expect(unsubscribe).toHaveBeenCalled()
    }
  })

  it('resolves when the browser hangs', async () => {
    vi.useFakeTimers()
    stubBrowser({ pushManager: { getSubscription: () => new Promise(() => {}) }, getNotifications: async () => [] })
    const p = removeThisDeviceSubscription(3000)
    await vi.advanceTimersByTimeAsync(3100)
    await expect(p).resolves.toBeUndefined()
  })
})

describe('enablePushOnThisDevice', () => {
  it('throws instead of sending empty keys', async () => {
    const sub = { endpoint: 'https://e', toJSON: () => ({ keys: {} }) }
    stubBrowser({ pushManager: { getSubscription: async () => sub } })
    await expect(enablePushOnThisDevice('x')).rejects.toThrow(/keys/)
    expect(db.rpc).not.toHaveBeenCalled()
  })
})
