// Builds the bundled copy of Health Canada's product list (MT-100) that Add Med looks DINs up in,
// using only Node built-ins (plus the system `unzip`). Run by hand about monthly:
//   node scripts/build-product-data.mjs
// Writes (committed, so deploys never contact Health Canada):
// - public/products/din.json   { generatedAt, products: { "<8-digit DIN>": { name, form, strength, discontinued } } }
// - src/features/dinLookup/dataVersion.ts
// A failed download exits non-zero and leaves the committed files untouched.
//
// Source: Drug Product Database (DPD) extracts, "read file" page:
// https://www.canada.ca/en/health-canada/services/drugs-health-products/drug-products/drug-product-database/read-file-drug-product-database-data-extract.html
// Four zips (marketed, approved, dormant, inactive); every file is quoted CSV in UTF-8, CRLF, no header,
// joined by DRUG_CODE (column 0). Columns used:
// - drug*.txt:   0 DRUG_CODE, 2 CLASS, 3 DRUG_IDENTIFICATION_NUMBER, 4 BRAND_NAME
// - status*.txt: 0 DRUG_CODE, 1 CURRENT_STATUS_FLAG (Y/N), 2 STATUS, 3 HISTORY_DATE (DD-MON-YYYY)
// - form*.txt:   0 DRUG_CODE, 2 PHARMACEUTICAL_FORM
// - ingred*.txt: 0 DRUG_CODE, 2 INGREDIENT, 4 STRENGTH, 5 STRENGTH_UNIT
//
// Natural products (NPN / DIN-HM) come from the LNHPD API, which returned 503 on 2026-10-25, so this
// build ships DIN only (lists: ['din']). Adding public/products/npn.json is a follow-up.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DPD = 'https://www.canada.ca/content/dam/hc-sc/documents/services/drug-product-database/'
const EXTRACTS = [['allfiles.zip', ''], ['allfiles_ap.zip', '_ap'], ['allfiles_dr.zip', '_dr'], ['allfiles_ia.zip', '_ia']]

export function parseCsvLine(line) {
  const out = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out
}

export function mapForm(text) {
  const t = text.toLowerCase()
  if (/tablet|chewable|caplet/.test(t)) return 'tablet'
  if (t.includes('capsule')) return 'capsule'
  // "POWDER FOR SOLUTION" is a powder until mixed, not a liquid.
  if (t.includes('powder')) return 'other'
  if (/liquid|solution|syrup|suspension|drops|elixir/.test(t)) return 'liquid'
  return 'other'
}

const UNITS = { MG: 'mg', G: 'g', MCG: 'mcg', ML: 'mL', UNIT: 'unit' }
const amount = ({ strength, unit }) =>
  [strength.trim(), UNITS[unit.trim().toUpperCase()] ?? unit.trim()].filter(Boolean).join(' ')

export function formatStrength(ings) {
  if (ings.length === 1) return amount(ings[0])
  return ings.map((i) => [i.name.trim(), amount(i)].filter(Boolean).join(' ')).join(', ')
}

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 }
// DD-MON-YYYY → YYYYMMDD, so dates compare as numbers; unparseable → 0 (oldest).
const dateKey = (d) => {
  const [day, mon, year] = d.split('-')
  return Number(year) * 10000 + (MONTHS[mon?.toUpperCase()] ?? 0) * 100 + Number(day) || 0
}
const RANK = { MARKETED: 4, APPROVED: 3, DORMANT: 2 }
const rank = (status) => RANK[status] ?? (status.startsWith('CANCELLED') ? 1 : 0)

export function pickDpdRow(rows) {
  let best = 0
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i]
    const b = rows[best]
    if (rank(a.status) > rank(b.status) || (rank(a.status) === rank(b.status) && dateKey(a.statusDate) > dateKey(b.statusDate))) best = i
  }
  return best
}

const groupByCode = (rows) => {
  const map = new Map()
  for (const r of rows) {
    if (!map.has(r[0])) map.set(r[0], [])
    map.get(r[0]).push(r)
  }
  return map
}

export function buildDin({ drug, status, form, ingred }) {
  const statuses = groupByCode(status)
  const forms = groupByCode(form)
  const ingreds = groupByCode(ingred)
  // A drug code's status is its current-flag row (latest history row if none is flagged).
  const statusOf = (code) => {
    const rows = statuses.get(code) ?? []
    const row = rows.find((r) => r[1] === 'Y') ?? rows.toSorted((a, b) => dateKey(b[3]) - dateKey(a[3]))[0]
    return { status: row?.[2] ?? '', statusDate: row?.[3] ?? '' }
  }
  const byDin = new Map()
  for (const d of drug) {
    const din = d[3]
    if (!/^\d{8}$/.test(din)) continue
    if (!byDin.has(din)) byDin.set(din, [])
    byDin.get(din).push({ code: d[0], name: d[4].trim(), ...statusOf(d[0]) })
  }
  const products = {}
  for (const din of [...byDin.keys()].sort()) {
    const candidates = byDin.get(din)
    const pick = candidates[pickDpdRow(candidates)]
    products[din] = {
      name: pick.name,
      form: mapForm(forms.get(pick.code)?.[0]?.[2] ?? ''),
      strength: formatStrength((ingreds.get(pick.code) ?? []).map((r) => ({ name: r[2], strength: r[4], unit: r[5] }))),
      discontinued: rank(pick.status) < 2,
    }
  }
  return products
}

async function download(url, dest) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
      return
    } catch (err) {
      if (attempt === 3) throw new Error(`${url}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

const readRows = (zip, name) =>
  execFileSync('unzip', ['-p', zip, name], { maxBuffer: 1 << 30 }).toString('utf8')
    .split(/\r?\n/).filter(Boolean).map(parseCsvLine)

// Writes next to the target, then renames, so a crash never leaves a half-written file.
const writeAtomic = (url, text) => {
  const path = fileURLToPath(url)
  writeFileSync(`${path}.tmp`, text)
  renameSync(`${path}.tmp`, path)
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'dpd-'))
  try {
    const files = { drug: [], status: [], form: [], ingred: [] }
    for (const [zip, suffix] of EXTRACTS) {
      await download(DPD + zip, join(dir, zip))
      for (const kind of Object.keys(files)) files[kind].push(...readRows(join(dir, zip), `${kind}${suffix}.txt`))
    }
    const products = buildDin(files)
    const generatedAt = new Date().toISOString().slice(0, 10)
    // One product per line keeps monthly refreshes reviewable as a diff.
    const rows = Object.entries(products).map(([din, p]) => `${JSON.stringify(din)}:${JSON.stringify(p)}`)
    const root = new URL('../', import.meta.url)
    mkdirSync(new URL('public/products/', root), { recursive: true })
    mkdirSync(new URL('src/features/dinLookup/', root), { recursive: true })
    writeAtomic(new URL('public/products/din.json', root), `{"generatedAt":"${generatedAt}","products":{\n${rows.join(',\n')}\n}}\n`)
    writeAtomic(new URL('src/features/dinLookup/dataVersion.ts', root),
      '// Generated by scripts/build-product-data.mjs. Do not edit by hand.\n' +
      `export const PRODUCT_DATA: { generatedAt: string; lists: ('din' | 'npn')[] } = { generatedAt: '${generatedAt}', lists: ['din'] }\n`)
    console.log(`din.json: ${rows.length} products, as of ${generatedAt}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message)
    process.exit(1)
  })
}
