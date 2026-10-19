// Dev-only stand-in for ./supabase.ts, swapped in by `npm run dev:mock` (see vite.config.ts).
// Keeps all data in this browser's localStorage, so the UI can be exercised without touching
// the hosted (production) project. Mirrors only the calls the app makes, and only roughly the
// server rules in supabase/migrations.
import { addDays, localDayRange, todayIn } from '../features/today/dayRange'
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
function generateDoses() {
  const p = profile()
  if (!p) return
  const tz = p.time_zone
  const today = todayIn(tz)
  const nowMs = Date.now()
  for (const d of mine('dose_events') as unknown as DoseEvent[]) {
    if (d.status === 'pending' && todayIn(tz, Date.parse(d.scheduled_for)) < today) d.status = 'missed'
  }
  const meds = mine('medications') as unknown as Medication[]
  const scheds = mine('schedules') as unknown as Schedule[]
  for (const day of [today, addDays(today, 1)]) {
    const midnight = Date.parse(localDayRange(day, tz).from)
    const isoDow = ((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
    for (const s of scheds) {
      const m = meds.find((x) => x.id === s.medication_id)
      if (!m || m.paused || s.kind === 'prn') continue
      if ((s.start_date && day < s.start_date) || (s.end_date && day > s.end_date)) continue
      if (s.kind === 'weekdays' && !s.weekdays?.includes(isoDow)) continue
      if (s.kind === 'interval') {
        if (!s.start_date || !s.interval_days) continue
        const gap = (Date.parse(day) - Date.parse(s.start_date)) / 86_400_000
        if (gap % s.interval_days !== 0) continue
      }
      for (const t of s.times) {
        const [h, mi] = t.split(':').map(Number)
        const at = midnight + h * 3_600_000 + mi * 60_000
        const scheduled_for = new Date(at).toISOString()
        if (at <= nowMs) continue
        if (db.tables.dose_events.some((d) => d.medication_id === m.id && d.scheduled_for === scheduled_for)) continue
        db.tables.dose_events.push({
          id: crypto.randomUUID(),
          user_id: m.user_id,
          medication_id: m.id,
          scheduled_for,
          status: 'pending',
          acted_at: null,
          notified_at: null,
          snoozed_until: null,
        } satisfies DoseEvent)
      }
    }
  }
}

function regenerate(medId?: string) {
  const cutoff = now()
  db.tables.dose_events = db.tables.dose_events.filter(
    (d) =>
      !(d.user_id === uid() && (!medId || d.medication_id === medId) && d.status === 'pending' && !d.notified_at && (d.scheduled_for as string) > cutoff),
  )
  generateDoses()
}

function changeStock(medId: unknown, delta: number) {
  const m = db.tables.medications.find((x) => x.id === medId) as unknown as Medication | undefined
  if (m && m.stock !== null) m.stock = Math.max(m.stock + delta, 0)
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
    if (id) {
      const m = db.tables.medications.find((x) => x.id === id && x.user_id === uid())
      if (!m) return fail('medication not found')
      Object.assign(m, input, { updated_at: now() })
    } else {
      id = crypto.randomUUID()
      db.tables.medications.push({ ...input, id, user_id: uid(), paused: false, refill_alerted_at: null, created_at: now(), updated_at: now() })
    }
    db.tables.schedules = db.tables.schedules.filter((s) => s.medication_id !== id)
    for (const s of a.p_schedules as Row[]) {
      db.tables.schedules.push({ ...s, times: ((s.times as string[]) ?? []).map(hhmmss), id: crypto.randomUUID(), user_id: uid(), medication_id: id })
    }
    regenerate(id)
    return ok(id)
  },
  add_stock: (a) => {
    const m = db.tables.medications.find((x) => x.id === a.p_med) as unknown as Medication | undefined
    if (!m) return fail('medication not found')
    const qty = a.p_qty as number
    if (!(Number.isFinite(qty) && qty > 0)) return fail('quantity must be greater than 0')
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
    d.acted_at = d.status === 'pending' ? null : now()
    return ok(d)
  },
  log_prn_dose: (a) => {
    const m = db.tables.medications.find((x) => x.id === a.p_med) as unknown as Medication | undefined
    if (!m) return ok(null)
    const d: DoseEvent = { id: crypto.randomUUID(), user_id: m.user_id, medication_id: m.id, scheduled_for: now(), status: 'taken', acted_at: now(), notified_at: null, snoozed_until: null }
    db.tables.dose_events.push({ ...d })
    changeStock(m.id, -m.units_per_dose)
    return ok(d)
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
