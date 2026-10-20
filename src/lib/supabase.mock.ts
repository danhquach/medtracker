// Dev-only stand-in for ./supabase.ts, swapped in by `npm run dev:mock` (see vite.config.ts).
// Keeps all data in this browser's localStorage, so the UI can be exercised without touching
// the hosted (production) project. Mirrors only the calls the app makes, and only roughly the
// server rules in supabase/migrations.
import { generateLocalDoses } from '../data/offline/generate'
import { todayIn } from '../features/today/dayRange'
import type { DoseEvent, Medication, Profile, Schedule } from './types'

type Row = Record<string, unknown>
type Tables = Record<'medications' | 'schedules' | 'dose_events' | 'profiles' | 'push_subscriptions', Row[]>
type MockUser = { id: string; email?: string; is_anonymous: boolean; email_confirmed_at?: string; user_metadata: Row }
type Session = { user: MockUser } | null
type Result = { data: unknown; error: Error | null }

const KEY = 'medtracker-mock'
const empty = (): Tables => ({ medications: [], schedules: [], dose_events: [], profiles: [], push_subscriptions: [] })

function load(): { session: Session; tables: Tables } {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // fall through to a fresh store
  }
  return { session: null, tables: empty() }
}

const db = load()
const save = () => localStorage.setItem(KEY, JSON.stringify(db))
const uid = () => db.session?.user.id ?? null
const now = () => new Date().toISOString()
const ok = (data: unknown): Result => ({ data, error: null })
const fail = (message: string): Result => ({ data: null, error: new Error(message) })
const listeners = new Set<(event: string, session: Session) => void>()

function setSession(session: Session, event: string) {
  db.session = session
  save()
  for (const l of listeners) l(event, session)
}

function startUser(user: Omit<MockUser, 'id' | 'user_metadata'> & { user_metadata?: Row }) {
  const id = crypto.randomUUID()
  db.tables = empty()
  db.tables.profiles.push({
    user_id: id,
    nickname: null,
    time_zone: 'America/Toronto',
    snooze_minutes: 10,
    suggestions_enabled: true,
    password_set: !user.is_anonymous,
    last_seen_at: now(),
  } satisfies Profile)
  setSession({ user: { user_metadata: {}, ...user, id } }, 'SIGNED_IN')
}

const mine = (t: keyof Tables) => db.tables[t].filter((r) => r.user_id === uid())
const profile = () => mine('profiles')[0] as unknown as Profile | undefined
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t)

// generate_doses_for: today and tomorrow, future times only; earlier local days roll over to missed.
// backfill (save_med, MT-39): also today's already-passed times for one med, except skipTimes, with no reminder.
function generateDoses(backfill?: { medId: string; skipTimes: string[] }) {
  const p = profile()
  if (!p) return
  const tz = p.time_zone
  const today = todayIn(tz)
  for (const d of mine('dose_events') as unknown as DoseEvent[]) {
    if (d.status === 'pending' && todayIn(tz, Date.parse(d.scheduled_for)) < today) d.status = 'missed'
  }
  const fresh = generateLocalDoses({
    meds: mine('medications') as unknown as Medication[],
    schedules: mine('schedules') as unknown as Schedule[],
    existing: db.tables.dose_events as unknown as DoseEvent[],
    timeZone: tz,
    nowMs: Date.now(),
    backfill,
  })
  for (const d of fresh) db.tables.dose_events.push({ ...d, id: crypto.randomUUID() })
}

function regenerate(medId?: string, backfill?: { medId: string; skipTimes: string[] }) {
  const cutoff = now()
  db.tables.dose_events = db.tables.dose_events.filter(
    (d) =>
      !(d.user_id === uid() && (!medId || d.medication_id === medId) && d.status === 'pending' && !d.notified_at && (d.scheduled_for as string) > cutoff),
  )
  generateDoses(backfill)
}

function changeStock(medId: unknown, delta: number) {
  const m = db.tables.medications.find((x) => x.id === medId) as unknown as Medication | undefined
  if (m && m.stock !== null) m.stock = Math.max(m.stock + delta, 0)
}

// 0012: client action times are clamped to the last 7 days and never the future.
function clampClientTime(at: unknown): string {
  const t = typeof at === 'string' ? Date.parse(at) : NaN
  const nowMs = Date.now()
  return new Date(Number.isNaN(t) ? nowMs : Math.min(Math.max(t, nowMs - 7 * 86_400_000), nowMs)).toISOString()
}

const appliedOps = new Set<string>()

// Offline switch for exercising offline sync in `dev:mock`: every call fails like a dropped fetch.
// Kept in localStorage so it survives a reload, like real airplane mode.
const OFFLINE_KEY = 'medtracker-mock-offline'
let offline = localStorage.getItem(OFFLINE_KEY) === '1'
const offlineResult = (): Result => ({ data: null, error: new TypeError('Failed to fetch') })
;(window as unknown as { __mockOffline: (on: boolean) => void }).__mockOffline = (on: boolean) => {
  offline = on
  if (on) localStorage.setItem(OFFLINE_KEY, '1')
  else localStorage.removeItem(OFFLINE_KEY)
  window.dispatchEvent(new Event(on ? 'offline' : 'online'))
}

const rpcs: Record<string, (a: Row) => Result> = {
  touch_last_seen: () => ok(null),
  mark_password_set: () => {
    const p = profile()
    if (p) p.password_set = true
    return ok(null)
  },
  generate_doses: () => (generateDoses(), ok(null)),
  regenerate_user_doses: () => (regenerate(), ok(null)),
  claim_push_endpoint: (a) => {
    db.tables.push_subscriptions = db.tables.push_subscriptions.filter((r) => r.endpoint !== a.p_endpoint)
    db.tables.push_subscriptions.push({ id: crypto.randomUUID(), user_id: uid(), endpoint: a.p_endpoint, enabled: true })
    return ok(null)
  },
  save_med: (a) => {
    const input = a.p_med as Row
    let id = input.id as string | undefined
    if (id && a.p_create) {
      const existing = db.tables.medications.find((x) => x.id === id)
      if (existing) return existing.user_id === uid() ? ok(id) : fail('medication id belongs to another user')
    }
    if (id && !a.p_create) {
      const m = db.tables.medications.find((x) => x.id === id && x.user_id === uid())
      if (!m) return fail('medication not found')
      Object.assign(m, input, { updated_at: now() })
    } else {
      id ??= crypto.randomUUID()
      db.tables.medications.push({ ...input, id, user_id: uid(), paused: false, refill_alerted_at: null, created_at: now(), updated_at: now() })
    }
    const skipTimes = (db.tables.schedules.filter((s) => s.medication_id === id) as unknown as Schedule[]).flatMap((s) => s.times.map(hhmmss))
    db.tables.schedules = db.tables.schedules.filter((s) => s.medication_id !== id)
    for (const s of a.p_schedules as Row[]) {
      db.tables.schedules.push({ ...s, times: ((s.times as string[]) ?? []).map(hhmmss), id: crypto.randomUUID(), user_id: uid(), medication_id: id })
    }
    regenerate(id, { medId: id, skipTimes })
    return ok(id)
  },
  add_stock: (a) => {
    const m = db.tables.medications.find((x) => x.id === a.p_med) as unknown as Medication | undefined
    if (!m) return fail('medication not found')
    const qty = a.p_qty as number
    if (!(Number.isFinite(qty) && qty > 0)) return fail('quantity must be greater than 0')
    if (a.p_op) {
      if (appliedOps.has(a.p_op as string)) return ok(m.stock)
      appliedOps.add(a.p_op as string)
    }
    m.stock = (m.stock ?? 0) + qty
    return ok(m.stock)
  },
  set_dose_status: (a) => {
    const d = db.tables.dose_events.find((x) => x.id === a.p_dose) as unknown as DoseEvent | undefined
    if (!d) return ok(null)
    if (d.status === a.p_status) return ok(d)
    const units = (db.tables.medications.find((m) => m.id === d.medication_id)?.units_per_dose as number) ?? 1
    if (a.p_status === 'taken') changeStock(d.medication_id, -units)
    else if (d.status === 'taken') changeStock(d.medication_id, units)
    d.status = a.p_status as DoseEvent['status']
    d.acted_at = d.status === 'pending' ? null : clampClientTime(a.p_acted_at)
    return ok(d)
  },
  set_dose_status_at: (a) => {
    const d = db.tables.dose_events.find(
      (x) => x.user_id === uid() && x.medication_id === a.p_med && Date.parse(x.scheduled_for as string) === Date.parse(a.p_scheduled_for as string),
    )
    return d ? rpcs.set_dose_status({ p_dose: d.id, p_status: a.p_status, p_acted_at: a.p_acted_at }) : ok(null)
  },
  log_prn_dose: (a) => {
    const m = db.tables.medications.find((x) => x.id === a.p_med) as unknown as Medication | undefined
    if (!m) return ok(null)
    const prior = a.p_id ? db.tables.dose_events.find((x) => x.id === a.p_id && x.user_id === uid()) : undefined
    if (prior) return ok({ ...prior })
    const t = clampClientTime(a.p_at)
    const d: DoseEvent = { id: (a.p_id as string) ?? crypto.randomUUID(), user_id: m.user_id, medication_id: m.id, scheduled_for: t, status: 'taken', acted_at: t, notified_at: null, snoozed_until: null }
    db.tables.dose_events.push({ ...d })
    changeStock(m.id, -m.units_per_dose)
    return ok(d)
  },
  set_paused: (a) => {
    const m = db.tables.medications.find((x) => x.id === a.p_med && x.user_id === uid())
    if (!m) return fail('medication not found')
    m.paused = a.p_paused
    regenerate()
    return ok(null)
  },
  update_profile: (a) => {
    const p = profile()
    if (!p) return fail('profile not found')
    const patch = a.p_patch as Row
    const beforeTz = p.time_zone
    for (const k of ['nickname', 'time_zone', 'snooze_minutes', 'suggestions_enabled'] as const) {
      if (k in patch) Object.assign(p, { [k]: patch[k] })
    }
    if (p.time_zone !== beforeTz) regenerate()
    return ok({ ...p })
  },
}

// Just enough of the PostgREST query builder: filters, order, single, update/delete; awaitable.
class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [(r) => r.user_id === uid()]
  private orderBy: string | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private op: { kind: 'select' } | { kind: 'update'; patch: Row } | { kind: 'delete' } = { kind: 'select' }
  private table: keyof Tables
  constructor(table: keyof Tables) {
    this.table = table
  }
  select() {
    return this
  }
  update(patch: Row) {
    this.op = { kind: 'update', patch }
    return this
  }
  delete() {
    this.op = { kind: 'delete' }
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => r[col] === v)
    return this
  }
  gte(col: string, v: string) {
    this.filters.push((r) => (r[col] as string) >= v)
    return this
  }
  lt(col: string, v: string) {
    this.filters.push((r) => (r[col] as string) < v)
    return this
  }
  order(col: string) {
    this.orderBy = col
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }
  private run(): Result {
    if (offline) return offlineResult()
    if (!uid()) return fail('Not signed in')
    const match = (r: Row) => this.filters.every((f) => f(r))
    let rows = db.tables[this.table].filter(match)
    if (this.op.kind === 'delete') {
      const gone = new Set(rows.map((r) => r.id))
      db.tables[this.table] = db.tables[this.table].filter((r) => !match(r))
      if (this.table === 'medications') {
        db.tables.schedules = db.tables.schedules.filter((s) => !gone.has(s.medication_id))
        db.tables.dose_events = db.tables.dose_events.filter((d) => !gone.has(d.medication_id))
      }
    } else if (this.op.kind === 'update') {
      for (const r of rows) Object.assign(r, this.op.patch)
    }
    save()
    if (this.orderBy) {
      const c = this.orderBy
      rows = [...rows].sort((a, b) => String(a[c]).localeCompare(String(b[c])))
    }
    const copy = rows.map((r) => ({ ...r }))
    if (this.mode === 'many') return ok(copy)
    if (copy.length === 0 && this.mode === 'maybe') return ok(null)
    return copy.length === 1 ? ok(copy[0]) : fail('Expected one row')
  }
  then<A = Result, B = never>(onOk?: ((v: Result) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(onOk, onErr)
  }
}

export const supabase = {
  from: (table: keyof Tables) => new Query(table),
  rpc: async (name: string, args: Row = {}): Promise<Result> => {
    if (offline) return offlineResult()
    if (!uid()) return fail('Not signed in')
    const fn = rpcs[name]
    if (!fn) return fail(`mock: rpc ${name} not implemented`)
    const result = fn(args)
    save()
    return result
  },
  functions: {
    invoke: async (name: string): Promise<Result> => {
      if (name !== 'delete-account') return fail(`mock: function ${name} not implemented`)
      db.tables = empty()
      return ok(null)
    },
  },
  auth: {
    getSession: async () => ({ data: { session: db.session }, error: null }),
    onAuthStateChange: (cb: (event: string, session: Session) => void) => {
      listeners.add(cb)
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    },
    signInAnonymously: async () => (startUser({ is_anonymous: true }), { data: {}, error: null }),
    signUp: async ({ email }: { email: string; password: string }) => {
      startUser({ is_anonymous: false, email, email_confirmed_at: now(), user_metadata: { password_set: true } })
      return { data: { session: db.session }, error: null }
    },
    signInWithPassword: async ({ email }: { email: string; password: string }) => {
      startUser({ is_anonymous: false, email, email_confirmed_at: now(), user_metadata: { password_set: true } })
      return { data: { session: db.session }, error: null }
    },
    updateUser: async (patch: { email?: string; password?: string }) => {
      const user = db.session?.user
      if (!user) return { data: {}, error: new Error('Not signed in') }
      if (patch.email) Object.assign(user, { email: patch.email, is_anonymous: false, email_confirmed_at: now() })
      setSession({ user }, 'USER_UPDATED')
      return { data: { user }, error: null }
    },
    signOut: async (opts?: { scope?: string }) => {
      if (opts?.scope !== 'others') setSession(null, 'SIGNED_OUT')
      return { error: null }
    },
  },
}

export async function currentUserId(): Promise<string> {
  const id = uid()
  if (!id) throw new Error('Not signed in')
  return id
}
