// Android app DIN/NPN label scan (MT-105, MT-122): one photo, read on the phone by the native
// LabelReader plugin (Tesseract), then deleted. The web/PWA build has no plugin, so it types the number only.
import { Capacitor, registerPlugin } from '@capacitor/core'
import { findCandidates } from '../features/dinLookup/candidates'

type Block = { text: string; lines: string[] }
const LabelReader = registerPlugin<{ scan(): Promise<{ blocks: Block[] }> }>('LabelReader')

// The plugin check, not just "native": the live-site app runs new web code on whatever APK is installed.
// Only LabelReader counts: an older APK's ML Kit "LabelScanner" uploads usage logs to Google (MT-122).
export const canScanLabel = (): boolean => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('LabelReader')

/** The 8-digit numbers on the label, best first; 'cancelled' when the camera was closed without a photo. */
export async function scanLabel(): Promise<string[] | 'cancelled' | 'no-camera'> {
  try {
    return findCandidates((await LabelReader.scan()).blocks)
  } catch (e) {
    const code = (e as { code?: string }).code
    if (code === 'CANCELLED') return 'cancelled'
    if (code === 'NO_CAMERA') return 'no-camera'
    // A photo that couldn't be read has no number in it.
    return []
  }
}
