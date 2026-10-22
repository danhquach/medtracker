// @vitest-environment node
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { icons } from './make-icons.mjs'

// Header + decoded pixels, so a different zlib build compressing the same image still matches.
function pixels(png: Buffer) {
  const chunks: Record<string, Buffer> = {}
  for (let o = 8; o < png.length; ) {
    const len = png.readUInt32BE(o)
    chunks[png.toString('ascii', o + 4, o + 8)] = png.subarray(o + 8, o + 8 + len)
    o += len + 12
  }
  return { header: chunks.IHDR, data: inflateSync(chunks.IDAT) }
}

describe('app icons (MT-70)', () => {
  const all = Object.entries(icons() as Record<string, Buffer>)

  it('covers the web icons and every Android density', () => {
    expect(all).toHaveLength(2 + 5 * 5)
  })

  it.each(all)('%s matches scripts/make-icons.mjs (run it after changing the pill)', (path, bytes) => {
    expect(pixels(readFileSync(new URL(`../${path}`, import.meta.url)))).toEqual(pixels(bytes))
  })
})
