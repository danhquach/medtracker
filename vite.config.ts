import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const base = process.env.VITE_BASE ?? '/'

// `vite --mode mock`: every import of src/lib/supabase.ts gets the in-browser fake instead.
const realClient = fileURLToPath(new URL('./src/lib/supabase.ts', import.meta.url))
const mockClient = fileURLToPath(new URL('./src/lib/supabase.mock.ts', import.meta.url))
const mockSupabase = (): Plugin => ({
  name: 'mock-supabase',
  enforce: 'pre',
  async resolveId(source, importer) {
    const resolved = await this.resolve(source, importer, { skipSelf: true })
    return resolved?.id === realClient ? mockClient : null
  },
})

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base,
  plugins: [
    ...(mode === 'mock' ? [mockSupabase()] : []),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: {
        name: 'MedTracker',
        short_name: 'MedTracker',
        theme_color: '#161616',
        background_color: '#161616',
        display: 'standalone',
        start_url: `${base}today`,
        scope: base,
        icons: [
          { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
      },
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png}'] },
    }),
  ],
}))
