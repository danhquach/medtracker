// Generates every app icon from one drawing (two-tone capsule across a clock ring, MT-70), using
// only Node built-ins. public/favicon.svg is the same drawing by hand; keep the two in step.
// - public/icon-192.png, icon-512.png (web app: drawing on a dark square)
// - Android launcher icons per density: legacy square + round, adaptive foreground, themed (monochrome)
// - Android notification status-bar icon (white capsule, drawable-*/ic_stat_pill.png)
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const BG = [0x16, 0x16, 0x16]
const ACCENT = [0xe2, 0x57, 0x4c]
const CREAM = [0xf4, 0xf1, 0xec]
const RING = [0x5a, 0x5a, 0x5a]
const TICK = [0x8a, 0x8a, 0x8a]
const WHITE = [0xff, 0xff, 0xff]
const SHINE = ACCENT.map((c) => Math.round(c + (255 - c) * 0.45))

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}

// Capsule on a 45-degree axis through the centre: u runs along it (top-left to bottom-right), v across.
function capsule(x, y, half, r) {
  const u = (x - 0.5 + (y - 0.5)) * Math.SQRT1_2
  const v = (y - 0.5 - (x - 0.5)) * Math.SQRT1_2
  const along = Math.max(Math.abs(u) - (half - r), 0)
  return along * along + v * v <= r * r ? { u, v } : null
}

// The drawing at (x, y) in tile coords (unit square = the visible tile, a 64-unit grid in
// favicon.svg): [colour, alpha] of the topmost shape, or null. `mono` gives the themed-icon
// layer, where only alpha shows: the cream half and the clock are fainter than the red half.
function art(x, y, mono) {
  const pill = capsule(x, y, 0.3075, 0.141)
  if (pill) {
    const { u, v } = pill
    if (u > 0) return mono ? [WHITE, 0.55] : [CREAM, 1]
    const su = Math.max(Math.abs(u + 0.1538) - 0.0672, 0) // gloss: a thin capsule on the red half
    if (!mono && su * su + (v + 0.0737) ** 2 <= 0.0224 ** 2) return [SHINE, 1]
    return [mono ? WHITE : ACCENT, 1]
  }
  const dx = Math.abs(x - 0.5)
  const dy = Math.abs(y - 0.5)
  const tick = (a, b) => a <= 1 / 64 && b >= 18 / 64 && b <= 23 / 64 // 12, 3, 6 and 9 o'clock
  if (tick(dx, dy) || tick(dy, dx)) return mono ? [WHITE, 0.6] : [TICK, 1]
  if (Math.abs(Math.hypot(dx, dy) - 24 / 64) <= 1.5 / 64) return mono ? [WHITE, 0.6] : [RING, 1]
  return null
}

// Status-bar icon: the capsule alone, filling 20dp of the 24dp icon, with a clear seam.
function status(x, y) {
  const pill = capsule(x, y, 10 / 24, 0.19)
  return pill && Math.abs(pill.u) > 0.03 ? [WHITE, 1] : null
}

// tile: 'square' | 'circle' draws on the dark tile; none = transparent background.
// `zoom` is how much of the canvas the tile spans (adaptive icons: 72 of 108dp).
function png(size, { tile, zoom = 1, draw = art, mono = false } = {}) {
  const ss = 4
  const alpha = tile !== 'square'
  const ch = alpha ? 4 : 3
  const raw = Buffer.alloc(size * (size * ch + 1))
  let o = 0
  for (let py = 0; py < size; py++) {
    raw[o++] = 0
    for (let px = 0; px < size; px++) {
      const rgb = [0, 0, 0]
      let a = 0
      let t = 0
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size
          const y = (py + (sy + 0.5) / ss) / size
          const [col, ca] = draw(0.5 + (x - 0.5) / zoom, 0.5 + (y - 0.5) / zoom, mono) ?? [BG, 0]
          if (tile) for (let i = 0; i < 3; i++) rgb[i] += BG[i] + (col[i] - BG[i]) * ca
          else for (let i = 0; i < 3; i++) rgb[i] += col[i] * ca // premultiplied
          a += ca
          t += tile === 'circle' ? +((x - 0.5) ** 2 + (y - 0.5) ** 2 <= 0.25) : 1
        }
      const n = ss * ss
      for (let i = 0; i < 3; i++) raw[o++] = Math.round(tile ? rgb[i] / n : a ? rgb[i] / a : 0)
      if (alpha) raw[o++] = Math.round(((tile ? t : a) / n) * 255)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = alpha ? 6 : 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Adaptive icons draw on a 108dp canvas; launchers mask it to a 72dp shape and only the central
// 66dp circle is guaranteed visible. The tile spans the 72dp, so the clock ring (outer edge
// 25.5/64 of the tile) reaches 28.7dp from the centre, inside the 33dp safe zone.
const ADAPTIVE = 72 / 108

const RES = 'android/app/src/main/res'
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }

/** Every icon file, path (from the repo root) -> PNG bytes. */
export function icons() {
  const out = {}
  for (const s of [192, 512]) out[`public/icon-${s}.png`] = png(s, { tile: 'square' })
  for (const [d, k] of Object.entries(DENSITIES)) {
    out[`${RES}/mipmap-${d}/ic_launcher.png`] = png(48 * k, { tile: 'square' })
    out[`${RES}/mipmap-${d}/ic_launcher_round.png`] = png(48 * k, { tile: 'circle' })
    out[`${RES}/mipmap-${d}/ic_launcher_foreground.png`] = png(108 * k, { zoom: ADAPTIVE })
    out[`${RES}/mipmap-${d}/ic_launcher_monochrome.png`] = png(108 * k, { zoom: ADAPTIVE, mono: true })
    out[`${RES}/drawable-${d}/ic_stat_pill.png`] = png(24 * k, { draw: status })
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL('../', import.meta.url)
  for (const [path, bytes] of Object.entries(icons())) {
    const file = new URL(path, root)
    mkdirSync(new URL('.', file), { recursive: true })
    writeFileSync(file, bytes)
  }
}
