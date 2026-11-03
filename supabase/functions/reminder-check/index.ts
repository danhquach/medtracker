import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { signCheckToken, verifyCheckToken } from '../_shared/actionToken.ts'
import { shouldRing } from '../_shared/reminderCheck.ts'

// Two calls (MT-152):
// - from the app with the user's JWT and no body token: returns a check token for this user;
// - from the phone as a reminder rings, with { token, medId, scheduledFor }: returns { ring }.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

const MAX_BODY = 4096
const TOKEN_DAYS = 30
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: cors })
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' })

  const raw = await req.text()
  if (raw.length > MAX_BODY) return reply(400, { error: 'bad request' })
  let body: unknown = {}
  try {
    if (raw) body = JSON.parse(raw)
  } catch {
    return reply(400, { error: 'bad request' })
  }
  const { token, medId, scheduledFor } = (body ?? {}) as { token?: unknown; medId?: unknown; scheduledFor?: unknown }

  const tokenKey = Deno.env.get('ACTION_TOKEN_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!tokenKey || !url || !anonKey || !serviceKey) return reply(500, { error: 'server misconfigured' })

  if (token === undefined) {
    const authz = req.headers.get('Authorization')
    if (!authz) return reply(401, { error: 'unauthorized' })
    // The uid comes only from the verified JWT.
    const caller = createClient(url, anonKey, { ...opts, global: { headers: { Authorization: authz } } })
    const { data, error } = await caller.auth.getUser()
    if (error || !data.user) return reply(401, { error: 'unauthorized' })
    const exp = Date.now() + TOKEN_DAYS * 86_400_000
    return reply(200, { token: await signCheckToken({ kind: 'check', userId: data.user.id, exp }, tokenKey), exp })
  }

  if (typeof token !== 'string' || typeof medId !== 'string' || !UUID.test(medId)) return reply(400, { error: 'bad request' })
  if (typeof scheduledFor !== 'string' || Number.isNaN(Date.parse(scheduledFor))) return reply(400, { error: 'bad request' })
  const claims = await verifyCheckToken(token, tokenKey)
  if (!claims) return reply(401, { error: 'invalid token' })

  // Service role bypasses RLS: every read below is scoped to the token's user.
  const db = createClient(url, serviceKey, opts)
  const at = new Date(Date.parse(scheduledFor)).toISOString()
  const [med, dose] = await Promise.all([
    db.from('medications').select('notify, paused').eq('id', medId).eq('user_id', claims.userId).maybeSingle(),
    db
      .from('dose_events')
      .select('status, snoozed_until')
      .eq('medication_id', medId)
      .eq('user_id', claims.userId)
      .eq('scheduled_for', at)
      .maybeSingle(),
  ])
  if (med.error || dose.error) return reply(500, { error: 'lookup failed' })
  return reply(200, { ring: shouldRing(med.data, dose.data, Date.now()) })
})
