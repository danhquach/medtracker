import { beforeEach, describe, expect, it, vi } from 'vitest'

// The mock persists to localStorage, which this test environment doesn't provide usably.
vi.hoisted(() => {
  const mem = new Map<string, string>()
  const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
})
import { supabase } from './supabase.mock'

const med = { name: 'A', strength: null, form: null, notes: null, units_per_dose: 1, stock: 5, refill_threshold_days: 7, notify: true }
const stock = async (id: string) => ((await supabase.from('medications').select().eq('id', id).single()).data as { stock: number }).stock

beforeEach(async () => {
  ;(window as unknown as { __mockOffline: (on: boolean) => void }).__mockOffline(false)
  await supabase.auth.signInAnonymously()
})

describe('mock offline sync RPCs', () => {
  it('save_med create with a client id replays to the same row', async () => {
    const id = crypto.randomUUID()
    const args = { p_med: { ...med, id }, p_schedules: [], p_create: true }
    expect((await supabase.rpc('save_med', args)).data).toBe(id)
    expect((await supabase.rpc('save_med', args)).data).toBe(id)
    expect(((await supabase.from('medications').select()).data as unknown[]).length).toBe(1)
  })

  it('log_prn_dose replay is a no-op', async () => {
    const { data: id } = await supabase.rpc('save_med', { p_med: med, p_schedules: [] })
    const args = { p_med: id, p_id: crypto.randomUUID(), p_at: new Date(Date.now() - 60_000).toISOString() }
    const first = await supabase.rpc('log_prn_dose', args)
    await supabase.rpc('log_prn_dose', args)
    expect((first.data as { id: string }).id).toBe(args.p_id)
    expect(((await supabase.from('dose_events').select()).data as unknown[]).length).toBe(1)
    expect(await stock(id as string)).toBe(4)
  })

  it('add_stock replay with same p_op adds once', async () => {
    const { data: id } = await supabase.rpc('save_med', { p_med: med, p_schedules: [] })
    const args = { p_med: id, p_qty: 10, p_op: crypto.randomUUID() }
    expect((await supabase.rpc('add_stock', args)).data).toBe(15)
    expect((await supabase.rpc('add_stock', args)).data).toBe(15)
  })

  it('set_dose_status_at finds the dose by med and time', async () => {
    const { data: id } = await supabase.rpc('save_med', { p_med: med, p_schedules: [] })
    const { data: prn } = await supabase.rpc('log_prn_dose', { p_med: id })
    const d = prn as { scheduled_for: string }
    const r = await supabase.rpc('set_dose_status_at', { p_med: id, p_scheduled_for: d.scheduled_for, p_status: 'skipped' })
    expect((r.data as { status: string }).status).toBe('skipped')
    const none = await supabase.rpc('set_dose_status_at', { p_med: id, p_scheduled_for: '2000-01-01T00:00:00.000Z', p_status: 'taken' })
    expect(none.data).toBeNull()
  })

  it('set_paused and update_profile are single calls', async () => {
    const { data: id } = await supabase.rpc('save_med', { p_med: med, p_schedules: [] })
    expect((await supabase.rpc('set_paused', { p_med: id, p_paused: true })).error).toBeNull()
    const p = await supabase.rpc('update_profile', { p_patch: { nickname: 'N', password_set: false } })
    expect((p.data as { nickname: string; password_set: boolean }).nickname).toBe('N')
  })

  it('offline switch returns a fetch TypeError', async () => {
    const offline: string[] = []
    window.addEventListener('offline', () => offline.push('offline'), { once: true })
    ;(window as unknown as { __mockOffline: (on: boolean) => void }).__mockOffline(true)
    const r = await supabase.rpc('touch_last_seen')
    const q = await supabase.from('medications').select()
    expect(r.error).toBeInstanceOf(TypeError)
    expect(q.error).toBeInstanceOf(TypeError)
    expect(offline).toEqual(['offline'])
  })
})
