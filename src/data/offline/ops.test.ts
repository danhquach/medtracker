import { describe, expect, it } from 'vitest'
import type { DoseEvent, Medication, Profile, Schedule } from '../../lib/types'
import { applyLocal, toRpc, type Op } from './ops'
import type { Cache } from './store'

const NOW = Date.parse('2026-10-20T14:00:00Z') // 10:00 in Toronto
const AT = '2026-10-20T13:55:00.000Z'
const profile = { user_id: 'u1', time_zone: 'America/Toronto' } as Profile
const med = (over: Partial<Medication> = {}): Medication => ({
  id: 'm1', user_id: 'u1', name: 'A', strength: null, form: null, notes: null, units_per_dose: 2, stock: 10,
  refill_threshold_days: 7, notify: true, paused: false, refill_alerted_at: null, created_at: '', updated_at: '', ...over,
})
const dose = (over: Partial<DoseEvent> = {}): DoseEvent => ({
  id: 'd1', user_id: 'u1', medication_id: 'm1', scheduled_for: '2026-10-20T12:00:00.000Z', status: 'pending',
  acted_at: null, notified_at: null, snoozed_until: null, ...over,
})
const cache = (over: Partial<Cache> = {}): Cache => ({ meds: [med()], schedules: [], doses: [dose()], profile, ...over })
type Body = Op extends infer T ? (T extends Op ? Omit<T, 'opId' | 'at'> : never) : never
const op = (o: Body): Op => ({ opId: 'op1', at: AT, ...o }) as Op
const taken = op({ kind: 'doseStatus', medId: 'm1', scheduledFor: '2026-10-20T12:00:00.000Z', status: 'taken' })
const daily = { kind: 'daily' as const, times: ['20:00:00'], weekdays: null, interval_days: null, start_date: null, end_date: null }
const medInput = { id: 'm2', name: 'B', strength: null, form: null, notes: null, units_per_dose: 1, refill_threshold_days: 7, notify: true }

describe('applyLocal', () => {
  it('doseStatus taken sets status, time and decrements stock', () => {
    const c = applyLocal(cache(), taken, NOW)
    expect(c.doses[0]).toMatchObject({ status: 'taken', acted_at: AT })
    expect(c.meds[0].stock).toBe(8)
  })

  it('taken twice decrements stock once', () => {
    const c = applyLocal(applyLocal(cache(), taken, NOW), taken, NOW)
    expect(c.meds[0].stock).toBe(8)
  })

  it('untaking restores stock', () => {
    const back = op({ kind: 'doseStatus', medId: 'm1', scheduledFor: '2026-10-20T12:00:00.000Z', status: 'pending' })
    const c = applyLocal(applyLocal(cache(), taken, NOW), back, NOW)
    expect(c.meds[0].stock).toBe(10)
    expect(c.doses[0]).toMatchObject({ status: 'pending', acted_at: null })
  })

  it('stock floors at 0 and untracked stock stays null', () => {
    expect(applyLocal(cache({ meds: [med({ stock: 1 })] }), taken, NOW).meds[0].stock).toBe(0)
    expect(applyLocal(cache({ meds: [med({ stock: null })] }), taken, NOW).meds[0].stock).toBeNull()
  })

  it('does not mutate the input cache', () => {
    const c = cache()
    applyLocal(c, taken, NOW)
    expect(c.doses[0].status).toBe('pending')
    expect(c.meds[0].stock).toBe(10)
  })

  it('prn adds a taken dose with the op dose id and decrements stock', () => {
    const c = applyLocal(cache(), op({ kind: 'prn', medId: 'm1', doseId: 'p1' }), NOW)
    expect(c.doses.find((d) => d.id === 'p1')).toMatchObject({ status: 'taken', scheduled_for: AT, acted_at: AT })
    expect(c.meds[0].stock).toBe(8)
  })

  it('new daily med adds provisional doses for today and tomorrow', () => {
    const c = applyLocal(cache(), op({ kind: 'saveMed', create: true, med: { ...medInput, stock: 30 }, schedules: [daily] }), NOW)
    expect(c.meds.find((m) => m.id === 'm2')).toMatchObject({ name: 'B', stock: 30, paused: false, user_id: 'u1' })
    expect(c.schedules.filter((s) => s.medication_id === 'm2')).toHaveLength(1)
    expect(c.doses.filter((d) => d.medication_id === 'm2').map((d) => d.scheduled_for)).toEqual([
      '2026-10-21T00:00:00.000Z',
      '2026-10-22T00:00:00.000Z',
    ])
  })

  it('saveMed edit without stock key keeps cached stock', () => {
    const c = applyLocal(cache(), op({ kind: 'saveMed', create: false, med: { ...medInput, id: 'm1', name: 'Renamed' }, schedules: [] }), NOW)
    expect(c.meds[0]).toMatchObject({ name: 'Renamed', stock: 10 })
  })

  it('saveMed edit drops future pending doses and keeps acted ones', () => {
    const future = dose({ id: 'f', scheduled_for: '2026-10-20T20:00:00.000Z' })
    const done = dose({ id: 'done', scheduled_for: '2026-10-20T21:00:00.000Z', status: 'taken' })
    const old: Schedule = { ...daily, id: 's', user_id: 'u1', medication_id: 'm1', times: ['16:00:00'] }
    const c = applyLocal(cache({ doses: [future, done], schedules: [old] }), op({ kind: 'saveMed', create: false, med: { ...medInput, id: 'm1' }, schedules: [] }), NOW)
    expect(c.doses.map((d) => d.id)).toEqual(['done'])
    expect(c.schedules).toEqual([])
  })

  it('deleteMed removes the med, its schedules and doses', () => {
    const s: Schedule = { ...daily, id: 's', user_id: 'u1', medication_id: 'm1' }
    const c = applyLocal(cache({ schedules: [s] }), op({ kind: 'deleteMed', medId: 'm1' }), NOW)
    expect(c).toMatchObject({ meds: [], schedules: [], doses: [] })
  })

  it('setPaused drops future pending doses; resume regenerates them', () => {
    const s: Schedule = { ...daily, id: 's', user_id: 'u1', medication_id: 'm1' }
    const base = cache({ schedules: [s], doses: [dose({ scheduled_for: '2026-10-21T00:00:00.000Z' })] })
    const paused = applyLocal(base, op({ kind: 'setPaused', medId: 'm1', paused: true }), NOW)
    expect(paused.meds[0].paused).toBe(true)
    expect(paused.doses).toEqual([])
    const resumed = applyLocal(paused, op({ kind: 'setPaused', medId: 'm1', paused: false }), NOW)
    expect(resumed.doses.map((d) => d.scheduled_for)).toEqual(['2026-10-21T00:00:00.000Z', '2026-10-22T00:00:00.000Z'])
  })

  it('addStock adds to tracked and starts untracked stock', () => {
    expect(applyLocal(cache(), op({ kind: 'addStock', medId: 'm1', qty: 5 }), NOW).meds[0].stock).toBe(15)
    expect(applyLocal(cache({ meds: [med({ stock: null })] }), op({ kind: 'addStock', medId: 'm1', qty: 5 }), NOW).meds[0].stock).toBe(5)
  })

  it('updateProfile merges the patch', () => {
    expect(applyLocal(cache(), op({ kind: 'updateProfile', patch: { nickname: 'N' } }), NOW).profile).toMatchObject({ nickname: 'N', user_id: 'u1' })
  })

  it('updateProfile with a new zone swaps future doses to it, keeps acted ones, marks the zone chosen', () => {
    const s: Schedule = { ...daily, id: 's', user_id: 'u1', medication_id: 'm1' }
    const base = cache({
      schedules: [s],
      doses: [
        dose({ id: 'old', scheduled_for: '2026-10-21T00:00:00.000Z' }), // 20:00 Toronto
        dose({ id: 'early', scheduled_for: '2026-10-22T00:00:00.000Z', status: 'taken' }),
      ],
    })
    const c = applyLocal(base, op({ kind: 'updateProfile', patch: { time_zone: 'America/Vancouver' } }), NOW)
    expect(c.profile).toMatchObject({ time_zone: 'America/Vancouver', time_zone_chosen: true })
    expect(c.doses.map((d) => `${d.id.startsWith('local:') ? 'new' : d.id} ${d.scheduled_for}`)).toEqual([
      'new 2026-10-21T03:00:00.000Z', // 20:00 Vancouver
      'early 2026-10-22T00:00:00.000Z',
      'new 2026-10-22T03:00:00.000Z',
    ])
  })
})

describe('toRpc', () => {
  const cases: [Op, ReturnType<typeof toRpc>][] = [
    [taken, { name: 'set_dose_status_at', args: { p_med: 'm1', p_scheduled_for: '2026-10-20T12:00:00.000Z', p_status: 'taken', p_acted_at: AT } }],
    [op({ kind: 'prn', medId: 'm1', doseId: 'p1' }), { name: 'log_prn_dose', args: { p_med: 'm1', p_id: 'p1', p_at: AT } }],
    [
      op({ kind: 'saveMed', create: true, med: { ...medInput }, schedules: [daily] }),
      { name: 'save_med', args: { p_med: { ...medInput }, p_schedules: [daily], p_create: true } },
    ],
    [op({ kind: 'deleteMed', medId: 'm1' }), { table: 'medications', deleteId: 'm1' }],
    [op({ kind: 'setPaused', medId: 'm1', paused: true }), { name: 'set_paused', args: { p_med: 'm1', p_paused: true } }],
    [op({ kind: 'addStock', medId: 'm1', qty: 3 }), { name: 'add_stock', args: { p_med: 'm1', p_qty: 3, p_op: 'op1' } }],
    [op({ kind: 'updateProfile', patch: { snooze_minutes: 5 } }), { name: 'update_profile', args: { p_patch: { snooze_minutes: 5 } } }],
  ]
  it.each(cases)('toRpc maps %j', (o, expected) => {
    expect(toRpc(o)).toEqual(expected)
  })
})
