import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import DeleteDialog from './DeleteDialog'

describe('DeleteDialog', () => {
  const renderDialog = (busy = false) => {
    const onConfirm = vi.fn()
    const onClose = vi.fn()
    render(<DeleteDialog busy={busy} returnFocus={createRef()} onConfirm={onConfirm} onClose={onClose} />)
    return { onConfirm, onClose }
  }

  it('confirms only once DELETE is typed', () => {
    const { onConfirm } = renderDialog()
    const confirm = screen.getByRole('button', { name: 'Delete my profile' }) as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'delete' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Type DELETE to confirm'), { target: { value: 'DELETE' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('shows progress while deleting', () => {
    renderDialog(true)
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeTruthy()
  })

  it('Cancel closes it', () => {
    const { onClose } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
