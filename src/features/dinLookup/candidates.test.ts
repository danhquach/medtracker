import { describe, expect, it } from 'vitest'
import { findCandidates, numberFromPaste } from './candidates'

const one = (text: string) => findCandidates([{ text, lines: [text] }])

describe('findCandidates', () => {
  it('finds "NPN 80012345"', () => {
    expect(one('NPN 80012345')).toEqual(['80012345'])
  })

  it('joins "NPN 8001 2345"', () => {
    expect(one('NPN 8001 2345')).toEqual(['80012345'])
    expect(one('8001-2345')).toEqual(['80012345'])
  })

  it('ranks the number next to DIN above a lot number', () => {
    const lines = ['LOT 12345678', 'EXP 2027-01', 'DIN 02242963']
    expect(findCandidates([{ text: lines.join('\n'), lines }])).toEqual(['02242963', '12345678'])
  })

  it('ranks a number in a DIN/NPN block above one in another block', () => {
    expect(
      findCandidates([
        { text: 'LOT 12345678', lines: ['LOT 12345678'] },
        { text: 'NPN\n80012345', lines: ['NPN', '80012345'] },
      ]),
    ).toEqual(['80012345', '12345678'])
  })

  it('ignores a 10-digit run', () => {
    expect(one('1234567890')).toEqual([])
  })

  it('ignores a spaced group inside a longer run', () => {
    expect(one('1234 5678 9012')).toEqual([])
    expect(one('9 1234 5678')).toEqual([])
  })

  it('does not turn "8OO12345" into digits', () => {
    expect(one('NPN 8OO12345')).toEqual([])
  })

  it('dedupes repeats', () => {
    expect(one('DIN 02242963 / 0224 2963 / 02242963')).toEqual(['02242963'])
  })
})

describe('numberFromPaste', () => {
  it('picks the NPN from "LOT 1234 NPN 80012345"', () => {
    expect(numberFromPaste('LOT 1234 NPN 80012345')).toBe('80012345')
  })

  it('keeps the leading zero of "DIN 0224 2963"', () => {
    expect(numberFromPaste('DIN 0224 2963')).toBe('02242963')
  })

  it('falls back to the digits, capped at 8', () => {
    expect(numberFromPaste('12-34')).toBe('1234')
    expect(numberFromPaste('1234567890')).toBe('12345678')
  })
})
