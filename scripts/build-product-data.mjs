// Builds the bundled copies of Health Canada's product lists (MT-100, MT-121) that Add Med looks a DIN or
// NPN up in, using only Node built-ins (plus the system `unzip`). Run by hand about monthly (the NPN
// ingredients take ~1 h 45 min):
//   node scripts/build-product-data.mjs            (both lists)
//   node scripts/build-product-data.mjs --din-only (DIN only, if the natural products API is down)
// Writes (committed, so deploys never contact Health Canada):
// - public/products/din.json   { generatedAt, products: { "<8-digit DIN>": { name, form, strength, discontinued } } }
// - public/products/npn.json   same shape, keyed by NPN / DIN-HM, with hm: true on a DIN-HM
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
// Natural products (NPN / DIN-HM): Licensed Natural Health Products Database (LNHPD) API, documented at
// https://health-products.canada.ca/api/documentation/lnhpd-documentation-en.html
// - ProductLicence/?lang=en&type=json with no page returns every licence (~150 MB) as one JSON array:
//   lnhpd_id, licence_number (NPN / DIN-HM), product_name (one row per name; flag_primary_name 1 marks
//   the main one), dosage_form, sub_submission_type_desc ("Homeopathic…" = DIN-HM), flag_product_status
//   (1 = active; the docs only say "active/non-active", so anything else counts as discontinued).
// - MedicinalIngredient is paged 100 rows at ~3 s a page (8,000+ pages), sorted by ingredient name, so
//   it's fetched per product instead (&id=<lnhpd_id>, ~50 ms each): ingredient_name, quantity,
//   quantity_minimum, quantity_maximum, quantity_unit_of_measure.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DPD = 'https://www.canada.ca/content/dam/hc-sc/documents/services/drug-product-database/'
const EXTRACTS = [['allfiles.zip', ''], ['allfiles_ap.zip', '_ap'], ['allfiles_dr.zip', '_dr'], ['allfiles_ia.zip', '_ia']]
const LNHPD = 'https://health-products.canada.ca/api/natural-licences/'
// Per-product ingredient requests, paced well below what the API handles (~45/s seen on 2026-10-26)
// so a monthly run never looks like a flood: ~150k products take about 1 h 45 min.
const LNHPD_WORKERS = 4
const LNHPD_PER_SECOND = 25
const NPN_MAX_INGREDIENTS = 3

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
  if (/capsule|softgel/.test(t)) return 'capsule'
  // "POWDER FOR SOLUTION" is a powder until mixed, not a liquid.
  if (t.includes('powder')) return 'other'
  if (/liquid|solution|syrup|suspension|drops|elixir/.test(t)) return 'liquid'
  return 'other'
}

const UNITS = {
  MG: 'mg', G: 'g', MCG: 'mcg', ML: 'mL', UNIT: 'unit',
  // Spelled-out units from the natural products list.
  MILLIGRAM: 'mg', MILLIGRAMS: 'mg', MICROGRAM: 'mcg', MICROGRAMS: 'mcg', GRAM: 'g', GRAMS: 'g',
  MILLILITRE: 'mL', MILLILITRES: 'mL', MILLILITER: 'mL', MILLILITERS: 'mL', 'INTERNATIONAL UNITS': 'IU',
}
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

// An NPN's main name, form and status come from its primary-name licence row; its strength from
// its medicinal ingredients (several potency rows of one ingredient collapse into one entry).
export function buildNpn(licences, ingredients) {
  const byNpn = new Map()
  for (const l of licences) {
    if (!/^\d{8}$/.test(l.licence_number)) continue
    const best = byNpn.get(l.licence_number)
    const better = !best ||
      (l.lnhpd_id === best.lnhpd_id ? l.flag_primary_name > best.flag_primary_name : (l.revised_date ?? '') > (best.revised_date ?? ''))
    if (better) byNpn.set(l.licence_number, l)
  }
  const products = {}
  for (const npn of [...byNpn.keys()].sort()) {
    const l = byNpn.get(npn)
    const seen = new Set()
    const ings = []
    for (const i of ingredients.get(l.lnhpd_id) ?? []) {
      const range = i.quantity_maximum ? `${i.quantity_minimum}-${i.quantity_maximum}` : ''
      const strength = i.quantity ? String(i.quantity) : range
      const ing = { name: i.ingredient_name ?? '', strength, unit: strength ? i.quantity_unit_of_measure ?? '' : '' }
      const key = `${ing.name}|${ing.strength}|${ing.unit}`
      // A potency-only row (no quantity) adds nothing once the ingredient is listed.
      if (seen.has(key) || (!ing.strength && ings.some((x) => x.name === ing.name))) continue
      seen.add(key)
      ings.push(ing)
    }
    products[npn] = {
      name: l.product_name.trim(),
      form: mapForm(l.dosage_form ?? ''),
      // The first few ingredients keep npn.json under ~5 MB compressed (MT-121); a long list
      // (multivitamins) ends "+N more", and the check-before-saving banner sends the user to the label.
      strength: formatStrength(ings.slice(0, NPN_MAX_INGREDIENTS)) + (ings.length > NPN_MAX_INGREDIENTS ? `, +${ings.length - NPN_MAX_INGREDIENTS} more` : ''),
      discontinued: l.flag_product_status !== 1,
      ...(/^homeopathic/i.test(l.sub_submission_type_desc ?? '') && { hm: true }),
    }
  }
  return products
}

// read turns a response into its body; a bad status or body (the LNHPD API sometimes answers 200
// with an HTML page) is retried with a doubling wait.
async function fetchWithRetry(url, read, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await read(res)
    } catch (err) {
      if (attempt === attempts) throw new Error(`${url}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 2000 * 2 ** (attempt - 1)))
    }
  }
}

async function download(url, dest) {
  writeFileSync(dest, Buffer.from(await fetchWithRetry(url, (res) => res.arrayBuffer())))
}

const fetchJson = (url) => fetchWithRetry(url, (res) => res.json(), 7)

async function fetchIngredients(ids) {
  const out = new Map()
  const queue = [...ids]
  let done = 0
  let nextAt = 0
  const worker = async () => {
    while (queue.length) {
      const id = queue.pop()
      // Shared pace across workers: at most LNHPD_PER_SECOND requests start each second.
      const wait = Math.max(0, nextAt - Date.now())
      nextAt = Date.now() + wait + 1000 / LNHPD_PER_SECOND
      if (wait) await new Promise((r) => setTimeout(r, wait))
      const body = await fetchJson(`${LNHPD}MedicinalIngredient/?lang=en&type=json&id=${id}`)
      if (!Array.isArray(body?.data)) throw new Error(`MedicinalIngredient ${id}: unexpected response`)
      out.set(id, body.data)
      if (++done % 10000 === 0) console.log(`NPN ingredients: ${done}/${ids.length}`)
    }
  }
  await Promise.all(Array.from({ length: LNHPD_WORKERS }, worker))
  return out
}

async function buildNpnFromApi() {
  const licences = await fetchJson(`${LNHPD}ProductLicence/?lang=en&type=json`)
  if (!Array.isArray(licences) || licences.length < 100000) throw new Error(`ProductLicence: unexpected response (${licences?.length} rows)`)
  const ids = [...new Set(licences.filter((l) => /^\d{8}$/.test(l.licence_number)).map((l) => l.lnhpd_id))]
  return buildNpn(licences, await fetchIngredients(ids))
}

// One product per line keeps monthly refreshes reviewable as a diff.
const listJson = (generatedAt, products) =>
  `{"generatedAt":"${generatedAt}","products":{\n${Object.entries(products).map(([n, p]) => `${JSON.stringify(n)}:${JSON.stringify(p)}`).join(',\n')}\n}}\n`

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
  const dinOnly = process.argv.includes('--din-only')
  const dir = mkdtempSync(join(tmpdir(), 'dpd-'))
  try {
    const files = { drug: [], status: [], form: [], ingred: [] }
    for (const [zip, suffix] of EXTRACTS) {
      await download(DPD + zip, join(dir, zip))
      for (const kind of Object.keys(files)) files[kind].push(...readRows(join(dir, zip), `${kind}${suffix}.txt`))
    }
    const din = buildDin(files)
    // Fetch everything before writing anything, so a failure leaves all committed files untouched.
    const npn = dinOnly ? null : await buildNpnFromApi()
    const generatedAt = new Date().toISOString().slice(0, 10)
    const root = new URL('../', import.meta.url)
    mkdirSync(new URL('public/products/', root), { recursive: true })
    mkdirSync(new URL('src/features/dinLookup/', root), { recursive: true })
    writeAtomic(new URL('public/products/din.json', root), listJson(generatedAt, din))
    if (npn) writeAtomic(new URL('public/products/npn.json', root), listJson(generatedAt, npn))
    writeAtomic(new URL('src/features/dinLookup/dataVersion.ts', root),
      '// Generated by scripts/build-product-data.mjs. Do not edit by hand.\n' +
      `export const PRODUCT_DATA: { generatedAt: string; lists: ('din' | 'npn')[] } = { generatedAt: '${generatedAt}', lists: ${npn ? "['din', 'npn']" : "['din']"} }\n`)
    console.log(`din.json: ${Object.keys(din).length} products, as of ${generatedAt}`)
    if (npn) console.log(`npn.json: ${Object.keys(npn).length} products (${Object.values(npn).filter((p) => p.hm).length} DIN-HM)`)
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
