import type { DeviceState } from '../../push/subscribe'

/** "America/Port_of_Spain" → "Port of Spain". */
const zoneCity = (zone: string) => (zone.split('/').pop() ?? zone).replace(/_/g, ' ')

/** One glance at whether reminders will reach this device. */
export default function ReminderStatus({ state, zone }: { state: DeviceState | null; zone: string | null }) {
  if (!state) return null
  const on = state === 'on'
  const title = on
    ? 'Reminders are on'
    : state === 'off'
      ? 'Reminders are off on this device'
      : state === 'denied'
        ? "Reminders can't reach this device"
        : "This browser can't show reminders"
  const detail = on
    ? `This device${zone ? ` · ${zoneCity(zone)} time` : ''}`
    : state === 'off'
      ? 'Turn on notifications below to get dose alerts.'
      : state === 'denied'
        ? 'Notifications are turned off for this site.'
        : 'Try a different browser to get dose alerts.'
  return (
    <div className={on ? 'status-card ok' : 'status-card warn'}>
      <p className="status-card-title">{title}</p>
      <p className="muted">{detail}</p>
    </div>
  )
}
