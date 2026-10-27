import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  native: true,
  plugins: ['LabelReader'],
  scan: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, isPluginAvailable: (name: string) => h.plugins.includes(name) },
  registerPlugin: () => ({ scan: h.scan }),
}))

const { canScanLabel, scanLabel } = await import('./labelScan')

const rejectWith = (code: string) => h.scan.mockRejectedValueOnce(Object.assign(new Error(code), { code }))

beforeEach(() => {
  h.scan.mockReset()
  h.native = true
  h.plugins = ['LabelReader']
})

describe('canScanLabel', () => {
  it('is on in an app install with the Tesseract reader', () => {
    expect(canScanLabel()).toBe(true)
  })

  it('is off on the web, and on an older install that only has the ML Kit scanner (it uploads logs to Google)', () => {
    h.plugins = ['LabelScanner']
    expect(canScanLabel()).toBe(false)
    h.plugins = ['LabelReader']
    h.native = false
    expect(canScanLabel()).toBe(false)
  })
})

describe('scanLabel', () => {
  it('returns the label numbers, the one next to DIN first', async () => {
    h.scan.mockResolvedValueOnce({
      blocks: [
        { text: 'LOT 80012345', lines: ['LOT 80012345'] },
        { text: 'DIN 0224 2963\n200 mg', lines: ['DIN 0224 2963', '200 mg'] },
      ],
    })
    expect(await scanLabel()).toEqual(['02242963', '80012345'])
  })

  it('drops numbers no DIN or NPN starts with, which are misreads', async () => {
    h.scan.mockResolvedValueOnce({
      blocks: [
        { text: 'NPN 60058511', lines: ['NPN 60058511'] },
        { text: 'LLS8S008 41989008', lines: ['LLS8S008 41989008'] },
        { text: 'NPN 80058511', lines: ['NPN 80058511'] },
      ],
    })
    expect(await scanLabel()).toEqual(['80058511'])
  })

  it('maps a closed camera, a missing camera app and an unreadable photo', async () => {
    rejectWith('CANCELLED')
    expect(await scanLabel()).toBe('cancelled')
    rejectWith('NO_CAMERA')
    expect(await scanLabel()).toBe('no-camera')
    rejectWith('READ_FAILED')
    expect(await scanLabel()).toEqual([])
  })
})
