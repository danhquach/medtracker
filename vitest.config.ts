import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test-setup.ts'],
    // Unit tests never reach Supabase; placeholders let the client module load
    // where no .env.local exists (CI).
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'unit-test-anon-key',
      VITE_VAPID_PUBLIC_KEY: 'unit-test-vapid-key',
    },
    include: [
      'src/**/*.test.{ts,tsx}',
      'supabase/functions/_shared/{refill,actionToken,pushPolicy,reminderRun}.test.ts',
    ],
  },
})
