import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ native: true }))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native },
}))

const { startSlowPress, CLICK_WAIT_MS } = await import('./slowPress')

let stop: () => void = () => {}
let clicks: string[] = []
let under: Element | null = null

beforeEach(() => {
  vi.useFakeTimers()
  h.native = true
  clicks = []
  document.body.innerHTML = `
    <div id="app">
      <button id="save">Save <span id="label">now</span></button>
      <button id="off" disabled>Off</button>
      <a id="tab" href="#meds">Meds</a>
      <p id="text">Plain text</p>
    </div>`
  el('app').addEventListener('click', (e) => clicks.push((e.target as Element).closest('[id]')!.id))
  // jsdom has no layout: the element "under the finger" at release is whatever the test says.
  document.elementFromPoint = () => under
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

const el = (id: string) => document.getElementById(id)!
const fire = (id: string, type: string, pointerType = 'touch') =>
  el(id).dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { pointerType, clientX: 0, clientY: 0 }))

/** A press on `id` released over `releaseOn`, with no click from the WebView. */
function slowPress(id: string, releaseOn = id, pointerType = 'touch') {
  under = el(releaseOn)
  fire(id, 'pointerdown', pointerType)
  fire(id, 'pointerup', pointerType)
  vi.advanceTimersByTime(CLICK_WAIT_MS)
}

describe('startSlowPress', () => {
  it('clicks a button or link once when a held press is released on it', () => {
    stop = startSlowPress()
    slowPress('label', 'label')
    slowPress('tab')
    expect(clicks).toEqual(['save', 'tab'])
  })

  it('adds nothing to a normal tap, which already clicked', () => {
    stop = startSlowPress()
    under = el('save')
    fire('save', 'pointerdown')
    fire('save', 'pointerup')
    el('save').click()
    vi.advanceTimersByTime(CLICK_WAIT_MS)
    expect(clicks).toEqual(['save'])
  })

  it('does not click when the finger slid off, the press was cancelled, or it was not a control', () => {
    stop = startSlowPress()
    slowPress('save', 'text')
    under = el('save')
    fire('save', 'pointerdown')
    fire('save', 'pointercancel')
    fire('save', 'pointerup')
    vi.advanceTimersByTime(CLICK_WAIT_MS)
    slowPress('text')
    slowPress('off')
    expect(clicks).toEqual([])
  })

  it('tells the app shell whether each press started on a control', () => {
    const start = vi.fn()
    window.MedTrackerPress = { start }
    stop = startSlowPress()
    fire('label', 'pointerdown')
    fire('text', 'pointerdown')
    fire('save', 'pointerdown', 'mouse')
    delete window.MedTrackerPress
    fire('save', 'pointerdown')
    expect(start.mock.calls).toEqual([[true], [false], [false]])
  })

  it('leaves mouse presses and the web/PWA build alone', () => {
    stop = startSlowPress()
    slowPress('save', 'save', 'mouse')
    stop()
    h.native = false
    stop = startSlowPress()
    slowPress('save')
    expect(clicks).toEqual([])
  })
})
