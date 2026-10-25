// Picks 8-digit DIN/NPN numbers out of free text: a paste now, label-scan text later (MT-105).

// 8 digits, or two groups of 4 split by a space or dash, never part of a longer digit run.
const NUMBER = /(?<!\d)\d{8}(?!\d)|(?<!\d[ -]?)\d{4}[ -]\d{4}(?![ -]?\d)/g
const KEYWORD = /DIN|NPN/i
const RIGHT_AFTER_KEYWORD = /(?:DIN|NPN)\W*$/i

/**
 * Unique 8-digit numbers, best first: one right after DIN/NPN, then one elsewhere on a DIN/NPN line,
 * then one in a DIN/NPN block. Letters are never read as digits.
 */
export function findCandidates(blocks: { text: string; lines: string[] }[]): string[] {
  const found: { number: string; score: number }[] = []
  for (const block of blocks) {
    const blockScore = KEYWORD.test(block.text) ? 1 : 0
    for (const line of block.lines) {
      const lineScore = KEYWORD.test(line) ? 2 : blockScore
      for (const m of line.matchAll(NUMBER)) {
        const score = RIGHT_AFTER_KEYWORD.test(line.slice(0, m.index)) ? 3 : lineScore
        found.push({ number: m[0].replace(/\D/g, ''), score })
      }
    }
  }
  const best = new Map<string, number>()
  for (const { number, score } of found) best.set(number, Math.max(score, best.get(number) ?? 0))
  // Map keeps first-seen order and sort is stable, so ties stay in reading order.
  return [...best].sort((a, b) => b[1] - a[1]).map(([number]) => number)
}

/** The 8-digit number to keep from pasted text, if it has one. */
export function numberFromPaste(text: string): string | undefined {
  return findCandidates([{ text, lines: [text] }])[0]
}
