import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { startSyncTriggers } from './data/offline/sync'
import { routerBasename } from './lib/basePath'
import { startServiceWorker } from './lib/serviceWorker'
import { startReminders } from './native/reminders'

if ('serviceWorker' in navigator && import.meta.env.PROD) startServiceWorker()

startSyncTriggers()
void startReminders().catch((e: unknown) => console.error('could not start reminders', e))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
