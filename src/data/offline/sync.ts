// Offline sync: every write is an op that is applied to the local cache at once, queued in the
// outbox, and sent to Supabase in order when there is a connection. Reads fall back to the cache.
import { currentUserId, supabase } from '../../lib/supabase'
import { applyLocal, toRpc, type Op } from './ops'
import { deleteStore, openStore, type Cache, type OutboxItem, type Store } from './store'

export type SyncStatus = { online: boolean; syncing: boolean; pending: number; failed: OutboxItem[]; needsSignIn: boolean }

export const STALE_DOSE_CODE = 'STALE_DOSE'
type ErrorLike = { name?: string; message?: string; code?: string; status?: number }

let current: { userId: string; store: Promise<Store> } | null = null
let status: SyncStatus = { online: typeof navigator === 'undefined' || navigator.onLine, syncing: false, pending: 0, failed: [], needsSignIn: false }
const listeners = new Set<(s: SyncStatus) => void>()
const results = new Map<string, { ok: true } | { ok: false; error: unknown }>()
let running: Promise<void> | null = null
let resetting = false

async function getStore(): Promise<{ userId: string; store: Store }> {
  if (resetting) throw new Error('Signing out')
  const userId = await currentUserId()
  if (resetting) throw new Error('Signing out')
  if (current?.userId !== userId) {
    if (current) void current.store.then((s) => s.close())
    // Deleted elsewhere (sign-out in another tab): drop the dead connection so the next call reopens.
    const opened: Promise<Store> = openStore(userId, () => {
      if (current?.store === opened) current = null
    })
    current = { userId, store: opened }
  }
  return { userId, store: await current.store }
}

/** True while `userId` is still the signed-in user (a run must never send one user's ops as another). */
async function stillSignedIn(userId: string): Promise<boolean> {
  try {
    return (await currentUserId()) === userId
  } catch {
    return false
  }
}

export function classify(e: unknown): 'network' | 'retry' | 'auth' | 'permanent' {
  const err = (e ?? {}) as ErrorLike
  const msg = err.message ?? ''
  // Server overloaded or down (5xx, 429): try again later, never drop the change.
  if (err.status === 429 || (err.status ?? 0) >= 500) return 'retry'
  if (err.status === 401 || err.code === 'PGRST301' || /jwt|refresh token/i.test(msg)) return 'auth'
  if (err.name === 'TypeError' || e instanceof TypeError || /fetch|network/i.test(msg)) return 'network'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'network'
  return 'permanent'
}

async function emit(patch: Partial<SyncStatus> = {}): Promise<void> {
  let items: OutboxItem[] = []
  try {
    items = await (await getStore()).store.list()
  } catch {
    // signed out: nothing queued
  }
  status = {
    ...status,
    ...patch,
    pending: items.filter((i) => i.state === 'pending').length,
    failed: items.filter((i) => i.state === 'failed'),
  }
  for (const fn of listeners) fn(status)
}

export function subscribe(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn)
  fn(status)
  return () => listeners.delete(fn)
}

export function getStatus(): SyncStatus {
  return status
}

/** The error with the HTTP status attached (PostgREST errors don't carry it). */
const withStatus = (error: object, status: number) => Object.assign(new Error((error as ErrorLike).message), error, { status })

async function send(op: Op): Promise<void> {
  const call = toRpc(op)
  if ('table' in call) {
    const { error, status } = await supabase.from(call.table).delete().eq('id', call.deleteId)
    if (error) throw withStatus(error, status)
    return
  }
  const { data, error, status } = await supabase.rpc(call.name, call.args)
  if (error) throw withStatus(error, status)
  if (op.kind === 'doseStatus' && !(data as { id?: string } | null)?.id) {
    throw Object.assign(new Error('That dose is no longer scheduled, so it was not saved.'), { code: STALE_DOSE_CODE })
  }
}

/** Replace the cache with the server's data after changes landed (server-side effects win). */
async function refresh(store: Store, userId: string): Promise<void> {
  const cache = await store.readCache()
  const nowMs = Date.now()
  // A fixed recent window (what Today and its week strip show), not all cached history: keeps online writes cheap.
  const from = new Date(nowMs - 2 * 86_400_000).toISOString()
  const to = new Date(nowMs + 3 * 86_400_000).toISOString()
  const [meds, schedules, profile, doses] = await Promise.all([
    supabase.from('medications').select('*').order('name'),
    supabase.from('schedules').select('*'),
    supabase.from('profiles').select('*').eq('user_id', userId).single(),
    supabase.from('dose_events').select('*').gte('scheduled_for', from).lt('scheduled_for', to).order('scheduled_for'),
  ])
  for (const r of [meds, schedules, profile, doses]) if (r.error) throw r.error
  const outside = cache.doses.filter((d) => d.scheduled_for < from || d.scheduled_for >= to)
  await store.writeCache({
    meds: meds.data as Cache['meds'],
    schedules: schedules.data as Cache['schedules'],
    profile: profile.data as Cache['profile'],
    doses: [...outside, ...(doses.data as Cache['doses'])].sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for)),
  })
}

async function run(): Promise<void> {
  let store: Store
  let userId: string
  try {
    ;({ store, userId } = await getStore())
  } catch {
    return // signed out: nothing to send
  }
  await emit({ syncing: true })
  let sent = false
  let patch: Partial<SyncStatus> = { online: true, needsSignIn: false }
  for (const item of await store.list()) {
    if (item.state !== 'pending') continue
    if (!(await stillSignedIn(userId))) {
      await emit({ syncing: false })
      return
    }
    try {
      await send(item.op)
      await store.remove(item.seq)
      results.set(item.op.opId, { ok: true })
      sent = true
    } catch (e) {
      const kind = classify(e)
      if (kind === 'network') {
        patch = { online: false }
        break
      }
      if (kind === 'auth') {
        patch = { needsSignIn: true }
        break
      }
      if (kind === 'retry') break // stays pending; the next flush tries again
      await store.update({ ...item, state: 'failed', error: (e as ErrorLike).message ?? String(e), tries: item.tries + 1 })
      results.set(item.op.opId, { ok: false, error: e })
      sent = true
    }
  }
  if (sent && (await stillSignedIn(userId))) {
    try {
      await refresh(store, userId)
    } catch (e) {
      if (classify(e) === 'network') patch = { online: false }
    }
  }
  await emit({ ...patch, syncing: false })
}

/** Sends pending ops in order. Concurrent calls share one run; other tabs wait on a lock. */
export function flush(): Promise<void> {
  if (running) return running
  let p: Promise<void> | null = null
  p = (async () => {
    try {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
      await (locks ? locks.request('medtracker-sync', run) : run())
    } finally {
      if (running === p) running = null // a run abandoned by sign-out must not clear a newer one
    }
  })()
  running = p
  return p
}

/**
 * Applies `op` locally, queues it and tries to send it. Returns `localResult` of the cache
 * afterwards (the server's data when it synced). Throws if the server rejected this op.
 */
export async function submit<T>(op: Op, localResult: (c: Cache) => T): Promise<T> {
  const { store } = await getStore()
  await store.writeCache(applyLocal(await store.readCache(), op, Date.now()))
  await store.enqueue(op)
  await emit()
  await flush()
  const r = results.get(op.opId)
  results.delete(op.opId)
  if (r && !r.ok) {
    const failed = (await store.list()).find((i) => i.op.opId === op.opId)
    if (failed) await store.remove(failed.seq) // the caller shows this error itself
    await emit()
    throw r.error
  }
  return localResult(await store.readCache())
}

/** Network-first read; the cache answers while changes are queued or the network is down. */
export async function readThrough<T>(
  fetch: () => Promise<T>,
  fromCache: (c: Cache) => T,
  intoCache: (c: Cache, v: T) => Cache,
): Promise<T> {
  let store: Store
  let userId: string
  try {
    ;({ store, userId } = await getStore())
  } catch {
    return fetch()
  }
  if (status.pending > 0 || (await store.list()).some((i) => i.state === 'pending')) {
    await flush()
    if ((await store.list()).some((i) => i.state === 'pending')) return fromCache(await store.readCache())
  }
  try {
    const v = await fetch()
    if (!(await stillSignedIn(userId))) return v // never cache one user's rows under another
    await store.writeCache(intoCache(await store.readCache(), v))
    if (!status.online) await emit({ online: true })
    return v
  } catch (e) {
    const cache = await store.readCache()
    if (classify(e) !== 'network' || cache.profile === null) throw e
    await emit({ online: false })
    return fromCache(cache)
  }
}

/** The cached data for the signed-in user, or null when signed out. */
export async function snapshot(): Promise<Cache | null> {
  try {
    return await (await getStore()).store.readCache()
  } catch {
    return null
  }
}

export async function pendingCount(): Promise<number> {
  try {
    return (await (await getStore()).store.list()).filter((i) => i.state === 'pending').length
  } catch {
    return 0
  }
}

export async function dismissFailed(seq: number): Promise<void> {
  await (await getStore()).store.remove(seq)
  await emit()
}

/**
 * Forget a user's cache and outbox (default: the signed-in user). Call after sign-out was confirmed.
 * Waits up to `waitMs` for a running sync; a hung one is abandoned (deleting the database closes it).
 */
export async function resetForSignOut(forUserId?: string, waitMs = 5000): Promise<void> {
  resetting = true // first, before any await: no new run or store may start
  try {
    if (running) {
      let timer: ReturnType<typeof setTimeout> | undefined
      await Promise.race([running.catch(() => undefined), new Promise<void>((r) => (timer = setTimeout(r, waitMs)))])
      clearTimeout(timer)
      running = null
    }
    let userId: string
    try {
      userId = forUserId ?? current?.userId ?? (await currentUserId())
    } catch {
      return
    }
    if (current?.userId === userId) {
      ;(await current.store).close()
      current = null
    }
    await deleteStore(userId)
  } finally {
    resetting = false
  }
  status = { ...status, pending: 0, failed: [], needsSignIn: false }
  for (const fn of listeners) fn(status)
}

/** Flush now, when the connection returns, and when the app comes back to the foreground. */
export function startSyncTriggers(): () => void {
  const kick = () => void flush().catch((e: unknown) => console.error('sync failed', e))
  const onVisible = () => document.visibilityState === 'visible' && kick()
  const onOffline = () => void emit({ online: false })
  window.addEventListener('online', kick)
  window.addEventListener('offline', onOffline)
  document.addEventListener('visibilitychange', onVisible)
  kick()
  return () => {
    window.removeEventListener('online', kick)
    window.removeEventListener('offline', onOffline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
