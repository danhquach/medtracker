import { defineConfig, devices } from '@playwright/test'
import { assertTestProject } from './tests/guard'

assertTestProject()

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: 'list',
  globalTeardown: './tests/e2e/globalTeardown.ts',
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 375, height: 812 },
    timezoneId: 'America/Toronto',
    locale: 'en-US',
    trace: 'retain-on-failure',
    // Browser default is Chromium; service workers add nothing to these flows.
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
