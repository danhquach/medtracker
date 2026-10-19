import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )

describe('App', () => {
  it('renders bottom tabs', () => {
    renderAt('/today')
    for (const name of ['Today', 'Meds', 'History']) {
      expect(screen.getByRole('link', { name })).toBeTruthy()
    }
  })

  it('redirects / to /today', () => {
    renderAt('/')
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
  })
})
