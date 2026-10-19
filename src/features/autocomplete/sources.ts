import type { Medication } from '../../lib/types'

export type Suggestion = {
  source: 'mine' | 'ca' | 'us'
  name: string
  strengths?: string[]
  form?: string
}

const MIN_CHARS = 3
const MAX_ITEMS = 5

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function searchDpd(q: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = `https://health-products.canada.ca/api/drug/drugproduct/?brandname=${encodeURIComponent(q)}&lang=en&type=json`
  const rows = (await getJson(url, signal)) as { brand_name?: string }[]
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const row of rows) {
    if (typeof row.brand_name !== 'string') continue
    const key = row.brand_name.trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push({ source: 'ca', name: row.brand_name.trim() })
    if (out.length === MAX_ITEMS) break
  }
  return out
}

export async function searchRxTerms(q: string, signal: AbortSignal): Promise<Suggestion[]> {
  const url = `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=${encodeURIComponent(q)}&ef=STRENGTHS_AND_FORMS`
  const [, names, extra] = (await getJson(url, signal)) as [
    number,
    string[],
    { STRENGTHS_AND_FORMS?: string[][] } | null,
  ]
  const strengths = extra?.STRENGTHS_AND_FORMS ?? []
  return names.slice(0, MAX_ITEMS).map((name, i) => ({
    source: 'us' as const,
    name,
    strengths: (strengths[i] ?? []).map((s) => s.trim()),
  }))
}

export function searchMine(q: string, meds: Medication[]): Suggestion[] {
  if (q.length < MIN_CHARS) return []
  const needle = q.toLowerCase()
  const seen = new Set<string>()
  const out: Suggestion[] = []
  for (const m of meds) {
    const key = m.name.toLowerCase()
    if (!key.includes(needle) || seen.has(key)) continue
    seen.add(key)
    out.push({ source: 'mine', name: m.name })
    if (out.length === MAX_ITEMS) break
  }
  return out
}
