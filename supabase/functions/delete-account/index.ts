import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// Called from the browser with the user's JWT.
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-max-age': '86400',
}

const reply = (status: number, body: unknown) => Response.json(body, { status, headers: cors })
const opts = { auth: { persistSession: false, autoRefreshToken: false } }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return reply(405, { error: 'method not allowed' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const authz = req.headers.get('Authorization')
  if (!url || !anonKey || !serviceKey) return reply(500, { error: 'server misconfigured' })
  if (!authz) return reply(401, { error: 'unauthorized' })

  // The uid comes only from the verified JWT; the body is never read.
  const caller = createClient(url, anonKey, { ...opts, global: { headers: { Authorization: authz } } })
  const { data, error } = await caller.auth.getUser()
  if (error || !data.user) return reply(401, { error: 'unauthorized' })

  const admin = createClient(url, serviceKey, opts)
  const del = await admin.auth.admin.deleteUser(data.user.id)
  if (del.error) return reply(500, { error: 'delete failed' })
  return reply(200, { deleted: true })
})
