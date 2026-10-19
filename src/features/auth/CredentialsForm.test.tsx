import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ signIn: vi.fn(() => Promise.resolve()), signUp: vi.fn(() => Promise.resolve(false)) }))
vi.mock('./auth', () => ({
  signIn: api.signIn,
  signUp: api.signUp,
  createProfile: vi.fn(),
  GUEST_LEFT_BEHIND: 'Your guest data on this device will be left behind.',
}))
import CredentialsForm from './CredentialsForm'

beforeEach(() => api.signIn.mockClear())

describe('CredentialsForm guest sign-in', () => {
  it('warns on first submit, signs in on second', async () => {
    render(<CredentialsForm mode="signin" guest />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Your guest data on this device will be left behind.')).toBeTruthy()
    expect(api.signIn).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(api.signIn).toHaveBeenCalledWith('a@example.com', 'password123'))
  })
})

describe('CredentialsForm sign-up', () => {
  it('states the password rule before submit', () => {
    render(<CredentialsForm mode="signup" />)
    const rule = screen.getByText('At least 8 characters.')
    expect(screen.getByLabelText('Password').getAttribute('aria-describedby')).toBe(rule.id)
  })

  it('does not show the rule when signing in', () => {
    render(<CredentialsForm mode="signin" />)
    expect(screen.queryByText('At least 8 characters.')).toBeNull()
  })

  it('offers Back to sign in while email confirmation is pending', async () => {
    const onSignIn = vi.fn()
    render(<CredentialsForm mode="signup" onSignIn={onSignIn} />)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))
    expect((await screen.findByRole('status')).textContent).toContain('a@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
    expect(onSignIn).toHaveBeenCalled()
  })
})
