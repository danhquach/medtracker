import type { CapacitorConfig } from '@capacitor/cli'

// Android shell for the same Vite build (MT-67). `npm run android:apk` builds a sideloadable debug APK.
const config: CapacitorConfig = {
  appId: 'app.medtracker.android',
  appName: 'MedTracker',
  webDir: 'dist',
}

export default config
