import { describe, expect, it } from 'vitest'
import { dayParam, dayTitle, localDayRange, localWallTimeUtc } from './dayRange'

const iso = (s: string) => new Date(s).toISOString()
const hours = (r: { from: string; to: string }) => (Date.parse(r.to) - Date.parse(r.from)) / 3_600_000

describe('localDayRange', () => {
  it('2026-10-19 in America/Toronto → 04:00Z..04:00Z next day', () => {
    expect(localDayRange('2026-10-19', 'America/Toronto')).toEqual({
      from: iso('2026-10-19T04:00:00Z'),
      to: iso('2026-10-20T04:00:00Z'),
    })
  })
  it('2026-11-01 in America/Toronto spans 25 h (DST end)', () => {
    const r = localDayRange('2026-11-01', 'America/Toronto')
    expect(r.from).toBe(iso('2026-11-01T04:00:00Z'))
    expect(hours(r)).toBe(25)
  })
  it('2026-03-08 in America/Toronto spans 23 h (DST start)', () => {
    expect(hours(localDayRange('2026-03-08', 'America/Toronto'))).toBe(23)
  })
  it('uses the tz argument, not the browser zone', () => {
    const tokyo = localDayRange('2026-10-19', 'Asia/Tokyo')
    expect(tokyo).toEqual({ from: iso('2026-10-18T15:00:00Z'), to: iso('2026-10-19T15:00:00Z') })
    expect(tokyo).not.toEqual(localDayRange('2026-10-19', 'UTC'))
  })
})

// Expected values are what Postgres returns for `(date + time) at time zone tz` (see 0013).
describe('localWallTimeUtc across daylight saving', () => {
  const at = (date: string, time: string, tz = 'America/Toronto') => new Date(localWallTimeUtc(date, time, tz)).toISOString()
  it('a time skipped by spring forward moves forward by the gap (02:30 → 03:30 EDT)', () => {
    expect(at('2027-03-14', '02:30')).toBe(iso('2027-03-14T07:30:00Z'))
  })
  it('02:00 and 03:00 on spring-forward day land on the same instant', () => {
    expect(at('2027-03-14', '02:00')).toBe(iso('2027-03-14T07:00:00Z'))
    expect(at('2027-03-14', '03:00')).toBe(iso('2027-03-14T07:00:00Z'))
  })
  it('a time repeated by fall back is the later one (01:30 EST)', () => {
    expect(at('2027-11-07', '01:30')).toBe(iso('2027-11-07T06:30:00Z'))
  })
  it('ordinary times on transition days use that moment’s offset', () => {
    expect(at('2027-03-14', '01:59')).toBe(iso('2027-03-14T06:59:00Z'))
    expect(at('2027-03-14', '10:00')).toBe(iso('2027-03-14T14:00:00Z'))
    expect(at('2027-11-07', '00:30')).toBe(iso('2027-11-07T04:30:00Z'))
    expect(at('2027-11-07', '10:00')).toBe(iso('2027-11-07T15:00:00Z'))
  })
  it('a skipped midnight (America/Santiago) is 01:00', () => {
    expect(at('2026-09-06', '00:00', 'America/Santiago')).toBe(iso('2026-09-06T04:00:00Z'))
  })
})

describe('day helpers', () => {
  it('todayIn uses the given zone', async () => {
    const { todayIn, weekAround } = await import('./dayRange')
    const t = Date.UTC(2026, 9, 19, 2, 0) // 22:00 on the 18th in Toronto
    expect(todayIn('America/Toronto', t)).toBe('2026-10-18')
    expect(todayIn('Asia/Tokyo', t)).toBe('2026-10-19')
    expect(weekAround('2026-10-19')).toEqual([
      '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22',
    ])
  })
})

describe('dayParam / dayTitle', () => {
  it('accepts a real date and rejects junk or impossible dates', () => {
    expect(dayParam('2026-10-20')).toBe('2026-10-20')
    expect(dayParam(null)).toBeNull()
    expect(dayParam('tomorrow')).toBeNull()
    expect(dayParam('2026-02-30')).toBeNull()
  })
  it('formats a day for the header', () => {
    expect(dayTitle('2026-10-20')).toBe('Tue, Oct 20')
  })
})
