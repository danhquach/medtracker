import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { startSyncTriggers } from './data/offline/sync'
import { routerBasename } from './lib/basePath'
import { runReminderSpike } from './native/reminderSpike'

startSyncTriggers()
void runReminderSpike()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={routerBasename()}>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
