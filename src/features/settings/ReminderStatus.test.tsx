import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ReminderStatus from './ReminderStatus'

describe('ReminderStatus', () => {
  it('shows nothing until the device state is known', () => {
    const { container } = render(<ReminderStatus state={null} zone="America/Toronto" />)
    expect(container.innerHTML).toBe('')
  })

  it('names the time zone city when reminders are on', () => {
    const { container } = render(<ReminderStatus state="on" zone="America/Port_of_Spain" />)
    expect(screen.getByText('Reminders are on')).toBeTruthy()
    expect(screen.getByText('This device · Port of Spain time')).toBeTruthy()
    expect(container.firstElementChild?.className).toBe('status-card ok')
  })

  it.each([
    ['off', 'Reminders are off on this device', 'Turn on notifications below to get dose alerts.'],
    ['denied', "Reminders can't reach this device", 'Notifications are turned off for this site.'],
    ['unsupported', "This browser can't show reminders", 'Try a different browser to get dose alerts.'],
  ] as const)('warns when the device is %s', (state, title, detail) => {
    const { container } = render(<ReminderStatus state={state} zone={null} />)
    expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getByText(detail)).toBeTruthy()
    expect(container.firstElementChild?.className).toBe('status-card warn')
  })
})
