import { describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))
const { isBundledApp, startServiceWorker } = await import('./serviceWorker')

function fakeSw(controller: object | null) {
  const listeners: Record<string, () => void> = {}
  const reg = { unregister: vi.fn(), update: vi.fn(async () => {}) }
  const sw = {
    controller,
    register: vi.fn(async () => reg),
    getRegistrations: vi.fn(async () => [reg]),
    getRegistration: vi.fn(async () => reg),
    addEventListener: vi.fn((type: string, fn: () => void) => (listeners[type] = fn)),
  }
  return { sw: sw as unknown as ServiceWorkerContainer, reg, fire: (type: string) => listeners[type]?.() }
}
const flush = () => new Promise((res) => setTimeout(res, 0))
const env = (sw: ServiceWorkerContainer, native: boolean, host: string, reload = vi.fn()) => ({ sw, native, host, base: '/medtracker/', reload })

describe('isBundledApp', () => {
  it('only the Android app serving its own files', () => {
    expect(isBundledApp(true, 'localhost')).toBe(true)
    expect(isBundledApp(true, 'danhquach.github.io')).toBe(false)
    expect(isBundledApp(false, 'localhost')).toBe(false)
  })
})

describe('startServiceWorker', () => {
  it('bundled Android build: removes the worker and never registers one', async () => {
    const f = fakeSw(null)
    startServiceWorker(env(f.sw, true, 'localhost'))
    window.dispatchEvent(new Event('load'))
    await flush()
    expect(f.reg.unregister).toHaveBeenCalled()
    expect(f.sw.register).not.toHaveBeenCalled()
  })

  it('live-site Android app: keeps and registers the worker', async () => {
    const f = fakeSw(null)
    startServiceWorker(env(f.sw, true, 'danhquach.github.io'))
    window.dispatchEvent(new Event('load'))
    expect(f.sw.register).toHaveBeenCalledWith('/medtracker/sw.js', { scope: '/medtracker/' })
    expect(f.reg.unregister).not.toHaveBeenCalled()
  })

  it('live-site app: a new deploy taking over reloads once', () => {
    const f = fakeSw({})
    const reload = vi.fn()
    startServiceWorker(env(f.sw, true, 'danhquach.github.io', reload))
    f.fire('controllerchange')
    f.fire('controllerchange')
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('live-site app: the first install does not reload', () => {
    const f = fakeSw(null)
    const reload = vi.fn()
    startServiceWorker(env(f.sw, true, 'danhquach.github.io', reload))
    f.fire('controllerchange')
    expect(reload).not.toHaveBeenCalled()
  })

  it('live-site app: checks for a new deploy when brought back to the front', async () => {
    const f = fakeSw({})
    startServiceWorker(env(f.sw, true, 'danhquach.github.io'))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await flush()
    expect(f.reg.update).toHaveBeenCalled()
  })

  it('web: registers, but never reloads the page on its own', () => {
    const f = fakeSw({})
    const reload = vi.fn()
    startServiceWorker(env(f.sw, false, 'danhquach.github.io', reload))
    window.dispatchEvent(new Event('load'))
    expect(f.sw.register).toHaveBeenCalled()
    expect(f.sw.addEventListener).not.toHaveBeenCalled()
  })
})
