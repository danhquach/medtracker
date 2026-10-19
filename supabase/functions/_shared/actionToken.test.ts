import { describe, expect, it } from 'vitest'
import { signActionToken, verifyActionToken } from './actionToken'

const key = 'k'.repeat(32)
const claims = { doseId: 'd-1', userId: 'u-1', exp: Date.now() + 60_000 }

describe('action token', () => {
  it('round-trips claims', async () => {
    const t = await signActionToken(claims, key)
    expect(await verifyActionToken(t, key)).toEqual(claims)
  })
  it('rejects tampered payload', async () => {
    const t = await signActionToken(claims, key)
    const [, sig] = t.split('.')
    const forged = btoa(JSON.stringify({ ...claims, doseId: 'd-2' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(await verifyActionToken(`${forged}.${sig}`, key)).toBeNull()
  })
  it('rejects wrong key', async () => {
    const t = await signActionToken(claims, key)
    expect(await verifyActionToken(t, 'z'.repeat(32))).toBeNull()
  })
  it('rejects expired (now > exp)', async () => {
    const t = await signActionToken(claims, key)
    expect(await verifyActionToken(t, key, claims.exp + 1)).toBeNull()
  })
  it('rejects malformed input', async () => {
    expect(await verifyActionToken('garbage', key)).toBeNull()
    expect(await verifyActionToken('a.b.c', key)).toBeNull()
    expect(await verifyActionToken('', key)).toBeNull()
  })
})
