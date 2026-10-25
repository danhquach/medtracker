import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ setPassword: vi.fn(() => Promise.resolve()) }))
vi.mock('./auth', () => ({ setPassword: api.setPassword }))
import SetPasswordForm from './SetPasswordForm'

describe('SetPasswordForm', () => {
  it('shows a short password error under the field, linked after the rule, and does not save', () => {
    render(<SetPasswordForm />)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set your password' }))
    const input = screen.getByLabelText('New password')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const described = input.getAttribute('aria-describedby')!.split(' ').map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['At least 8 characters.', 'Password must be at least 8 characters'])
    expect(document.activeElement).toBe(input)
    expect(api.setPassword).not.toHaveBeenCalled()
  })

  it('saves a valid password', async () => {
    render(<SetPasswordForm />)
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'password123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set your password' }))
    await waitFor(() => expect(api.setPassword).toHaveBeenCalledWith('password123'))
    expect((await screen.findByRole('status')).textContent).toBe('Password set.')
  })
})
