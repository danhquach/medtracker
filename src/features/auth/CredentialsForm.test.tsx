import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ signIn: vi.fn(() => Promise.resolve()) }))
vi.mock('./auth', () => ({
  signIn: api.signIn,
  signUp: vi.fn(),
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
