import type { CapacitorConfig } from '@capacitor/cli'

// Android shell (MT-67). `npm run android:apk` builds the live-site APK: it loads the deployed web
// app, so web changes reach the phone without a reinstall (MT-69). Without ANDROID_LIVE the APK
// carries its own copy of `dist` (`npm run android:apk:mock`, the offline test build).
const live = process.env.ANDROID_LIVE === '1'

const config: CapacitorConfig = {
  appId: 'app.medtracker.android',
  appName: 'MedTracker',
  // The live APK only ships the page shown when the site can't load on first run.
  webDir: live ? 'android-shell' : 'dist',
  ...(live && { server: { url: 'https://danhquach.github.io/medtracker/', errorPath: 'offline.html' } }),
}

export default config
