import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Card, Chip, Notice, Row, RowGroup } from './layout'

describe('shared layout pieces', () => {
  it('Card is a list item by default and keeps the screen-specific class', () => {
    render(
      <ul>
        <Card className="med-card">Aspirin</Card>
      </ul>,
    )
    const card = screen.getByRole('listitem')
    expect(card.className).toBe('card med-card')
  })

  it('a Row with htmlFor labels its control and describes it', () => {
    render(
      <RowGroup>
        <Row htmlFor="snooze" name="Snooze length" desc="How long Snooze waits.">
          <select id="snooze" aria-describedby="snooze-desc" />
        </Row>
      </RowGroup>,
    )
    const select = screen.getByLabelText('Snooze length')
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toBe('How long Snooze waits.')
    expect(select.closest('.list-row')?.parentElement?.className).toBe('row-group')
  })

  it('a wide Row without a control id shows its name as text', () => {
    render(
      <RowGroup as="ul">
        <Row as="li" wide name="Mon 9:00 AM">
          <button>Taken</button>
        </Row>
      </RowGroup>,
    )
    const row = screen.getByRole('listitem')
    expect(row.className).toBe('list-row wide')
    expect(screen.getByText('Mon 9:00 AM').tagName).toBe('P')
  })

  it('Chip tones', () => {
    render(
      <>
        <Chip>Paused</Chip>
        <Chip tone="low">2 left</Chip>
        <Chip inline>Paused inline</Chip>
      </>,
    )
    expect(screen.getByText('Paused').className).toBe('chip')
    expect(screen.getByText('2 left').className).toBe('chip chip-low')
    expect(screen.getByText('Paused inline').className).toBe('chip chip-inline')
  })

  it('an info Notice is a polite status; an error Notice is an alert', () => {
    render(
      <>
        <Notice>Saved.</Notice>
        <Notice tone="error">Could not save</Notice>
      </>,
    )
    expect(screen.getByRole('status').className).toBe('notice')
    expect(screen.getByRole('alert').className).toBe('notice notice-error')
  })
})
