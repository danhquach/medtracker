// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDin, formatStrength, mapForm, parseCsvLine, pickDpdRow } from './build-product-data.mjs'

// Rows in DPD extract column order (see the header comment in build-product-data.mjs). Made-up products.
const drug = (code: string, din: string, name: string) => [code, '', 'Human', din, name, '', 'N', '1', '1', '01-JAN-2025', '1', 'Humain', '', '']
const status = (code: string, current: 'Y' | 'N', value: string, date: string) => [code, current, value, date, '', '', '']
const form = (code: string, value: string) => [code, '1', value, '']
const ingred = (code: string, name: string, strength: string, unit: string) =>
  [code, '1', name, 'I', strength, unit, '', '', '', '', '', '', '', '', '']

describe('build-product-data (MT-100)', () => {
  it('parseCsvLine handles quotes and escaped quotes', () => {
    expect(parseCsvLine('"1","A, B","say ""hi""",""')).toEqual(['1', 'A, B', 'say "hi"', ''])
  })

  it('mapForm maps Health Canada forms onto the app forms', () => {
    expect(mapForm('TABLET (EXTENDED-RELEASE)')).toBe('tablet')
    expect(mapForm('Capsule')).toBe('capsule')
    expect(mapForm('SYRUP')).toBe('liquid')
    expect(mapForm('CREAM')).toBe('other')
    expect(mapForm('POWDER FOR SOLUTION')).toBe('other')
  })

  it('formatStrength single ingredient is "500 mg"', () => {
    expect(formatStrength([{ name: 'ACETAMINOPHEN', strength: '500', unit: 'MG' }])).toBe('500 mg')
  })

  it('formatStrength combo lists each ingredient in source order', () => {
    expect(formatStrength([
      { name: 'Glucosamine sulfate', strength: '500', unit: 'mg' },
      { name: 'Chondroitin sulfate', strength: ' 400 ', unit: 'MG' },
      { name: 'Flavour', strength: '', unit: '' },
    ])).toBe('Glucosamine sulfate 500 mg, Chondroitin sulfate 400 mg, Flavour')
  })

  it('pickDpdRow prefers MARKETED over newer CANCELLED POST MARKET', () => {
    expect(pickDpdRow([
      { status: 'CANCELLED POST MARKET', statusDate: '01-JAN-2024' },
      { status: 'MARKETED', statusDate: '01-JAN-2010' },
    ])).toBe(1)
  })

  it('pickDpdRow breaks a tie by latest date', () => {
    expect(pickDpdRow([
      { status: 'APPROVED', statusDate: '15-MAR-2019' },
      { status: 'APPROVED', statusDate: '02-FEB-2021' },
      { status: 'APPROVED', statusDate: '30-DEC-2020' },
    ])).toBe(1)
  })

  it('buildDin keeps leading zeros, fills name, form and strength, and keeps French accents', () => {
    const out = buildDin({
      drug: [drug('10', '02242963', 'PRODUIT ÉTUDE 10 MG')],
      status: [status('10', 'N', 'APPROVED', '01-JAN-2000'), status('10', 'Y', 'MARKETED', '01-JAN-2001')],
      form: [form('10', 'TABLET')],
      ingred: [ingred('10', 'EXAMPLINE', '10', 'MG')],
    })
    expect(Object.keys(out)).toEqual(['02242963'])
    expect(out['02242963']).toEqual({ name: 'PRODUIT ÉTUDE 10 MG', form: 'tablet', strength: '10 mg', discontinued: false })
  })

  it('buildDin marks a cancelled-only DIN discontinued', () => {
    const out = buildDin({
      drug: [drug('20', '00012345', 'OLD PRODUCT')],
      status: [status('20', 'N', 'MARKETED', '01-JAN-1990'), status('20', 'Y', 'CANCELLED POST MARKET', '01-JAN-1999')],
      form: [form('20', 'CAPSULE')],
      ingred: [ingred('20', 'EXAMPLINE', '5', 'MG')],
    })
    expect(out['00012345'].discontinued).toBe(true)
  })

  it('buildDin keeps the marketed record when a DIN has several drug codes', () => {
    const out = buildDin({
      drug: [drug('30', '80012345', 'CANCELLED NAME'), drug('31', '80012345', 'MARKETED NAME')],
      status: [status('30', 'Y', 'CANCELLED POST MARKET', '01-JAN-2024'), status('31', 'Y', 'MARKETED', '01-JAN-2015')],
      form: [form('30', 'TABLET'), form('31', 'SYRUP')],
      ingred: [ingred('30', 'A', '1', 'MG'), ingred('31', 'B', '5', 'MG')],
    })
    expect(out['80012345']).toEqual({ name: 'MARKETED NAME', form: 'liquid', strength: '5 mg', discontinued: false })
  })
})
