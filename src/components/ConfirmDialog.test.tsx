import { act, fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter, Link, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'
import { useConfirm } from './useConfirm'

describe('ConfirmDialog', () => {
  const renderDialog = (props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const { unmount } = render(
      <ConfirmDialog title="Delete Aspirin?" confirmLabel="Delete" danger onConfirm={onConfirm} onCancel={onCancel} {...props}>
        <p>This also removes its history.</p>
      </ConfirmDialog>,
    )
    return { onConfirm, onCancel, unmount }
  }

  it('is a labelled, described modal dialog', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Delete Aspirin?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('This also removes its history.')
    expect(screen.getByRole('button', { name: 'Delete' }).className).toBe('danger')
  })

  it('focuses Cancel first, so a stray Enter never confirms, and keeps Tab inside', () => {
    renderDialog()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(document.activeElement).toBe(cancel)
    confirm.focus()
    fireEvent.keyDown(confirm, { key: 'Tab' })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm)
  })

  it('confirms, cancels, and cancels on Escape unless busy', () => {
    const { onConfirm, onCancel } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('ignores Escape and disables both buttons while busy', () => {
    const { onCancel } = renderDialog({ busy: true })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('returns focus to the opener on close', () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(
      <ConfirmDialog title="Stop?" confirmLabel="Stop" onConfirm={() => {}} onCancel={() => {}}>
        <p>No doses after today.</p>
      </ConfirmDialog>,
    )
    expect(document.activeElement).not.toBe(opener)
    unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('cancels on Escape even after focus left the dialog', () => {
    const { onCancel } = renderDialog()
    ;(document.activeElement as HTMLElement).blur()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('makes the rest of the page inert while open, and restores it on close', () => {
    const page = document.createElement('div')
    document.body.appendChild(page)
    const { unmount } = renderDialog()
    expect(page.hasAttribute('inert')).toBe(true)
    expect(screen.getByRole('dialog').closest('[inert]')).toBeNull()
    unmount()
    expect(page.hasAttribute('inert')).toBe(false)
    page.remove()
  })

  it("returns focus to a closed menu's toggle when the opener was a menu item", () => {
    const menu = document.createElement('details')
    menu.innerHTML = '<summary>More</summary><button>Delete…</button>'
    menu.open = true
    document.body.appendChild(menu)
    menu.querySelector('button')!.focus()
    menu.open = false
    const { unmount } = renderDialog()
    unmount()
    expect(document.activeElement).toBe(menu.querySelector('summary'))
    menu.remove()
  })
})

describe('useConfirm', () => {
  function Harness({ onResult }: { onResult: (ok: boolean) => void }) {
    const [confirm, dialog] = useConfirm()
    return (
      <>
        <button onClick={() => void confirm({ title: 'Stop Aspirin?', message: 'No doses after today.', confirmLabel: 'Stop' }).then(onResult)}>
          Open
        </button>
        {dialog}
      </>
    )
  }

  it.each([
    ['Stop', true],
    ['Cancel', false],
  ])('resolves %s → %s and closes', async (button, expected) => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(screen.getByRole('dialog', { name: 'Stop Aspirin?' }).textContent).toContain('No doses after today.')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: button })))
    expect(onResult).toHaveBeenCalledWith(expected)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('answers Cancel when the screen goes away with the question open', async () => {
    const onResult = vi.fn()
    const { unmount } = render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    unmount()
    await act(async () => {})
    expect(onResult).toHaveBeenCalledWith(false)
  })

  it('answers Cancel to an earlier question when a newer one replaces it', async () => {
    const onResult = vi.fn()
    render(<Harness onResult={onResult} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open', hidden: true }))
    await act(async () => {})
    expect(onResult).toHaveBeenCalledWith(false)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop' })))
    expect(onResult.mock.calls).toEqual([[false], [true]])
  })
})

describe('Back with a dialog open (MT-110)', () => {
  function Screen({ onResult }: { onResult: (ok: boolean) => void }) {
    const [confirm, dialog] = useConfirm()
    return (
      <>
        <p data-testid="path">{useLocation().pathname}</p>
        <Link to="/meds/1/edit">Edit</Link>
        <button onClick={() => void confirm({ title: 'Delete Aspirin?', message: 'Gone for good.', confirmLabel: 'Delete' }).then(onResult)}>
          Delete
        </button>
        {dialog}
      </>
    )
  }

  // List → edit screen, so there is a step back to take.
  const renderOnEditScreen = () => {
    window.history.replaceState(null, '', '/meds')
    const onResult = vi.fn()
    render(
      <BrowserRouter>
        <Screen onResult={onResult} />
      </BrowserRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Edit' }))
    expect(screen.getByTestId('path').textContent).toBe('/meds/1/edit')
    return onResult
  }
  const back = () => act(async () => window.history.back())
  const settled = () => act(() => new Promise((r) => setTimeout(r, 50)))

  it('cancels the dialog and stays on the screen', async () => {
    const onResult = renderOnEditScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await back()
    await settled()
    expect(onResult).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('path').textContent).toBe('/meds/1/edit')
    expect(window.location.pathname).toBe('/meds/1/edit')
  })

  it('goes back as usual with no dialog open, including after one closed', async () => {
    renderOnEditScreen()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    await back()
    await settled()
    expect(screen.getByTestId('path').textContent).toBe('/meds')
    expect(window.location.pathname).toBe('/meds')
  })

  it('stays put without cancelling while busy', async () => {
    renderOnEditScreen()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog title="Delete profile?" confirmLabel="Deleting…" busy onConfirm={() => {}} onCancel={onCancel}>
        <p>Deleting.</p>
      </ConfirmDialog>,
    )
    await back()
    await settled()
    expect(onCancel).not.toHaveBeenCalled()
    expect(screen.getByTestId('path').textContent).toBe('/meds/1/edit')
  })
})
