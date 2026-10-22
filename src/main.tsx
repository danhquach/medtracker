import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { startSyncTriggers } from './data/offline/sync'
import { routerBasename } from './lib/basePath'
import { isNativeApp, startReminders } from './native/reminders'

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  if (isNativeApp()) {
    // A cached copy would keep serving the previous build after the APK is updated.
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()))
  } else {
    const base = import.meta.env.BASE_URL
    window.addEventListener('load', () => void navigator.serviceWorker.register(`${base}sw.js`, { scope: base }))
  }
}

startSyncTriggers()
void startReminders().catch((e: unknown) => console.error('could not start reminders', e))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
