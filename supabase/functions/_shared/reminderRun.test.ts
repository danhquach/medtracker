import { describe, expect, it } from 'vitest'
import { runReminders, type ClaimedDose, type Deps, type RefillMed, type SendResult } from './reminderRun'

const NOW = Date.parse('2026-10-19T15:00:00Z')
const dose = (id: string, minsAgo = 5, user = 'u1', dueMinsAgo = minsAgo): ClaimedDose => ({
  dose_id: id,
  user_id: user,
  med_name: 'Med',
  strength: '5 mg',
  scheduled_for: new Date(NOW - minsAgo * 60_000).toISOString(),
  due_at: new Date(NOW - dueMinsAgo * 60_000).toISOString(),
})

function mk(over: Partial<Deps> & { doses?: ClaimedDose[]; results?: SendResult[]; meds?: RefillMed[] } = {}) {
  const log = { unclaimed: [] as string[], pruned: [] as string[], marks: [] as [string, boolean][], payloads: [] as unknown[] }
  const results = over.results ?? ['ok']
  let i = 0
  const deps: Deps = {
    now: () => NOW,
    claim: async () => over.doses ?? [],
    timeZones: async (ids) => new Map(ids.map((u) => [u, 'America/Toronto'])),
    subsFor: async () => results.map((_, k) => ({ id: `s${k}` })),
    send: async (_s, p) => {
      log.payloads.push(p)
      return results[i++ % results.length]
    },
    prune: async (id) => (log.pruned.push(id), true),
    unclaim: async (ids) => void log.unclaimed.push(...ids),
    signToken: async () => 'tok',
    refillMeds: async () => over.meds ?? [],
    markRefill: async (id, a) => void log.marks.push([id, a]),
    ...over,
  }
  return { deps, log }
}

const lowMed = (o: Partial<RefillMed> = {}): RefillMed => ({
  id: 'm1', user_id: 'u1', name: 'Pills', stock: 3, units_per_dose: 1, refill_threshold_days: 7,
  paused: false, notify: true, refill_alerted_at: null,
  schedules: [{ kind: 'daily', times: ['08:00'], weekdays: null, interval_days: null }],
  ...o,
})

describe('runReminders', () => {
  it('sends ok and does not unclaim', async () => {
    const { deps, log } = mk({ doses: [dose('d1')] })
    const r = await runReminders(deps)
    expect(r).toMatchObject({ claimed: 1, sent: 1, pruned: 0, unclaimed: 0 })
    expect(log.unclaimed).toEqual([])
    expect(log.payloads[0]).toMatchObject({ type: 'dose', title: 'Time for Med', body: expect.stringMatching(/^5 mg, due 10:55\sAM$/) })
  })
  it('all-transient error -> unclaimed', async () => {
    const { deps, log } = mk({ doses: [dose('d1')], results: ['error', 'error'] })
    expect((await runReminders(deps)).unclaimed).toBe(1)
    expect(log.unclaimed).toEqual(['d1'])
  })
  it('more than 1h past due -> not unclaimed', async () => {
    const { deps, log } = mk({ doses: [dose('d1', 61)], results: ['error'] })
    await runReminders(deps)
    expect(log.unclaimed).toEqual([])
  })
  it.each([['disallowed'], ['gone']] as const)('%s -> not unclaimed', async (res) => {
    const { deps, log } = mk({ doses: [dose('d1')], results: [res] })
    await runReminders(deps)
    expect(log.unclaimed).toEqual([])
    expect(log.pruned).toEqual(res === 'gone' ? ['s0'] : [])
  })
  it('no subscriptions -> not unclaimed', async () => {
    const { deps, log } = mk({ doses: [dose('d1')], subsFor: async () => [] })
    await runReminders(deps)
    expect(log.unclaimed).toEqual([])
  })
  it('one ok + one error -> not unclaimed', async () => {
    const { deps, log } = mk({ doses: [dose('d1')], results: ['ok', 'error'] })
    await runReminders(deps)
    expect(log.unclaimed).toEqual([])
  })
  it('a thrown dose does not abort the rest and is unclaimed', async () => {
    const { deps, log } = mk({
      doses: [dose('bad'), dose('good')],
      signToken: async (c) => {
        if (c.doseId === 'bad') throw new Error('boom')
        return 'tok'
      },
    })
    const r = await runReminders(deps)
    expect(r.sent).toBe(1)
    expect(r.errors).toBe(1)
    expect(log.unclaimed).toEqual(['bad'])
  })
  it('time zone read failure sends nothing and unclaims retryable doses', async () => {
    const { deps, log } = mk({
      doses: [dose('d1'), dose('old', 90)],
      timeZones: async () => {
        throw new Error('db')
      },
    })
    const r = await runReminders(deps)
    expect(r.sent).toBe(0)
    expect(log.unclaimed).toEqual(['d1'])
  })
  it('retry cutoff uses due_at (snooze expiry), not scheduled_for', async () => {
    const mkErr = (doses: ClaimedDose[]) =>
      mk({
        doses,
        timeZones: async () => {
          throw new Error('db')
        },
      })
    // Scheduled 3h ago but snooze just expired: still retryable.
    const snoozed = mkErr([dose('snz', 180, 'u1', 2)])
    await runReminders(snoozed.deps)
    expect(snoozed.log.unclaimed).toEqual(['snz'])
    // Scheduled 10 min ago but due 90 min ago: not retryable.
    const stale = mkErr([dose('stale', 10, 'u1', 90)])
    await runReminders(stale.deps)
    expect(stale.log.unclaimed).toEqual([])
  })
  it('refill marked only when a push was ok', async () => {
    const ok = mk({ meds: [lowMed()], results: ['ok'] })
    await runReminders(ok.deps)
    expect(ok.log.marks).toEqual([['m1', true]])
    expect(ok.log.payloads[0]).toMatchObject({ type: 'refill', body: 'About 3 days left. Time to refill.' })
    for (const res of ['error', 'gone', 'disallowed'] as const) {
      const bad = mk({ meds: [lowMed()], results: [res] })
      await runReminders(bad.deps)
      expect(bad.log.marks).toEqual([])
    }
  })
  it('refill re-armed when ok again; skipped for notify=false; mark error is counted', async () => {
    const a = mk({ meds: [lowMed({ stock: 30, refill_alerted_at: 'x' })] })
    await runReminders(a.deps)
    expect(a.log.marks).toEqual([['m1', false]])
    const b = mk({ meds: [lowMed({ notify: false })] })
    await runReminders(b.deps)
    expect(b.log.payloads).toEqual([])
    const c = mk({
      meds: [lowMed()],
      markRefill: async () => {
        throw new Error('db')
      },
    })
    expect((await runReminders(c.deps)).errors).toBe(1)
  })
  it('limits concurrency to 5', async () => {
    let cur = 0
    let max = 0
    const { deps } = mk({
      doses: Array.from({ length: 20 }, (_, i) => dose(`d${i}`)),
      send: async () => {
        max = Math.max(max, ++cur)
        await new Promise((r) => setTimeout(r, 5))
        cur--
        return 'ok'
      },
    })
    await runReminders(deps)
    expect(max).toBeLessThanOrEqual(5)
    expect(max).toBeGreaterThan(1)
  })
})
