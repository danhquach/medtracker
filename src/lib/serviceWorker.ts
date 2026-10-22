// Service worker registration. Web and the live-site Android app (MT-69) keep one: it is what lets
// the app open offline. The bundled Android build (files served from https://localhost) removes it,
// since a cached copy would keep serving the previous build after the APK is updated.
import { Capacitor } from '@capacitor/core'

type Env = {
  sw: ServiceWorkerContainer
  native: boolean
  host: string
  base: string
  reload: () => void
}

const defaults = (): Env => ({
  sw: navigator.serviceWorker,
  native: Capacitor.isNativePlatform(),
  host: location.hostname,
  base: import.meta.env.BASE_URL,
  reload: () => location.reload(),
})

export const isBundledApp = (native: boolean, host: string): boolean => native && host === 'localhost'

export function startServiceWorker(env: Env = defaults()): void {
  const { sw, native, host, base, reload } = env
  if (isBundledApp(native, host)) {
    void sw.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()))
    return
  }
  window.addEventListener('load', () => void sw.register(`${base}sw.js`, { scope: base }))
  if (!native) return
  // Live-site app: a deploy shows the next time the app opens or comes back to the front. The new
  // worker takes over (skipWaiting) while the old build is on screen, so reload once onto it.
  // A first install has no controller to replace and needs no reload.
  const hadController = sw.controller !== null
  let reloading = false
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return
    reloading = true
    reload()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sw.getRegistration().then((r) => r?.update()).catch(() => {}) // offline
  })
}
