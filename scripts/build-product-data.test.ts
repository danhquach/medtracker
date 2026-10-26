// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDin, buildNpn, formatStrength, mapForm, parseCsvLine, pickDpdRow } from './build-product-data.mjs'

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
    expect(mapForm('Softgel')).toBe('capsule')
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

  // LNHPD rows in API field names (see the header comment in build-product-data.mjs). Made-up products.
  const licence = (id: number, npn: string, name: string, extra: object = {}) => ({
    lnhpd_id: id, licence_number: npn, product_name: name, dosage_form: 'Capsule', revised_date: '2024-01-01',
    sub_submission_type_desc: 'Compendial', flag_primary_name: 1, flag_product_status: 1, ...extra,
  })
  const ing = (name: string, quantity: number, unit: string, extra: object = {}) => ({
    ingredient_name: name, quantity, quantity_minimum: 0, quantity_maximum: 0, quantity_unit_of_measure: unit, ...extra,
  })

  it('buildNpn keys by 8-digit NPN and fills name, form and strength from the primary name', () => {
    const out = buildNpn(
      [licence(1, '80012345', 'Other Name', { flag_primary_name: 0 }), licence(1, '80012345', 'Exemple Glucosamine Étude')],
      new Map([[1, [ing('Glucosamine sulfate', 500, 'mg'), ing('Chondroitin sulfate', 400, 'mg')]]]),
    )
    expect(out).toEqual({
      '80012345': { name: 'Exemple Glucosamine Étude', form: 'capsule', strength: 'Glucosamine sulfate 500 mg, Chondroitin sulfate 400 mg', discontinued: false },
    })
  })

  it('buildNpn keeps leading zeros and skips licences without an 8-digit number', () => {
    const out = buildNpn([licence(1, '02212345', 'Transitional'), licence(2, '', 'No number')], new Map([[1, [ing('Examplum', 5, 'mg')]]]))
    expect(Object.keys(out)).toEqual(['02212345'])
    expect(out['02212345'].strength).toBe('5 mg')
  })

  it('buildNpn marks a DIN-HM licence with hm true and an inactive one discontinued', () => {
    const out = buildNpn(
      [licence(1, '80000001', 'Homeo', { sub_submission_type_desc: 'Homeopathic (Compendial)' }), licence(2, '80000002', 'Gone', { flag_product_status: 0 })],
      new Map(),
    )
    expect(out['80000001']).toMatchObject({ hm: true, discontinued: false, strength: '' })
    expect(out['80000002']).toMatchObject({ discontinued: true })
    expect(out['80000002']).not.toHaveProperty('hm')
  })

  it('buildNpn collapses potency-only rows and shows a quantity range', () => {
    const out = buildNpn(
      [licence(1, '80000003', 'Ginkgo')],
      new Map([[1, [ing('Ginkgo biloba', 60, 'mg'), ing('Ginkgo biloba', 0, ''), ing('Examplum', 0, 'mg', { quantity_minimum: 1, quantity_maximum: 2 })]]]),
    )
    expect(out['80000003'].strength).toBe('Ginkgo biloba 60 mg, Examplum 1-2 mg')
  })

  it('buildNpn drops a potency-only row even when it comes before the quantified one', () => {
    const out = buildNpn(
      [licence(1, '80000006', 'Garlic')],
      new Map([[1, [ing('Allium sativum', 0, ''), ing('Allium sativum', 500, 'mg'), ing('Examplum', 0, '')]]]),
    )
    expect(out['80000006'].strength).toBe('Allium sativum 500 mg, Examplum')
  })

  it('buildNpn falls back to a named row when the primary name is empty', () => {
    const out = buildNpn([licence(1, '80000007', ' '), licence(1, '80000007', 'Named', { flag_primary_name: 0 })], new Map())
    expect(out['80000007'].name).toBe('Named')
  })

  it('buildNpn lists the first 3 ingredients, then "+N more", with spelled-out units shortened', () => {
    const out = buildNpn(
      [licence(1, '80000005', 'Multi')],
      new Map([[1, [ing('A', 1, 'milligrams'), ing('B', 2, 'Micrograms'), ing('C', 3, 'International Units'), ing('D', 4, 'mg'), ing('E', 5, 'mg')]]]),
    )
    expect(out['80000005'].strength).toBe('A 1 mg, B 2 mcg, C 3 IU, +2 more')
    expect(formatStrength([{ name: 'A', strength: '5', unit: 'µg' }, { name: 'B', strength: '20', unit: 'percent' }])).toBe('A 5 mcg, B 20 %')
  })

  it('buildNpn keeps the most recently revised licence when one number has two', () => {
    const out = buildNpn(
      [licence(1, '80000004', 'Old', { revised_date: '2015-01-01' }), licence(2, '80000004', 'New', { revised_date: '2023-01-01' })],
      new Map(),
    )
    expect(out['80000004'].name).toBe('New')
  })
})
