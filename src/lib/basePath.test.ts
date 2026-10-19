import { describe, expect, it } from 'vitest'
import { appUrl, routerBasename } from './basePath'

describe('routerBasename', () => {
  it('strips the trailing slash', () => {
    expect(routerBasename('/medtracker/')).toBe('/medtracker')
  })
  it('keeps root as /', () => {
    expect(routerBasename('/')).toBe('/')
  })
})

describe('appUrl', () => {
  it('includes the base', () => {
    expect(appUrl('settings?finish=1', 'https://example.github.io', '/medtracker/')).toBe(
      'https://example.github.io/medtracker/settings?finish=1',
    )
  })
  it('works at root', () => {
    expect(appUrl('settings?finish=1', 'http://localhost:5173', '/')).toBe('http://localhost:5173/settings?finish=1')
  })
})
