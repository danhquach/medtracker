import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  native: true,
  plugin: true,
  tap: vi.fn(async () => {}),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, isPluginAvailable: () => h.plugin },
  registerPlugin: () => ({ tap: h.tap }),
}))

const { startTapHaptics } = await import('./tapHaptics')

let stop: () => void = () => {}

beforeEach(() => {
  vi.clearAllMocks()
  h.native = true
  h.plugin = true
  document.body.innerHTML = `
    <button id="save">Save <span id="label">now</span></button>
    <button id="off" disabled>Off</button>
    <a id="tab" href="/meds">Meds</a>
    <p id="text">Plain text</p>`
})

afterEach(() => stop())

const click = (id: string) => document.getElementById(id)!.click()

describe('startTapHaptics', () => {
  it('taps once for each button or link pressed, including taps on a button label', () => {
    stop = startTapHaptics()
    click('save')
    click('label')
    click('tab')
    expect(h.tap).toHaveBeenCalledTimes(3)
  })

  it('stays silent for disabled buttons and non-interactive content', () => {
    stop = startTapHaptics()
    click('off')
    click('text')
    expect(h.tap).not.toHaveBeenCalled()
  })

  it('does nothing in the browser or on an app build without the native plugin', () => {
    h.native = false
    stop = startTapHaptics()
    click('save')
    stop()
    h.native = true
    h.plugin = false
    stop = startTapHaptics()
    click('save')
    expect(h.tap).not.toHaveBeenCalled()
  })

  it('ignores a failed native call', async () => {
    h.tap.mockRejectedValueOnce(new Error('no vibrator'))
    stop = startTapHaptics()
    expect(() => click('save')).not.toThrow()
    await Promise.resolve()
  })
})
