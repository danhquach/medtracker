import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  native: true,
  plugins: true,
  writeFile: vi.fn(async () => ({ uri: 'file:///cache/medtracker-plan.csv' })),
  share: vi.fn(async () => ({})),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native, isPluginAvailable: () => h.plugins },
}))
vi.mock('@capacitor/filesystem', () => ({
  Filesystem: { writeFile: h.writeFile },
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
}))
vi.mock('@capacitor/share', () => ({ Share: { share: h.share } }))

const { canShareFile, shareFile } = await import('./shareFile')

beforeEach(() => {
  vi.clearAllMocks()
  h.native = true
  h.plugins = true
})

describe('canShareFile', () => {
  it('is true only in the app with both plugins', () => {
    expect(canShareFile()).toBe(true)
    h.plugins = false
    expect(canShareFile()).toBe(false)
    h.plugins = true
    h.native = false
    expect(canShareFile()).toBe(false)
  })
})

describe('shareFile', () => {
  it('writes the file to the cache and opens the share sheet with it', async () => {
    await shareFile('medtracker-plan.csv', 'a,b')
    expect(h.writeFile).toHaveBeenCalledWith({
      path: 'medtracker-plan.csv', data: 'a,b', directory: 'CACHE', encoding: 'utf8',
    })
    expect(h.share).toHaveBeenCalledWith({ title: 'medtracker-plan.csv', files: ['file:///cache/medtracker-plan.csv'] })
  })

  it('treats closing the share sheet as done, not an error', async () => {
    h.share.mockRejectedValueOnce(new Error('Share canceled'))
    await expect(shareFile('x.csv', '')).resolves.toBeUndefined()
  })

  it('passes other share errors on', async () => {
    h.share.mockRejectedValueOnce(new Error('boom'))
    await expect(shareFile('x.csv', '')).rejects.toThrow('boom')
  })
})
