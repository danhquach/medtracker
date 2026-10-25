import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NumberField, SelectField, TextField, TimeField } from './Field'

const describedText = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' | ')

describe('shared fields', () => {
  it('label names the control; no error means not invalid and nothing described', () => {
    render(<TextField label="Nickname" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('Nickname')
    expect(input.getAttribute('aria-invalid')).toBeNull()
    expect(input.getAttribute('aria-describedby')).toBeNull()
  })

  it('an error marks the control invalid and links the message to it', () => {
    render(<TextField label="Email" error="Enter your email" value="" onChange={() => {}} />)
    const input = screen.getByLabelText('Email')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(describedText(input)).toBe('Enter your email')
    expect(screen.getByText('Enter your email').className).toBe('field-error')
  })

  it('hint and error are both announced, hint first', () => {
    render(<TextField label="Password" hint="At least 8 characters." error="Too short" value="" onChange={() => {}} />)
    expect(describedText(screen.getByLabelText('Password'))).toBe('At least 8 characters. | Too short')
  })

  it('number, time and dropdown fields wire up the same way', () => {
    render(
      <>
        <NumberField label="Stock" error="Bad stock" value="" onChange={() => {}} />
        <TimeField label="Time 1" error="Bad time" value="" onChange={() => {}} />
        <SelectField label="Form" error="Bad form" value="" onChange={() => {}}>
          <option value="">—</option>
        </SelectField>
      </>,
    )
    const stock = screen.getByLabelText('Stock')
    expect(stock.getAttribute('type')).toBe('number')
    expect(describedText(stock)).toBe('Bad stock')
    expect(screen.getByLabelText('Time 1').getAttribute('type')).toBe('time')
    expect(describedText(screen.getByLabelText('Time 1'))).toBe('Bad time')
    expect(screen.getByLabelText('Form').tagName).toBe('SELECT')
    expect(describedText(screen.getByLabelText('Form'))).toBe('Bad form')
  })
})
