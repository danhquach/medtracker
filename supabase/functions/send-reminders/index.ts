import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { signActionToken } from '../_shared/actionToken.ts'
import { sendPush, type PushPayload, type PushSubRow } from '../_shared/push.ts'
import { refillState, daysLeft, avgDosesPerDay, type ScheduleLike } from '../_shared/refill.ts'

const DAY_MS = 24 * 3600 * 1000

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

function localTime(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso))
  } catch {
    return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso))
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET')
  const given = req.headers.get('x-cron-secret')
  if (!secret || !given || !safeEqual(given, secret)) {
    return new Response('unauthorized', { status: 401 })
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const tokenKey = Deno.env.get('ACTION_TOKEN_KEY')!

  const subsCache = new Map<string, PushSubRow[]>()
  async function subsFor(userId: string): Promise<PushSubRow[]> {
    const hit = subsCache.get(userId)
    if (hit) return hit
    const { data, error } = await db
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
      .eq('enabled', true)
    if (error) throw error
    subsCache.set(userId, data ?? [])
    return data ?? []
  }

  let sent = 0
  let pruned = 0
  async function pushToUser(userId: string, payload: PushPayload) {
    for (const sub of [...(await subsFor(userId))]) {
      const res = await sendPush(sub, payload)
      if (res === 'ok') sent++
      else if (res === 'gone') {
        const { error } = await db.from('push_subscriptions').delete().eq('id', sub.id)
        if (!error) {
          pruned++
          subsCache.set(
            userId,
            (subsCache.get(userId) ?? []).filter((x) => x.id !== sub.id),
          )
        }
      }
    }
  }

  const claim = await db.rpc('claim_due_doses')
  if (claim.error) return new Response(`claim failed: ${claim.error.message}`, { status: 500 })
  const doses = claim.data as {
    dose_id: string
    user_id: string
    med_name: string
    strength: string | null
    scheduled_for: string
  }[]

  const tzByUser = new Map<string, string>()
  const userIds = [...new Set(doses.map((d) => d.user_id))]
  if (userIds.length) {
    const { data } = await db.from('profiles').select('user_id, time_zone').in('user_id', userIds)
    for (const p of data ?? []) tzByUser.set(p.user_id, p.time_zone)
  }

  for (const d of doses) {
    const when = localTime(d.scheduled_for, tzByUser.get(d.user_id) ?? 'UTC')
    const actionToken = await signActionToken(
      { doseId: d.dose_id, userId: d.user_id, exp: Date.now() + DAY_MS },
      tokenKey,
    )
    await pushToUser(d.user_id, {
      type: 'dose',
      tag: d.dose_id,
      title: `Time for ${d.med_name}`,
      body: d.strength ? `${d.strength}, due ${when}` : `Due ${when}`,
      actionToken,
    })
  }

  // Refill pass: one push when a tracked med goes low; re-armed once it is back above threshold.
  const meds = await db
    .from('medications')
    .select(
      'id, user_id, name, stock, units_per_dose, refill_threshold_days, paused, notify, refill_alerted_at, schedules(kind, times, weekdays, interval_days)',
    )
    .not('stock', 'is', null)
    .eq('paused', false)
  if (meds.error) return new Response(`refill read failed: ${meds.error.message}`, { status: 500 })

  for (const m of meds.data ?? []) {
    const scheds = (m.schedules ?? []) as ScheduleLike[]
    const state = refillState(m, scheds)
    if (state === 'low' && m.refill_alerted_at === null && m.notify) {
      const left = daysLeft(
        m.stock,
        m.units_per_dose,
        scheds.reduce((s, x) => s + avgDosesPerDay(x), 0),
      )
      await pushToUser(m.user_id, {
        type: 'refill',
        tag: `refill-${m.id}`,
        title: `${m.name} is running low`,
        body: `About ${Math.round(left ?? 0)} days left. Time to refill.`,
      })
      await db.from('medications').update({ refill_alerted_at: new Date().toISOString() }).eq('id', m.id)
    } else if (state === 'ok' && m.refill_alerted_at !== null) {
      await db.from('medications').update({ refill_alerted_at: null }).eq('id', m.id)
    }
  }

  return Response.json({ claimed: doses.length, sent, pruned })
})
