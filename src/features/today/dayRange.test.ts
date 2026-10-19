import { describe, expect, it } from 'vitest'
import { localDayRange } from './dayRange'

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
