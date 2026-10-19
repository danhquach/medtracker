import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { verifyActionToken } from '../_shared/actionToken.ts'

// Called cross-origin by the service worker (apikey + content-type headers), no credentials.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

const MAX_BODY = 4096
const reply = (status: number, body: unknown) => Response.json(body, { status, headers: cors })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' })

  const raw = await req.text()
  if (raw.length > MAX_BODY) return reply(400, { error: 'bad request' })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, { error: 'bad request' })
  }
  const { token, action } = (body ?? {}) as { token?: unknown; action?: unknown }
  if (typeof token !== 'string' || !token || (action !== 'taken' && action !== 'snooze')) {
    return reply(400, { error: 'bad request' })
  }

  const tokenKey = Deno.env.get('ACTION_TOKEN_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!tokenKey || !url || !serviceKey) return reply(500, { error: 'server misconfigured' })

  const claims = await verifyActionToken(token, tokenKey)
  if (!claims) return reply(401, { error: 'invalid token' })

  // Service role bypasses RLS, so this ownership check is the only thing guarding the writes below.
  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const dose = await db.from('dose_events').select('id, user_id').eq('id', claims.doseId).maybeSingle()
  if (dose.error) return reply(500, { error: 'lookup failed' })
  if (!dose.data || dose.data.user_id !== claims.userId) return reply(404, { error: 'not found' })

  if (action === 'taken') {
    const r = await db.rpc('set_dose_status', { p_dose: claims.doseId, p_status: 'taken' })
    if (r.error) return reply(500, { error: 'update failed' })
    if (!r.data?.id) return reply(404, { error: 'not found' })
    return reply(200, { status: 'taken' })
  }

  const prof = await db.from('profiles').select('snooze_minutes').eq('user_id', claims.userId).maybeSingle()
  if (prof.error) return reply(500, { error: 'lookup failed' })
  const r = await db.rpc('snooze_dose', { p_dose: claims.doseId, p_minutes: prof.data?.snooze_minutes ?? 10 })
  if (r.error) return reply(500, { error: 'update failed' })
  if (!r.data?.id) return reply(409, { error: 'dose is not pending' })
  return reply(200, { status: 'snoozed' })
})
