// Send orchestration for send-reminders, with all I/O injected (dependency-free, unit-tested).
import { avgDosesPerDay, daysLeft, refillState, type MedLike, type ScheduleLike } from './refill.ts'

export type PushPayload =
  // scheduledFor: ISO due time, shown as the notification's timestamp.
  | { type: 'dose'; tag: string; title: string; body: string; actionToken: string; scheduledFor: string }
  | { type: 'refill'; tag: string; title: string; body: string }

export type SendResult = 'ok' | 'gone' | 'error' | 'disallowed'

export type ClaimedDose = {
  dose_id: string
  user_id: string
  med_name: string
  strength: string | null
  scheduled_for: string
  due_at: string // coalesce(snoozed_until, scheduled_for) before the claim cleared it
}

export type RefillMed = MedLike & {
  id: string
  user_id: string
  name: string
  notify: boolean
  refill_alerted_at: string | null
  schedules: ScheduleLike[]
}

export type Deps = {
  now: () => number
  claim: () => Promise<ClaimedDose[]>
  timeZones: (userIds: string[]) => Promise<Map<string, string>> // throws on read error
  subsFor: (userId: string) => Promise<{ id: string }[]>
  send: (sub: { id: string }, payload: PushPayload) => Promise<SendResult>
  prune: (subId: string) => Promise<boolean>
  unclaim: (doseIds: string[]) => Promise<void>
  signToken: (c: { doseId: string; userId: string; exp: number }) => Promise<string>
  // One page of tracked meds ordered by id, starting after `afterId` (null = first page).
  refillMeds: (afterId: string | null, limit: number) => Promise<RefillMed[]>
  markRefill: (medId: string, alerted: boolean) => Promise<void> // throws on write error
}

// sent = doses delivered to at least one device; refills = refill alerts delivered.
export type RunResult = {
  claimed: number
  sent: number
  refills: number
  pruned: number
  unclaimed: number
  errors: number
}

const HOUR = 3600_000
const DAY = 24 * HOUR
export const CONCURRENCY = 5
// Below PostgREST's default 1,000-row cap, so a page is never silently truncated.
export const REFILL_PAGE = 500

function localTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso))
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++])
    }),
  )
}

export async function runReminders(d: Deps): Promise<RunResult> {
  const r: RunResult = { claimed: 0, sent: 0, refills: 0, pruned: 0, unclaimed: 0, errors: 0 }
  const subCache = new Map<string, Promise<{ id: string }[]>>()
  const subs = (u: string) => {
    let p = subCache.get(u)
    if (!p) subCache.set(u, (p = d.subsFor(u)))
    return p
  }
  // One prune per dead sub, even when concurrent doses for the same user both see it gone.
  const pruning = new Map<string, Promise<boolean>>()

  // Sends to every sub of a user; returns the individual results (gone subs are pruned).
  async function pushToUser(userId: string, payload: PushPayload): Promise<SendResult[]> {
    const list = [...(await subs(userId))]
    const results: SendResult[] = []
    for (const sub of list) {
      const res = await d.send(sub, payload)
      results.push(res)
      if (res !== 'gone') continue
      // Drop it from the cache synchronously (no await between read and write) so later sends skip it.
      subCache.set(userId, subs(userId).then((cur) => cur.filter((x) => x.id !== sub.id)))
      if (pruning.has(sub.id)) continue
      const p = d.prune(sub.id)
      pruning.set(sub.id, p)
      if (await p) r.pruned++
    }
    return results
  }

  const doses = await d.claim()
  r.claimed = doses.length
  const toUnclaim: string[] = []
  const retryable = (x: ClaimedDose) => d.now() - Date.parse(x.due_at) <= HOUR

  let tz = new Map<string, string>()
  let tzOk = true
  if (doses.length) {
    try {
      tz = await d.timeZones([...new Set(doses.map((x) => x.user_id))])
    } catch {
      tzOk = false
      r.errors++
    }
  }

  if (!tzOk) {
    for (const x of doses) if (retryable(x)) toUnclaim.push(x.dose_id)
  } else {
    await pool(doses, CONCURRENCY, async (x) => {
      try {
        const zone = tz.get(x.user_id)
        if (!zone) throw new Error('no time zone')
        const when = localTime(x.scheduled_for, zone)
        const actionToken = await d.signToken({ doseId: x.dose_id, userId: x.user_id, exp: d.now() + DAY })
        const results = await pushToUser(x.user_id, {
          type: 'dose',
          tag: x.dose_id,
          title: `Time for ${x.med_name}`,
          body: x.strength ? `${x.strength}, due ${when}` : `Due ${when}`,
          actionToken,
          scheduledFor: x.scheduled_for,
        })
        if (results.includes('ok')) r.sent++
        // Transient failure only: nothing delivered and at least one attempt hit a retryable error.
        else if (results.includes('error') && retryable(x)) toUnclaim.push(x.dose_id)
      } catch {
        r.errors++
        if (retryable(x)) toUnclaim.push(x.dose_id)
      }
    })
  }

  if (toUnclaim.length) {
    try {
      await d.unclaim(toUnclaim)
      r.unclaimed = toUnclaim.length
    } catch {
      r.errors++
    }
  }

  // Refill pass, paged by id so it covers every tracked med. Alerted flag only set once at least
  // one device accepted the push. A page read error stops the pass; the next run retries.
  let after: string | null = null
  for (;;) {
    let meds: RefillMed[]
    try {
      meds = await d.refillMeds(after, REFILL_PAGE)
    } catch {
      r.errors++
      break
    }
    if (!meds.length) break
    after = meds[meds.length - 1].id
    for (const m of meds) {
      try {
        const state = refillState(m, m.schedules)
        if (state === 'low' && m.refill_alerted_at === null && m.notify) {
          const left = daysLeft(m.stock, m.units_per_dose, m.schedules.reduce((s, x) => s + avgDosesPerDay(x), 0))
          const results = await pushToUser(m.user_id, {
            type: 'refill',
            tag: `refill-${m.id}`,
            title: `${m.name} is running low`,
            body: `About ${Math.round(left ?? 0)} days left. Time to refill.`,
          })
          if (results.includes('ok')) {
            r.refills++
            await d.markRefill(m.id, true)
          }
        } else if (state === 'ok' && m.refill_alerted_at !== null) {
          await d.markRefill(m.id, false)
        }
      } catch {
        r.errors++
      }
    }
  }
  return r
}
