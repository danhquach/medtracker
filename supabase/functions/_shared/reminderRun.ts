// Send orchestration for send-reminders, with all I/O injected (dependency-free, unit-tested).
import { avgDosesPerDay, daysLeft, refillState, type MedLike, type ScheduleLike } from './refill.ts'

export type PushPayload =
  | { type: 'dose'; tag: string; title: string; body: string; actionToken: string }
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
  refillMeds: () => Promise<RefillMed[]>
  markRefill: (medId: string, alerted: boolean) => Promise<void> // throws on write error
}

export type RunResult = { claimed: number; sent: number; pruned: number; unclaimed: number; errors: number }

const HOUR = 3600_000
const DAY = 24 * HOUR
export const CONCURRENCY = 5

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
  const r: RunResult = { claimed: 0, sent: 0, pruned: 0, unclaimed: 0, errors: 0 }
  const subCache = new Map<string, Promise<{ id: string }[]>>()
  const subs = (u: string) => {
    let p = subCache.get(u)
    if (!p) subCache.set(u, (p = d.subsFor(u)))
    return p
  }

  // Sends to every sub of a user; returns the individual results (gone subs are pruned).
  async function pushToUser(userId: string, payload: PushPayload): Promise<SendResult[]> {
    const list = [...(await subs(userId))]
    const results: SendResult[] = []
    for (const sub of list) {
      const res = await d.send(sub, payload)
      results.push(res)
      if (res === 'ok') r.sent++
      else if (res === 'gone' && (await d.prune(sub.id))) {
        r.pruned++
        const cur = await subs(userId)
        subCache.set(userId, Promise.resolve(cur.filter((x) => x.id !== sub.id)))
      }
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
        })
        // Transient failure only: nothing delivered and at least one attempt hit a retryable error.
        if (!results.includes('ok') && results.includes('error') && retryable(x)) toUnclaim.push(x.dose_id)
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

  // Refill pass: alerted flag only set once at least one device accepted the push.
  let meds: RefillMed[] = []
  try {
    meds = await d.refillMeds()
  } catch {
    r.errors++
  }
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
        if (results.includes('ok')) await d.markRefill(m.id, true)
      } else if (state === 'ok' && m.refill_alerted_at !== null) {
        await d.markRefill(m.id, false)
      }
    } catch {
      r.errors++
    }
  }
  return r
}
