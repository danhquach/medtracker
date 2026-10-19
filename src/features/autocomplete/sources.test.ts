import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Medication } from '../../lib/types'
import { searchDpd, searchMine, searchRxTerms } from './sources'

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response

afterEach(() => vi.unstubAllGlobals())

describe('sources', () => {
  it('dpd dedupes repeated APO-IBUPROFEN rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        { brand_name: 'APO-IBUPROFEN' },
        { brand_name: 'APO-IBUPROFEN ' },
        { brand_name: 'apo-ibuprofen' },
        { brand_name: 'APO-IBUPROFEN TAB 600MG' },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await searchDpd('ibu pro', new AbortController().signal)
    expect(out.map((s) => s.name)).toEqual(['APO-IBUPROFEN', 'APO-IBUPROFEN TAB 600MG'])
    expect(out.every((s) => s.source === 'ca')).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://health-products.canada.ca/api/drug/drugproduct/?brandname=ibu%20pro&lang=en&type=json',
    )
  })

  it('dpd caps at 5', async () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ brand_name: `DRUG${i}` }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(rows)))
    expect(await searchDpd('drug', new AbortController().signal)).toHaveLength(5)
  })

  it('rxterms maps strengths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        2,
        ['Ibuprofen (Oral Pill)', 'Ibuprofen (Oral Liquid)'],
        { STRENGTHS_AND_FORMS: [[' 100 mg Tab', '200 mg Cap'], ['100 mg/5 mL Susp']] },
        [],
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const out = await searchRxTerms('ibup', new AbortController().signal)
    expect(out).toEqual([
      { source: 'us', name: 'Ibuprofen (Oral Pill)', strengths: ['100 mg Tab', '200 mg Cap'] },
      { source: 'us', name: 'Ibuprofen (Oral Liquid)', strengths: ['100 mg/5 mL Susp'] },
    ])
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=ibup&ef=STRENGTHS_AND_FORMS',
    )
  })

  it('mine matches case-insensitive', () => {
    const med = (name: string) => ({ name }) as Medication
    const out = searchMine('IBU', [med('Ibuprofen'), med('ibuprofen'), med('Advil'), med('Nuprofen IBU')])
    expect(out.map((s) => s.name)).toEqual(['Ibuprofen', 'Nuprofen IBU'])
    expect(out[0].source).toBe('mine')
  })

  it('mine returns empty under 3 chars', () => {
    expect(searchMine('ib', [{ name: 'Ibuprofen' } as Medication])).toEqual([])
  })

  it('mine caps at 5', () => {
    const meds = Array.from({ length: 8 }, (_, i) => ({ name: `Ibuprofen ${i}` }) as Medication)
    expect(searchMine('ibu', meds).map((s) => s.name)).toEqual(meds.slice(0, 5).map((m) => m.name))
  })

  it.each([
    ['dpd', searchDpd],
    ['rxterms', searchRxTerms],
  ])('%s rejects on an HTTP error', async (_name, search) => {
    const json = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json } as unknown as Response))
    await expect(search('ibu', new AbortController().signal)).rejects.toThrow('HTTP 503')
    expect(json).not.toHaveBeenCalled()
  })
})
