export type DeviceNotificationState = 'unsupported' | 'denied' | 'off' | 'on'

/** Stub: permission only. Task 9 adds the push-subscription check. */
export function useDeviceNotificationState(): DeviceNotificationState {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission === 'granted') return 'on'
  return Notification.permission === 'denied' ? 'denied' : 'off'
}
