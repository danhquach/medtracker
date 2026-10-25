import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  native: true,
  plugin: true,
  scan: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, isPluginAvailable: (name: string) => h.plugin && name === 'LabelScanner' },
  registerPlugin: () => ({ scan: h.scan }),
}))

const { canScanLabel, scanLabel } = await import('./labelScan')

const rejectWith = (code: string) => h.scan.mockRejectedValueOnce(Object.assign(new Error(code), { code }))

beforeEach(() => {
  h.scan.mockReset()
  h.native = true
  h.plugin = true
})

describe('canScanLabel', () => {
  it('only on an app install that has the scanner', () => {
    expect(canScanLabel()).toBe(true)
    h.plugin = false
    expect(canScanLabel()).toBe(false)
    h.plugin = true
    h.native = false
    expect(canScanLabel()).toBe(false)
  })
})

describe('scanLabel', () => {
  it('returns the label numbers, the one next to DIN first', async () => {
    h.scan.mockResolvedValueOnce({
      blocks: [
        { text: 'LOT 12345678', lines: ['LOT 12345678'] },
        { text: 'DIN 0224 2963\n200 mg', lines: ['DIN 0224 2963', '200 mg'] },
      ],
    })
    expect(await scanLabel()).toEqual(['02242963', '12345678'])
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
