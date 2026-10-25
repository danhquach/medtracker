// Android app tap feedback (MT-86): one capture listener gives every button and link a light key-press
// haptic, so new buttons get it too. The native side uses the system key-press haptic, which follows
// the phone's "Touch feedback" setting. The web/PWA build never calls the plugin.
import { Capacitor, registerPlugin } from '@capacitor/core'

const TapHaptics = registerPlugin<{ tap(): Promise<void> }>('TapHaptics')

// The plugin check, not just "native": the live-site app runs new web code on whatever APK is installed.
const canTap = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TapHaptics')

/** Returns a stop function. Disabled buttons never fire click, so they stay silent. */
export function startTapHaptics(): () => void {
  if (!canTap()) return () => {}
  const onClick = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('button, a[href]')) void TapHaptics.tap().catch(() => {})
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
