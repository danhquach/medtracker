// Android app battery use (MT-152): reminders ask the server as they ring whether their dose was
// marked on another device, which an idle phone only allows with battery use set to Unrestricted.
import { Capacitor, registerPlugin } from '@capacitor/core'

const BackgroundUse = registerPlugin<{ status(): Promise<{ unrestricted: boolean }>; allow(): Promise<void> }>('BackgroundUse')

// The plugin check, not just "native": the live-site app runs new web code on whatever APK is installed.
const canAsk = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('BackgroundUse')

/** True only when the app could ask and the phone still restricts it. */
export async function backgroundRestricted(): Promise<boolean> {
  if (!canAsk()) return false
  try {
    return !(await BackgroundUse.status()).unrestricted
  } catch {
    return false
  }
}

export const allowBackgroundUse = (): Promise<void> => BackgroundUse.allow()
