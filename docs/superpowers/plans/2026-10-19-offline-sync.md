# Offline Mode with Later Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen and action keeps working offline; queued changes sync to Supabase automatically, exactly once, when the connection returns.

**Architecture:** All offline logic lives under `src/data/` so screens keep calling the same functions with the same signatures. Reads are network-first with an IndexedDB cache fallback. Writes become typed *ops*: each op is stored in a per-user outbox, applied optimistically to the cache, then flushed in order to one idempotent Supabase RPC. One new migration makes every queued RPC replay-safe and time-stamped by the client.

**Tech Stack:** React 19, TypeScript 7, Vite 8 PWA (injectManifest), supabase-js 2.118, Vitest 4 + jsdom, IndexedDB (hand-rolled wrapper), `fake-indexeddb` (dev only).

**Spec:** `docs/superpowers/specs/2026-10-19-offline-sync-design.md`

## Global Constraints

- Supabase project is production. Never run integration/e2e tests or apply migrations from this plan; `tests/guard.ts` must stay in force. Applying `0012` is the owner's step after review.
- No new runtime dependency. `fake-indexeddb` as a devDependency only.
- Existing `src/data/*` exported signatures stay unchanged (screens are being edited on other branches). Only additive exports.
- Changes ship as a new migration `supabase/migrations/0012_offline_sync.sql`. No edits to 0001–0011.
- `src/lib/supabase.mock.ts` mirrors every new/changed RPC (dev:mock is the only safe place to run the app end-to-end).
- Client timestamps are clamped server-side to `[now() - interval '7 days', now()]`.
- UI copy (singular when N = 1: `1 change waiting`, `1 change couldn't sync`, `1 change hasn't synced and will be lost`): offline `Offline — N changes waiting`; syncing `Syncing…`; auth `Sign in again to sync`; failure `N changes couldn't sync`; sign-out warning `N changes haven't synced and will be lost. Sign out anyway?`. AA contrast via existing `theme.css` tokens.
- Commit with explicit paths (the worktree's `node_modules` is a symlink). Don't push until the owner asks (Actions minutes are limited).

## Review Focus

1. **Lost response then retry** (request reached the server, reply didn't): replaying any op must not change stock, doses, or meds a second time. Test: Task 1 integration replays + Task 5 `flush retries an op whose response was lost without double effect`.
2. **Dose regenerated while offline** (another device edited the schedule, so the dose's id changed): a queued Taken must still land by (med, scheduled_for), or show as failed if that time is gone. Test: Task 1 `set_dose_status_at returns null when no dose at that time` + Task 5 `null result is a permanent failure`.
3. **Two tabs open on the same device:** both must not flush the same outbox at once. Test: Task 5 `concurrent flush calls run the queue once` (in-tab lock); cross-tab uses `navigator.locks.request('medtracker-sync')` when available.
4. **Sign-out or account switch with a non-empty outbox:** never clear silently. Test: Task 7 `sign-out with pending changes asks before clearing`.
5. **Reload while offline:** cached data and pending count must survive a reload (IndexedDB, not memory). Test: Task 3 `store persists across reopen` + Task 6 `listDoses falls back to cache after a network error`.

---

### Task 1: Migration 0012: replay-safe, client-timed RPCs

**Files:**
- Create: `supabase/migrations/0012_offline_sync.sql`
- Create: `tests/integration/offline.test.ts` (guarded; written, not run)
- Modify: `src/lib/supabase.mock.ts` (mirror RPCs; offline switch)

**Interfaces:**
- Produces (SQL, all `security invoker`, `set search_path = ''`, revoke from `public, anon`, grant to `authenticated`):
  - `save_med(p_med jsonb, p_schedules jsonb, p_create boolean default false) returns uuid`: drop the 2-arg version and recreate it. If `p_create` and `p_med->>'id'` is set, insert with that id; if the id already exists for `auth.uid()`, return it unchanged (replay); if it exists for another user, raise `42501`. If `p_create` is false, the behavior is exactly as in 0011.
  - `set_dose_status(p_dose uuid, p_status text, p_acted_at timestamptz default null)`: drop and recreate; `acted_at = clamp(coalesce(p_acted_at, now()))` instead of `now()`; otherwise identical to 0003.
  - `set_dose_status_at(p_med uuid, p_scheduled_for timestamptz, p_status text, p_acted_at timestamptz default null) returns public.dose_events`: finds the caller's dose by `(medication_id, scheduled_for)` and delegates to `set_dose_status`; `null` if none.
  - `log_prn_dose(p_med uuid, p_id uuid default null, p_at timestamptz default null)`: if `p_id` row exists → return it, no stock change; else insert with `id = coalesce(p_id, gen_random_uuid())`, `scheduled_for = acted_at = clamp(coalesce(p_at, now()))`.
  - `add_stock(p_med uuid, p_qty numeric, p_op uuid default null)`: with `p_op`, first `insert into public.applied_ops(op_id, user_id) values (p_op, auth.uid()) on conflict do nothing`; if nothing was inserted, return current stock unchanged.
  - Table `public.applied_ops(op_id uuid primary key, user_id uuid not null references auth.users on delete cascade, created_at timestamptz not null default now())`, RLS on, policy: own rows insert/select.
  - `set_paused(p_med uuid, p_paused boolean) returns void`: update own med, then `regenerate_user_doses()`.
  - `update_profile(p_patch jsonb) returns public.profiles`: updates only `nickname, time_zone, snooze_minutes, suggestions_enabled` keys present; if `time_zone` changed, `regenerate_user_doses()`. Must still pass the 0008 profile guard.
- Mock: same RPC names/args; `window.__mockOffline(on: boolean)` (mock mode only) makes every `rpc`/`from` call resolve `{ data: null, error: new TypeError('Failed to fetch') }` while on, and dispatches `offline`/`online` on `window`.

- [ ] **Step 1: Write integration tests** in `tests/integration/offline.test.ts`, using `tests/integration/helpers.ts` like `meds.test.ts`: `save_med create replay returns same id and one row`, `save_med create with another user's id raises 42501`, `save_med edit of deleted med raises P0002`, `set_dose_status_at taken twice decrements stock once`, `set_dose_status_at returns null when no dose at that time`, `acted_at is clamped to now for a future client time`, `log_prn_dose replay with same p_id adds one row and decrements once`, `add_stock replay with same p_op adds once`, `update_profile time zone change regenerates future doses`.
- [ ] **Step 2: Write `0012_offline_sync.sql`.** Re-apply grants for every dropped/recreated function. Header comment states why (offline replay safety, MT-? per issue convention once filed).
- [ ] **Step 3: Static check.** No local Postgres is available (no Supabase CLI/Docker). Run: `npx tsc --noEmit -p .` and `npm run lint`. Expected: clean. Record in the task report that the SQL and integration tests are unexecuted.
- [ ] **Step 4: Mirror in the mock** and add the offline switch. Unit-test the mock in `src/lib/supabase.mock.test.ts`: `log_prn_dose replay is a no-op`, `add_stock replay with same p_op adds once`, `offline switch returns a fetch TypeError`.
- [ ] **Step 5: Run** `npm test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: replay-safe client-timed RPCs for offline sync (migration 0012)`.

### Task 2: Shared local dose generator

**Files:**
- Create: `src/data/offline/generate.ts`, `src/data/offline/generate.test.ts`
- Modify: `src/lib/supabase.mock.ts` (use it instead of its private `generateDoses` loop)

**Interfaces:**
- Produces: `generateLocalDoses(input: { meds: Medication[]; schedules: Schedule[]; existing: Pick<DoseEvent,'medication_id'|'scheduled_for'>[]; timeZone: string; nowMs: number; backfill?: { medId: string; skipTimes: string[] } }): DoseEvent[]`. This returns only new rows: `status 'pending'`, `id = 'local:' + medication_id + ':' + scheduled_for`, `notified_at` set when due ≤ now, and `user_id` from the med.

- [ ] **Step 1: Failing tests** (fix `nowMs`, tz `America/Toronto`): `daily future times today and tomorrow only`, `weekdays respects ISO weekday`, `interval counts from start_date`, `paused and prn produce nothing`, `start/end dates bound days`, `backfill adds passed times today except skipTimes`, `existing (med, time) is not duplicated`, `DST day uses local wall time` (2026-11-01).
- [ ] **Step 2: Run** `npx vitest run src/data/offline/generate.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** by moving the mock's loop (`supabase.mock.ts` `generateDoses`) into the pure function; the mock calls it and pushes results with `crypto.randomUUID()` ids.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (existing mock-based tests unchanged).
- [ ] **Step 5: Commit** `refactor: share dose generation between mock and offline cache`.

### Task 3: IndexedDB store

**Files:**
- Create: `src/data/offline/store.ts`, `src/data/offline/store.test.ts`
- Modify: `package.json` (devDependency `fake-indexeddb`), `src/test-setup.ts` (`import 'fake-indexeddb/auto'`)

**Interfaces:**
- Produces:
  - `type Cache = { meds: Medication[]; schedules: Schedule[]; doses: DoseEvent[]; profile: Profile | null }`
  - `type OutboxItem = { seq: number; op: Op; state: 'pending' | 'failed'; error?: string; tries: number }` (`Op` from Task 4; import type only)
  - `openStore(userId: string): Promise<Store>`; DB name `medtracker-offline-${userId}`, version 1, object stores `cache` (single key `'snapshot'`) and `outbox` (keyPath `seq`, autoIncrement).
  - `interface Store { readCache(): Promise<Cache>; writeCache(c: Cache): Promise<void>; enqueue(op: Op): Promise<number>; list(): Promise<OutboxItem[]>; update(item: OutboxItem): Promise<void>; remove(seq: number): Promise<void>; clear(): Promise<void>; close(): void }`
  - `deleteStore(userId: string): Promise<void>`
- An empty cache is `{ meds: [], schedules: [], doses: [], profile: null }`.

- [ ] **Step 1: Failing tests:** `store persists across reopen`, `outbox lists in seq order`, `stores are isolated per user id`, `clear empties cache and outbox`, `deleteStore removes the database`.
- [ ] **Step 2: Run** `npx vitest run src/data/offline/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with a small `req<T>(r: IDBRequest<T>): Promise<T>` helper. No library.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: per-user IndexedDB store for offline cache and outbox`.

### Task 4: Ops: types, optimistic effects, RPC mapping

**Files:**
- Create: `src/data/offline/ops.ts`, `src/data/offline/ops.test.ts`

**Interfaces:**
- Consumes: `generateLocalDoses` (Task 2), `Cache` (Task 3).
- Produces:
  ```ts
  type Op = { opId: string; at: string } & (
    | { kind: 'doseStatus'; medId: string; scheduledFor: string; status: 'taken' | 'skipped' | 'pending' }
    | { kind: 'prn'; medId: string; doseId: string }
    | { kind: 'saveMed'; create: boolean; med: MedInput & { id: string }; schedules: ScheduleInput[] }
    | { kind: 'deleteMed'; medId: string }
    | { kind: 'setPaused'; medId: string; paused: boolean }
    | { kind: 'addStock'; medId: string; qty: number }
    | { kind: 'updateProfile'; patch: ProfilePatch })
  applyLocal(cache: Cache, op: Op, nowMs: number): Cache          // pure, returns a new Cache
  toRpc(op: Op): { name: string; args: Record<string, unknown> } | { table: 'medications'; deleteId: string }
  ```
  `at` = ISO time the user acted; `opId` = `crypto.randomUUID()`.
- `applyLocal` rules (mirror the SQL): `doseStatus` sets status/acted_at; →taken subtracts `units_per_dose` (floor 0, skip if stock null), taken→other adds it back; same→same no change. `prn` adds a taken dose with `id = doseId`, decrements stock. `saveMed` upserts med (keeps cached stock when `med` has no `stock` key), replaces its schedules, drops its future pending un-notified doses, then appends `generateLocalDoses` with `backfill` (skipTimes = the med's previous times). `deleteMed` removes med, its schedules and doses. `setPaused` sets flag, drops future pending doses of that med, regenerates if resumed. `addStock` = `coalesce(stock,0)+qty`. `updateProfile` merges the patch.
- `toRpc`: `doseStatus → set_dose_status_at {p_med, p_scheduled_for, p_status, p_acted_at: at}`; `prn → log_prn_dose {p_med, p_id: doseId, p_at: at}`; `saveMed → save_med {p_med, p_schedules, p_create}`; `addStock → add_stock {p_med, p_qty, p_op: opId}`; `setPaused → set_paused`; `updateProfile → update_profile {p_patch}`; `deleteMed → table delete`.

- [ ] **Step 1: Failing tests:** one per rule above, including `taken twice decrements stock once`, `untaking restores stock`, `untracked stock stays null`, `saveMed edit without stock key keeps cached stock`, `new daily med adds provisional doses for today and tomorrow`, and `toRpc maps every kind` (table-driven, exact names and args as above).
- [ ] **Step 2: Run** `npx vitest run src/data/offline/ops.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: offline ops with optimistic cache effects`.

### Task 5: Sync engine

**Files:**
- Create: `src/data/offline/sync.ts`, `src/data/offline/sync.test.ts`

**Interfaces:**
- Consumes: `openStore`, `Store`, `Op`, `applyLocal`, `toRpc`, `supabase`, `currentUserId`.
- Produces:
  ```ts
  type SyncStatus = { online: boolean; syncing: boolean; pending: number; failed: OutboxItem[]; needsSignIn: boolean }
  submit<T>(op: Op, localResult: (c: Cache) => T): Promise<T>   // enqueue + applyLocal + await flush; returns server result mapped by caller, or localResult if still queued; throws on permanent failure of this op
  flush(): Promise<void>                // ordered, one at a time, single-flight
  readThrough<T>(fetch: () => Promise<T>, fromCache: (c: Cache) => T, intoCache: (c: Cache, v: T) => Cache): Promise<T>
  subscribe(fn: (s: SyncStatus) => void): () => void
  dismissFailed(seq: number): Promise<void>
  pendingCount(): Promise<number>
  resetForSignOut(): Promise<void>      // close + deleteStore for current user
  startSyncTriggers(): () => void       // 'online', visibilitychange→visible, and an immediate flush
  ```
- Error classes (`classify(e): 'network' | 'auth' | 'permanent'`): `network` = `TypeError`, message matches `/fetch|network/i`, or `navigator.onLine === false`; `auth` = status 401 / code `PGRST301` / refresh failure; everything else (4xx, P0002, 42501, 22023, 23xxx checks) = `permanent`. A `null` result from `set_dose_status_at` is `permanent` with error `STALE_DOSE`.
- `network` → stop flushing, keep item `pending`. `auth` → stop, `needsSignIn = true`, keep. `permanent` → mark `failed`, continue with the next item. After a flush that sent ≥1 op, refetch meds, schedules, profile and the cached dose window, then `writeCache`.
- `readThrough`: flush first; if outbox still has pending items or `fetch` throws `network`, return `fromCache(cache)`; else write through and return fresh.
- Single-flight: concurrent `flush()` calls share one promise; wrap the run in `navigator.locks.request('medtracker-sync', …)` when defined.

- [ ] **Step 1: Failing tests** (mock `../../lib/supabase` like `meds.test.ts`; fake-indexeddb): `submit online returns server result and empties outbox`, `submit offline returns local result and keeps op pending`, `flush sends ops in order`, `network error stops flush and keeps order`, `permanent error marks failed and continues`, `null result is a permanent failure`, `401 sets needsSignIn and keeps op`, `flush retries an op whose response was lost without double effect` (first call resolves server-side then rejects network; assert same `toRpc` args incl. opId on retry), `concurrent flush calls run the queue once`, `readThrough serves cache while ops are pending`, `subscribe reports pending count changes`.
- [ ] **Step 2: Run** `npx vitest run src/data/offline/sync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat: offline outbox sync engine`.

### Task 6: Route the data layer through the cache and outbox

**Files:**
- Modify: `src/data/doses.ts`, `src/data/meds.ts`, `src/data/profile.ts`, `src/data/boot.ts`, `src/main.tsx` (call `startSyncTriggers()` once)
- Modify tests: `src/data/meds.test.ts`, `src/data/profile.test.ts`, `src/data/getProfile.test.ts`; Create: `src/data/doses.test.ts`

**Interfaces:**
- Consumes: Task 5 API.
- Signatures unchanged. Behavior:
  - `listMeds/listSchedules/listDoses(from,to)/getProfile` → `readThrough`. `listDoses` from cache filters `scheduled_for ∈ [from,to)`; on fresh fetch it replaces cached doses in that range only.
  - `setDoseStatus(id, status)` → finds dose in cache by id → `submit({kind:'doseStatus', medId, scheduledFor, ...})`; returns the updated `DoseEvent` (server row when synced, cache row otherwise); `null` → callers' existing `STALE_DOSE` path. Not in cache → current direct RPC.
  - `logPrnDose(medId)` → `prn` op with `doseId = crypto.randomUUID()`.
  - `saveMed(med, schedules)` → `create = !med.id`; assigns `crypto.randomUUID()` when creating; returns the id.
  - `deleteMed`, `setPaused`, `addStock` (validation stays client-side first), `stopMed` (unchanged, via `saveMed`), `updateProfile` → ops. `addStock` returns new stock.
  - `bootSession`: `generateDoses`/`touchLastSeen`/`detectTimeZone` stay direct and best-effort (already swallow errors offline).

- [ ] **Step 1: Update/extend tests:** existing assertions move from "rpc called with X" to "submit called with op X" where the call is now an op; add `listDoses falls back to cache after a network error`, `setDoseStatus on a provisional dose queues by med and time`, `saveMed create assigns a client id and create=true`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL on changed expectations.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run lint && npm run build`. Expected: all PASS; screen tests (`Today.test.tsx`, `History.test.tsx`, `MedCard.test.tsx`, `Settings.test.tsx`) pass untouched.
- [ ] **Step 5: Commit** `feat: data layer works offline via cache and outbox`.

### Task 7: Sync indicator and sign-out guard

**Files:**
- Create: `src/components/SyncStatus.tsx`, `src/components/SyncStatus.test.tsx`, `src/data/offline/useSyncStatus.ts`
- Modify: `src/App.tsx` (render `<SyncStatus />` inside `.app-header`), `src/features/auth/auth.ts` (`signOut`), `src/features/settings/Settings.tsx` (`doSignOut`), `src/theme.css` (styles with existing tokens)
- Modify: sign-in path used while a guest session is active (`src/features/auth/CredentialsForm.tsx` / `Welcome.tsx`, wherever `signIn` is called): same guard as sign-out, since the user id changes.

**Interfaces:**
- Consumes: `subscribe`, `dismissFailed`, `pendingCount`, `flush`, `resetForSignOut`.
- Produces: `useSyncStatus(): SyncStatus`; `signOut()` now flushes (time-boxed 5 s), then `resetForSignOut()`, then the existing logic; new `export async function unsyncedBeforeSignOut(): Promise<number>` in `auth.ts`.
- Indicator: hidden when online and nothing is pending/failed. A `role="status"` text uses the Global Constraints copy. The failed state opens a list of failed items (op kind + med name + error) with a Dismiss button for each.
- Settings: before `signOut()`, if `await unsyncedBeforeSignOut() > 0`, `window.confirm(copy)`; cancel → abort. Delete-account path skips the guard (data is being deleted anyway).

- [ ] **Step 1: Failing tests:** `hidden when online and empty`, `shows offline with pending count`, `shows sign in again when needsSignIn`, `failed items can be dismissed`, `sign-out with pending changes asks before clearing` (Settings test; confirm=false → `signOut` not called), `sign-out with no pending changes does not ask`.
- [ ] **Step 2: Run** `npx vitest run src/components/SyncStatus.test.tsx src/features/settings/Settings.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run lint && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sync status indicator and unsynced sign-out guard`.

### Task 8: End-to-end check in mock mode

**Files:** none (verification only; fix in the owning task's files if it fails)

- [ ] **Step 1:** Start `dev:mock` for this worktree via `preview_start` (launch config `npm --prefix .claude/worktrees/offline run dev:mock`). Continue as guest, add a daily med with stock 10 and a time later today.
- [ ] **Step 2:** `window.__mockOffline(true)`. On Today, mark the dose Taken; on Meds, add a second med. Expected: both visible at once; header shows `Offline — 2 changes waiting`; Meds shows stock 9.
- [ ] **Step 3:** Reload the page while still offline. Expected: same data and count (IndexedDB).
- [ ] **Step 4:** `window.__mockOffline(false)`. Expected: indicator clears; after reload the mock store (`localStorage['medtracker-mock']`) has the dose taken once, stock 9, and both meds with the client-assigned ids.
- [ ] **Step 5:** Offline again, mark a dose Taken, then Settings → Sign out. Expected: confirm dialog with `1 changes haven't synced…` copy (fix plural to `1 change hasn't` if it reads wrong).
- [ ] **Step 6:** Screenshot as proof; `preview_stop`. Report: unexecuted SQL/integration tests, and the owner's remaining steps: apply `0012` to the Supabase project, then do an installed-PWA airplane-mode check on the phone.
