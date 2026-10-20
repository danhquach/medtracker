import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const landing = vi.hoisted(() => ({ url: 'http://localhost/today' }))
vi.mock('../../lib/supabase', () => ({
  get landingUrl() {
    return landing.url
  },
}))

import EmailLinkNotice from './EmailLinkNotice'
import { readEmailLink, resetEmailLinkForTest } from './emailLink'

describe('readEmailLink', () => {
  it('a confirmed sign-up link → verified', () => {
    expect(readEmailLink('https://x.io/medtracker/today#access_token=t&type=signup')).toBe('verified')
  })
  it('a confirmed guest-upgrade link → verified', () => {
    expect(readEmailLink('https://x.io/medtracker/settings?finish=1#access_token=t&type=email_change')).toBe('verified')
  })
  it('an expired link (error in the hash) → failed', () => {
    expect(readEmailLink('https://x.io/today#error=access_denied&error_code=otp_expired&error_description=x')).toBe('failed')
  })
  it('an error in the query → failed', () => {
    expect(readEmailLink('https://x.io/today?error=access_denied&error_code=otp_expired')).toBe('failed')
  })
  it('a password-reset or ordinary page → nothing', () => {
    expect(readEmailLink('https://x.io/today#access_token=t&type=recovery')).toBeNull()
    expect(readEmailLink('https://x.io/settings?finish=1')).toBeNull()
    expect(readEmailLink('https://x.io/today')).toBeNull()
  })
})

describe('EmailLinkNotice', () => {
  beforeEach(() => resetEmailLinkForTest())

  it('says the email was verified and who is signed in, until dismissed', () => {
    landing.url = 'http://localhost/today#access_token=t&type=signup'
    render(<EmailLinkNotice email="a@example.com" />)
    expect(screen.getByRole('status').textContent).toContain('Email verified. You’re signed in as a@example.com.')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('a verified link without a signed-in email (crafted link) → nothing', () => {
    landing.url = 'http://localhost/today#access_token=junk&type=signup'
    const { container } = render(<EmailLinkNotice />)
    expect(container.innerHTML).toBe('')
  })

  it('shows once per link: a later screen does not repeat it', () => {
    landing.url = 'http://localhost/today#access_token=t&type=signup'
    const first = render(<EmailLinkNotice email="a@example.com" />)
    first.unmount()
    render(<EmailLinkNotice email="a@example.com" />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('signed out with an expired link: explains how to get a new one', () => {
    landing.url = 'http://localhost/today#error=access_denied&error_code=otp_expired'
    render(<EmailLinkNotice />)
    expect(screen.getByRole('alert').textContent).toMatch(/expired or was already used.*Create a profile again/)
  })

  it('as a guest with an expired link: points to Settings', () => {
    landing.url = 'http://localhost/settings?finish=1#error=access_denied&error_code=otp_expired'
    render(<EmailLinkNotice guest />)
    expect(screen.getByRole('alert').textContent).toMatch(/add your email again in Settings/)
  })

  it('removes the error from the address so a reload does not show it again', () => {
    history.replaceState(null, '', '/settings?finish=1&error=access_denied&error_code=otp_expired#error=access_denied')
    landing.url = location.href
    render(<EmailLinkNotice guest />)
    expect(location.pathname + location.search + location.hash).toBe('/settings?finish=1')
  })

  it('no link → renders nothing', () => {
    landing.url = 'http://localhost/today'
    const { container } = render(<EmailLinkNotice email="a@example.com" />)
    expect(container.innerHTML).toBe('')
  })
})
