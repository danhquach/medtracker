export type ActionClaims = { doseId: string; userId: string; exp: number }

const enc = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function unb64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bin, (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

function hmacKey(key: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])
}

async function sign(claims: object, key: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify(claims)))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(key, 'sign'), enc.encode(payload))
  return `${payload}.${b64url(new Uint8Array(sig))}`
}

/** The signed claims, or null when the signature is bad or the token is malformed. */
async function verify(token: string, key: string): Promise<Record<string, unknown> | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payload, sig] = parts
  const sigBytes = unb64url(sig)
  if (!sigBytes) return null
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(key, 'verify'), sigBytes, enc.encode(payload))
  if (!ok) return null
  const bytes = unb64url(payload)
  if (!bytes) return null
  try {
    const c = JSON.parse(new TextDecoder().decode(bytes))
    return c && typeof c === 'object' ? c : null
  } catch {
    return null
  }
}

export const signActionToken = (claims: ActionClaims, key: string): Promise<string> => sign(claims, key)

export async function verifyActionToken(
  token: string,
  key: string,
  now = Date.now(),
): Promise<ActionClaims | null> {
  const c = await verify(token, key)
  if (!c || typeof c.doseId !== 'string' || typeof c.userId !== 'string' || typeof c.exp !== 'number') return null
  if (now > c.exp) return null
  return { doseId: c.doseId, userId: c.userId, exp: c.exp }
}

// Lets the Android app ask, as a reminder rings, whether that dose still needs it (MT-152). It only
// reads, and has no doseId, so dose-action never accepts it (nor this one an action token).
export type CheckClaims = { kind: 'check'; userId: string; exp: number }

export const signCheckToken = (claims: CheckClaims, key: string): Promise<string> => sign(claims, key)

export async function verifyCheckToken(token: string, key: string, now = Date.now()): Promise<CheckClaims | null> {
  const c = await verify(token, key)
  if (!c || c.kind !== 'check' || typeof c.userId !== 'string' || typeof c.exp !== 'number') return null
  if (now > c.exp) return null
  return { kind: 'check', userId: c.userId, exp: c.exp }
}
