// Generates public/icon-192.png and icon-512.png (pill on dark) using only Node built-ins.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const BG = [0x16, 0x16, 0x16]
const ACCENT = [0xe2, 0x57, 0x4c]

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

// Coverage of a 45-degree capsule (unit square coords) with a dark seam in the middle.
function sample(x, y) {
  const u = (x - 0.5) * Math.SQRT1_2 + (y - 0.5) * Math.SQRT1_2 // along the pill
  const v = -(x - 0.5) * Math.SQRT1_2 + (y - 0.5) * Math.SQRT1_2 // across the pill
  const half = 0.3
  const r = 0.14
  const dx = Math.max(Math.abs(u) - (half - r), 0)
  const inside = dx * dx + v * v <= r * r
  if (!inside) return 0
  return Math.abs(u) < 0.012 ? 0.35 : 1 // seam
}

function png(size) {
  const ss = 3
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let o = 0
  for (let py = 0; py < size; py++) {
    raw[o++] = 0
    for (let px = 0; px < size; px++) {
      let a = 0
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) a += sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
      a /= ss * ss
      for (let i = 0; i < 3; i++) raw[o++] = Math.round(BG[i] + (ACCENT[i] - BG[i]) * a)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s))
