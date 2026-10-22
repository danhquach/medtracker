// MT-67 spike: prove the Android app can fire a scheduled local notification on its own channel.
// Native only; the web/PWA build never loads the plugin. Replaced by real dose scheduling later.
import { Capacitor } from '@capacitor/core'

export const DOSE_CHANNEL = 'dose-reminders'

export async function runReminderSpike(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  const { LocalNotifications } = await import('@capacitor/local-notifications')

  const { display } = await LocalNotifications.requestPermissions()
  if (display !== 'granted') return

  await LocalNotifications.createChannel({
    id: DOSE_CHANNEL,
    name: 'Dose reminders',
    description: 'Time to take a medication',
    importance: 5,
    visibility: 1,
    sound: 'dose_reminder.wav',
    vibration: true,
  })

  await LocalNotifications.schedule({
    notifications: [
      {
        id: 1,
        title: 'MedTracker test reminder',
        body: 'Scheduled 60 seconds after the app opened',
        channelId: DOSE_CHANNEL,
        schedule: { at: new Date(Date.now() + 60_000), allowWhileIdle: true },
      },
    ],
  })
}
