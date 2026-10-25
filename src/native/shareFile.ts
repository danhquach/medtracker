// Android app file export: the WebView drops <a download> clicks, so write the file to the app cache
// and hand it to the share sheet (Save to Files, Drive, email…). The web/PWA build never loads the plugins.
import { Capacitor } from '@capacitor/core'

// The plugin check, not just "native": the live-site app runs new web code on whatever APK is installed.
export const canShareFile = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Filesystem') && Capacitor.isPluginAvailable('Share')

export async function shareFile(name: string, text: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 })
  try {
    await Share.share({ title: name, files: [uri] })
  } catch (e) {
    // Closing the share sheet without picking a target rejects; that's not a failure.
    if (!/cancel/i.test(e instanceof Error ? e.message : String(e))) throw e
  }
}
