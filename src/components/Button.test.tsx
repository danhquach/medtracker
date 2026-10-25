import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    render(
      <form onSubmit={(e) => onSubmit(e.nativeEvent)}>
        <Button>Cancel</Button>
      </form>,
    )
    const b = screen.getByRole('button', { name: 'Cancel' })
    expect(b.getAttribute('type')).toBe('button')
    expect(b.className).toBe('')
    fireEvent.click(b)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it.each([
    ['primary', 'primary'],
    ['quiet', 'quiet'],
    ['link', 'link'],
    ['danger', 'danger'],
    ['fab', 'primary fab'],
  ] as const)('maps the %s variant to its existing style', (variant, cls) => {
    render(<Button variant={variant}>Go</Button>)
    expect(screen.getByRole('button').className).toBe(cls)
  })

  it('names an icon button by its label', () => {
    render(
      <Button variant="icon" aria-label="Back">
        <svg />
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Back' }).className).toBe('icon-button')
  })

  it('keeps extra classes next to the variant', () => {
    render(
      <Button variant="primary" className="wide">
        Go
      </Button>,
    )
    expect(screen.getByRole('button').className).toBe('primary wide')
  })

  it('disables and announces itself while busy', () => {
    const onClick = vi.fn()
    const { rerender } = render(<Button onClick={onClick}>Save</Button>)
    const b = screen.getByRole('button')
    expect(b.hasAttribute('aria-busy')).toBe(false)
    rerender(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    )
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect((b as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(b)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('passes a ref to the button', () => {
    let el: HTMLButtonElement | null = null
    render(<Button ref={(e) => void (el = e)}>Go</Button>)
    expect(el).toBe(screen.getByRole('button'))
  })
})

// @ts-expect-error an icon button must have an accessible label
void (<Button variant="icon" />)
