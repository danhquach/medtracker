import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { signActionToken } from '../_shared/actionToken.ts'
import { sendPush, vapidConfigured, type PushSubRow } from '../_shared/push.ts'
import { runReminders, type ClaimedDose, type RefillMed } from '../_shared/reminderRun.ts'

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (!secret || !given || !safeEqual(given, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  // Fail before claiming anything: a claimed-but-unsendable dose would be lost.
  const tokenKey = Deno.env.get('ACTION_TOKEN_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!tokenKey || !url || !serviceKey || !vapidConfigured()) {
    return new Response('server misconfigured', { status: 500 })
  }

  const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  try {
    const result = await runReminders({
      now: () => Date.now(),
      claim: async () => {
        const { data, error } = await db.rpc('claim_due_doses', { p_limit: 50 })
        if (error) throw error
        return data as ClaimedDose[]
      },
      timeZones: async (ids) => {
        const { data, error } = await db.from('profiles').select('user_id, time_zone').in('user_id', ids)
        if (error) throw error
        return new Map((data ?? []).map((p) => [p.user_id as string, p.time_zone as string]))
      },
      subsFor: async (userId) => {
        const { data, error } = await db
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth')
          .eq('user_id', userId)
          .eq('enabled', true)
        if (error) throw error
        return (data ?? []) as PushSubRow[]
      },
      send: (sub, payload) => sendPush(sub as PushSubRow, payload),
      prune: async (id) => !(await db.from('push_subscriptions').delete().eq('id', id)).error,
      unclaim: async (ids) => {
        const { error } = await db.rpc('unclaim_doses', { p_ids: ids })
        if (error) throw error
      },
      signToken: (c) => signActionToken(c, tokenKey),
      refillMeds: async () => {
        const { data, error } = await db
          .from('medications')
          .select(
            'id, user_id, name, stock, units_per_dose, refill_threshold_days, paused, notify, refill_alerted_at, schedules(kind, times, weekdays, interval_days)',
          )
          .not('stock', 'is', null)
          .eq('paused', false)
        if (error) throw error
        return (data ?? []) as RefillMed[]
      },
      markRefill: async (id, alerted) => {
        const { error } = await db
          .from('medications')
          .update({ refill_alerted_at: alerted ? new Date().toISOString() : null })
          .eq('id', id)
        if (error) throw error
      },
    })
    // Non-2xx surfaces partial failures in net._http_response / function logs.
    return Response.json(result, { status: result.errors > 0 ? 500 : 200 })
  } catch (e) {
    return new Response(`run failed: ${(e as Error).message}`, { status: 500 })
  }
})
