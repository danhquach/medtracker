# MedTracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An ad-free, installable medication tracker (med list, push reminders, dose log, refill alerts, guest mode, Canada-first name autocomplete) that syncs across devices.

**Architecture:**
- **Frontend:** a Vite + React PWA with a custom service worker for push and notification actions.
- **Backend:** Supabase.
  - Postgres with RLS holds all state.
  - SQL functions own dose generation, missed rollover, status changes, and atomic claiming of due doses.
  - `pg_cron` drives them.
  - Three Deno Edge Functions do what SQL can't: send Web Push, verify notification-action tokens, and delete accounts.
- **Shared code:** refill math lives once in `supabase/functions/_shared/`, imported by both the edge functions and the frontend.

**Tech Stack:**
- **Frontend:** Node 25, Vite 6, React 18, TypeScript 5, react-router-dom 6, vite-plugin-pwa (injectManifest), @supabase/supabase-js 2
- **Tests:** Vitest 3, Playwright 1.4x
- **Backend:** Supabase CLI (via `npx supabase`), Postgres 15 + pg_cron + pg_net, Deno edge runtime, `npm:web-push@3.6.7`

**Spec:** `docs/superpowers/specs/2026-10-19-medtracker-design.md`

## Prerequisites (owner action, before Task 2)

- **Docker:** Docker Desktop or OrbStack must be running. It's needed by `npx supabase start` for the local stack that the integration tests and E2E use.
  - Checked 2026-10-19: Docker is **not installed** on this Mac, and the Supabase CLI is missing too (`npx supabase` covers the CLI).
  - If the owner declines Docker, point `.env.test` at a separate hosted Supabase project named `medtracker-test` instead. All integration tests read their URL and keys from env, so nothing else changes.
- **Accounts:** the Supabase and Vercel accounts are only needed for Task 12 (deploy).

## Global Constraints

- No ads, trackers or analytics SDKs; no dependency that phones home.
- RLS on every table: `user_id = auth.uid()` for select/insert/update/delete. The frontend never holds the service-role key.
- Server secrets live only in Supabase function secrets or Vault, never in the repo or the frontend:
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` address)
  - `CRON_SECRET`
  - `ACTION_TOKEN_KEY`
- Locally these go in gitignored `supabase/functions/.env`, mirrored into `.env.test` for the integration tests that need them, e.g. `ACTION_TOKEN_KEY`. `.env.example` and `supabase/functions/.env.example` list every variable.
- `.env*` other than `*.env.example` is gitignored.
- Free tier only (Supabase free, Vercel free).
- Times are wall-clock in `profiles.time_zone`, not the browser's zone.
- Defaults:
  - snooze 10 min (options 5/10/15/30/60)
  - `refill_threshold_days` 7
  - `units_per_dose` 1
  - `notify` on
  - suggestions on
- Guest banner reappears 7 days after dismissal. Anonymous users whose `profiles.last_seen_at` is older than 90 days are deleted monthly. Inactivity is measured by `last_seen_at`, not `last_sign_in_at`, because token refresh doesn't update `last_sign_in_at` and active guests would otherwise be purged.
- Autocomplete:
  - starts at 3 chars, 300 ms debounce
  - groups in order: Your meds → Canada → United States, ≤5 per group
  - sends only the typed letters
- Dark theme, warm red accent. Tabs: Today, Meds, History, plus Settings.

## Review Focus

1. **Laptop in a different time zone from the profile:** Today groups doses by the profile time zone, not the browser's. Test in Task 7.
2. **Taken pressed twice** (notification and app, or a double tap): stock decrements once. Test in Task 3.
3. **Overlapping cron runs:** each due dose is pushed once. Test in Task 4.
4. **Schedule edited after doses were taken:** history rows are preserved and only future, un-notified pending rows change. Test in Task 3.
5. **Autocomplete responses arriving out of order** ("ibu" resolves after "ibup"): the list shows results for the latest query only. Test in Task 6.

---

## File Structure

```
.env.example                      # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_VAPID_PUBLIC_KEY
package.json, vite.config.ts, tsconfig.json, index.html, playwright.config.ts, vitest.config.ts
README.md                         # setup, deploy, Android install tips, known risks
supabase/
  config.toml                     # anon sign-in on; local email confirmations off; verify_jwt=false for send-reminders, dose-action
  migrations/
    0001_schema.sql               # tables + FKs (cascade from auth.users) + indexes
    0002_rls.sql                  # RLS policies, all five tables
    0003_doses.sql                # generate_doses(_for), regenerate_future_doses, regenerate_user_doses, mark_missed, set_dose_status, log_prn_dose
    0004_reminders.sql            # claim_due_doses, snooze_dose
    0005_cron.sql                 # pg_cron jobs, pg_net call to send-reminders, purge_stale_guests
  functions/
    _shared/refill.ts             # avgDosesPerDay, daysLeft, refillState (pure; used by FE too)
    _shared/actionToken.ts        # signActionToken, verifyActionToken (HMAC-SHA256, WebCrypto)
    _shared/push.ts               # sendPush (web-push wrapper, prunes 404/410)
    send-reminders/index.ts
    dose-action/index.ts
    delete-account/index.ts
src/
  main.tsx, App.tsx, theme.css
  lib/supabase.ts                 # createClient singleton
  lib/types.ts                    # Medication, Schedule, DoseEvent, Profile, PushSub
  data/meds.ts, data/doses.ts, data/profile.ts   # typed query helpers
  features/auth/{auth.ts, Welcome.tsx, GuestBanner.tsx, guestBanner.ts}
  features/today/{Today.tsx, WeekStrip.tsx, DoseRow.tsx, dayRange.ts}
  features/meds/{MedsList.tsx, MedCard.tsx, MedForm.tsx, ScheduleEditor.tsx, NameAutocomplete.tsx}
  features/autocomplete/{sources.ts, useSuggestions.ts}
  features/history/History.tsx
  features/settings/Settings.tsx
  push/{subscribe.ts, closeStale.ts}
  sw.ts                           # service worker: precache, push, notificationclick
tests/
  integration/{helpers.ts, rls.test.ts, doses.test.ts, reminders.test.ts, actions.test.ts}
  e2e/{guest.spec.ts, smoke.spec.ts}
```

Unit tests sit next to their source as `*.test.ts`.

---

### Task 1: Project skeleton

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/main.tsx`, `src/App.tsx`, `src/theme.css`, `src/App.test.tsx`

**Interfaces:**
- Produces:
  - `npm run dev`, `npm test` (Vitest unit; excludes `tests/`), `npm run test:int` (Vitest on `tests/integration`), `npm run test:e2e` (Playwright)
  - `App` renders tab routes `/today`, `/meds`, `/history`, `/settings`; `/` redirects to `/today`

- [ ] **Step 1:** (Repo already initialized with `.gitignore` and docs.) Scaffold with `npm create vite@latest . -- --template react-ts`, then add `react-router-dom`, `@supabase/supabase-js`, `vite-plugin-pwa`, `vitest`, `@testing-library/react`, `jsdom`, `@playwright/test`.
- [ ] **Step 2: Write the failing test** in `src/App.test.tsx`:
  - `renders bottom tabs`: assert links named "Today", "Meds", "History" exist.
  - `redirects / to /today`: render at `/` and assert the Today heading.
- [ ] **Step 3:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3b:** Scope configs so Deno files never reach `tsc` or Vitest:
  - `tsconfig.json`: `include: ["src", "supabase/functions/_shared/refill.ts", "supabase/functions/_shared/actionToken.ts"]`
  - `vitest.config.ts` unit project: `include: ["src/**/*.test.{ts,tsx}", "supabase/functions/_shared/{refill,actionToken}.test.ts"]`
  - Rule: `refill.ts` and `actionToken.ts` import nothing; no `npm:`, `jsr:` or `Deno` usage.
- [ ] **Step 4:** Implement `App` with a bottom tab bar and placeholder pages. In `theme.css`, put the dark tokens on `:root`: background `#161616`, surface `#2a2a2a`, accent `#e2574c`, accent-muted `#4e2a22`.
- [ ] **Step 5:** Run `npm test`. Expected: PASS.
- [ ] **Step 6:** Commit with `chore: scaffold vite react pwa`.

### Task 2: Schema + RLS

**Files:**
- Create: `supabase/config.toml` (via `npx supabase init`), `supabase/migrations/0001_schema.sql`, `0002_rls.sql`, `tests/integration/helpers.ts`, `tests/integration/rls.test.ts`

**Interfaces:**
- Produces the tables, exactly as in spec §8, plus:
  - `profiles.suggestions_enabled bool default true`
  - `profiles.snooze_minutes int default 10 check in (5,10,15,30,60)`
  - `medications.form text check in ('tablet','capsule','liquid','other')`
  - `schedules.kind text check in ('daily','weekdays','interval','prn')`
  - `dose_events.status text check in ('pending','taken','skipped','missed') default 'pending'`
  - unique `(medication_id, scheduled_for)`
  - every `user_id` is `references auth.users on delete cascade`
  - `schedules.medication_id` and `dose_events.medication_id` are `references medications on delete cascade`
  - `profiles.last_seen_at timestamptz default now()`, `profiles.password_set bool default false`
- Produces `profiles` auto-created by trigger on `auth.users` insert, with `time_zone` default `'America/Toronto'` (the client overwrites it with the detected zone on first load).
- `helpers.ts` produces:
  - `admin()`: a service-role client from `.env.test`
  - `newUser(): Promise<{ client: SupabaseClient; id: string }>`: `admin.auth.admin.createUser` with a random email and password, then a password sign-in on a fresh client. This avoids the 30/h/IP anonymous sign-in limit when pointed at a hosted test project.
  - `newGuest()`: an anonymous sign-in, used only by tests that need `is_anonymous`

- [ ] **Step 1:** In `config.toml`, set `[auth] enable_anonymous_sign_ins = true` and `[auth.email] enable_confirmations = false` (local only; prod is set in the dashboard).
- [ ] **Step 2: Write the failing test** `rls.test.ts`. For each of the five tables, user A inserts a row, then user B:
  - selects → 0 rows
  - updates by id → 0 rows affected
  - deletes by id → 0 rows affected
  - inserts with `user_id = A` → error
- [ ] **Step 3:** Run `npx supabase start && npm run test:int -- rls`. Expected: FAIL (tables missing).
- [ ] **Step 4:** Write the migrations. Enable RLS on all tables with one `for all using (user_id = auth.uid()) with check (user_id = auth.uid())` policy each.
- [ ] **Step 5:** Run `npx supabase db reset && npm run test:int -- rls`. Expected: PASS.
- [ ] **Step 6:** Commit with `feat(db): schema and row level security`.

### Task 3: Dose generation, missed rollover, status changes

**Files:**
- Create: `supabase/migrations/0003_doses.sql`, `tests/integration/doses.test.ts`

**Interfaces:**
- Produces:
  - `generate_doses(p_user uuid default null) returns int`:
    - inserts pending rows for today and tomorrow in each user's `time_zone`, `on conflict do nothing`
    - null means all users
    - skips paused meds and `prn`, and respects `start_date`/`end_date`
    - interval: a day d qualifies when `(d - start_date) % interval_days = 0`
    - wall-clock to `timestamptz` via `(d + t) at time zone tz`
  - `regenerate_future_doses(p_med uuid) returns void`: deletes rows with `status='pending' and notified_at is null and scheduled_for > now()` for that med, then calls `generate_doses(owner)`. Security invoker.
  - `regenerate_user_doses() returns void`: same deletion rule across all meds of `auth.uid()`, then `generate_doses(auth.uid())`. Security invoker. Called after pause/resume and after a `time_zone` change.
  - Weekdays use ISO numbering: `extract(isodow from d)`, Mon=1 … Sun=7. The frontend uses the same.
  - `mark_missed() returns int`: pending rows whose local date (in the profile's time zone) is before the local today become `missed`.
  - `set_dose_status(p_dose uuid, p_status text) returns dose_events`. Security invoker, so RLS applies.
    - Transitions: any → `taken` / `skipped` / `pending`.
    - Into `taken` from non-taken: `stock = greatest(stock - units_per_dose, 0)` when stock is not null.
    - Out of `taken`: `stock += units_per_dose` when stock is not null.
    - `taken` → `taken` is a no-op.
    - Sets `acted_at`. Done in one transaction with `select … for update` on the dose.
  - `log_prn_dose(p_med uuid) returns dose_events`: inserts a taken row at `now()` and decrements stock.

- [ ] **Step 1: Write the failing tests** in `doses.test.ts`. Seed via an anonymous user client, call the RPCs, assert with SQL reads.
  - `daily 08:00 and 20:00 → 4 rows for today+tomorrow`
  - `weekdays [1,3] only on Mon/Wed`
  - `interval 3 from start_date`
  - `end_date excludes later days`
  - `paused med → 0 rows`, `prn → 0 rows`
  - `idempotent: second call inserts 0`
  - `DST: America/Toronto 2026-11-01 08:00 → 13:00Z (EST), 2026-10-31 08:00 → 12:00Z (EDT)`. Use a fixed `now` by passing the date range through an internal helper `generate_doses_for(p_user, p_from date, p_to date)`, which `generate_doses` wraps.
  - `taken decrements stock by units_per_dose`, `taken twice decrements once` (Review Focus 2), `un-taking restores`, `stock clamps at 0`, `stock null stays null`
  - `regenerate keeps taken and notified rows` (Review Focus 4): take one row and mark another notified, change the time, regenerate, then assert both rows are unchanged and the new future pending rows have the new time.
  - `mark_missed flips yesterday's pending, leaves today's`
  - `pausing then regenerate_user_doses removes future pending rows; resume restores them`
  - `time_zone change regenerates future pending rows at the new wall-clock`
  - `user B calling set_dose_status on A's dose → no row returned, A's dose unchanged`
  - `deleting a med cascades its schedules and dose_events`
- [ ] **Step 2:** Run `npm run test:int -- doses`. Expected: FAIL.
- [ ] **Step 3:** Implement `0003_doses.sql`.
- [ ] **Step 4:** Run `npx supabase db reset && npm run test:int -- doses`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat(db): dose generation and status changes`.

### Task 4: Refill math, action tokens, reminder claiming, send-reminders

**Files:**
- Create:
  - `supabase/functions/_shared/refill.ts` + `refill.test.ts`
  - `supabase/functions/_shared/actionToken.ts` + `actionToken.test.ts`
  - `supabase/functions/_shared/push.ts`
  - `supabase/migrations/0004_reminders.sql`
  - `supabase/functions/send-reminders/index.ts`
  - `tests/integration/reminders.test.ts`

**Interfaces:**
- Produces, in `refill.ts` (pure TS, no Deno or Node APIs):
  - `avgDosesPerDay(s: { kind; times: string[]; weekdays: number[] | null; interval_days: number | null }): number`
    - daily = `times.length`
    - weekdays = `times.length * weekdays.length / 7`
    - interval = `times.length / interval_days`
    - prn = 0
  - `daysLeft(stock: number | null, unitsPerDose: number, perDay: number): number | null`: null when stock is null or perDay is 0
  - `refillState(med, schedules): 'none' | 'ok' | 'low'`
    - `'none'` when paused, prn-only, or stock is null
    - `'low'` when daysLeft ≤ `refill_threshold_days`
- Produces, in `actionToken.ts`:
  - `signActionToken({ doseId, userId, exp }: ActionClaims, key: string): Promise<string>`, formatted `base64url(json).base64url(hmac)`
  - `verifyActionToken(token: string, key: string, now = Date.now()): Promise<ActionClaims | null>`
- Produces, in SQL:
  - `claim_due_doses() returns table(dose_id uuid, user_id uuid, medication_id uuid, med_name text, strength text, scheduled_for timestamptz)`:
    - selects pending doses where (`notified_at is null and scheduled_for <= now()`) or `snoozed_until <= now()`
    - joins only non-paused meds with `notify = true`
    - `for update skip locked`
    - sets `notified_at = now()`, `snoozed_until = null`
    - returns the claimed rows
    - service role only: `revoke execute on function claim_due_doses() from public, anon, authenticated;` (functions grant EXECUTE to PUBLIC by default)
  - `snooze_dose(p_dose uuid, p_minutes int)`: **security invoker**, so RLS applies when a user calls it. `dose-action` calls it with the service role after checking the token.
- Produces, in `push.ts`: `sendPush(sub: PushSubRow, payload: PushPayload): Promise<'ok' | 'gone' | 'error'>`. On `gone` the caller deletes the subscription.
- Produces `PushPayload`:
  - dose: `{ type: 'dose', tag: doseId, title: string, body: string, actionToken: string }`
  - refill: `{ type: 'refill', tag: 'refill-' + medId, title, body }`

- [ ] **Step 1: Write the failing unit tests.**
  - `refill.test.ts`:
    - `daily 2 times = 2/day`
    - `weekdays 1 time × 3 days = 3/7`
    - `interval 1 time / 3 days = 1/3`
    - `30 pills, 1/dose, 2/day → 15 days`
    - `stock null → none`, `paused → none`
    - `threshold 7, 7 days left → low`, `8 → ok`
    - `stock 0 → low`
  - `actionToken.test.ts`:
    - `round-trips claims`
    - `rejects tampered payload`
    - `rejects wrong key`
    - `rejects expired (now > exp)`
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement `refill.ts` and `actionToken.ts` with WebCrypto `crypto.subtle` HMAC-SHA256. That API is available in both Node 25 and Deno.
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Write the failing integration test** `reminders.test.ts`:
  - `claims a due dose once`: call `claim_due_doses` twice back to back; the first returns 1 row, the second returns 0 (Review Focus 3).
  - `skips future, paused, notify=false, already-acted`
  - `snoozed dose is re-claimed after snoozed_until`
  - `anon role cannot execute claim_due_doses`
- [ ] **Step 6:** Implement `0004_reminders.sql`. Run `npx supabase db reset && npm run test:int -- reminders`. Expected: PASS.
- [ ] **Step 7:** Implement `send-reminders/index.ts`:
  1. Reject the request unless the `x-cron-secret` header equals `CRON_SECRET`.
  2. Call `claim_due_doses`.
  3. For each claimed dose, sign a 24 h action token, then `sendPush` to each `enabled` subscription of that user and delete `gone` ones. Dose notification copy:
     - title: `Time for <med_name>`
     - body: `<strength>, due <local time>`
  4. Refill pass: for users with tracked stock, compute `refillState`.
     - `low` and `refill_alerted_at is null` → push `<name> is running low` with body `About <n> days left. Time to refill.`, then set `refill_alerted_at = now()`.
     - `ok` and `refill_alerted_at` is not null → clear it.
  5. Return `{ claimed, sent, pruned }`.
  - `push.ts` uses `npm:web-push@3.6.7`. If it fails in the edge runtime (it depends on node-compat `crypto.createECDH`), switch to `jsr:@negrel/webpush` behind the same `sendPush` signature.
- [ ] **Step 8:** Smoke-test locally.
  1. Start a tiny local HTTP server that returns `410` for every request.
  2. Run `npx supabase functions serve`.
  3. Insert a due dose and a subscription row whose endpoint is that server.
  4. POST with the secret.

  Expected: response `claimed: 1, pruned: 1`, and the subscription row is deleted. A network error must yield `'error'` and leave the row in place.
- [ ] **Step 9:** Commit with `feat: reminder claiming, refill math, send-reminders`.

### Task 5: dose-action and delete-account functions

**Files:**
- Create: `supabase/functions/dose-action/index.ts`, `supabase/functions/delete-account/index.ts`, `tests/integration/actions.test.ts`

**Interfaces:**
- Consumes: `verifyActionToken`, `set_dose_status`, `snooze_dose`
- Produces:
  - `POST /functions/v1/dose-action` with body `{ token: string, action: 'taken' | 'snooze' }`
    - 200 → `{ status }`
    - 401 on a bad or expired token
    - 404 when the dose's user doesn't match the token
    - Uses the service role, and checks `dose.user_id = claims.userId` before acting.
    - Snooze uses the profile's `snooze_minutes`.
  - `POST /functions/v1/delete-account`
    - requires the user's JWT (`verify_jwt` on)
    - uid comes **only** from the verified JWT: build a client with the caller's `Authorization` header, call `auth.getUser()`, then `admin.auth.admin.deleteUser(user.id)`. The request body is ignored. Rows cascade.

- [ ] **Step 1: Write the failing tests** in `actions.test.ts` (`functions serve` running):
  - `taken via token updates status and stock`
  - `snooze sets snoozed_until ≈ now + snooze_minutes`
  - `expired token → 401`
  - `token for user A on user B's dose id → 404, B's dose unchanged`
  - `delete-account removes auth user and all rows`
  - `delete-account with body {user_id: B} called by A deletes A only; B intact`
- [ ] **Step 2:** Run `npm run test:int -- actions`. Expected: FAIL.
- [ ] **Step 3:** Implement both functions.
- [ ] **Step 4:** Run `npm run test:int -- actions`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: notification actions and account deletion`.

### Task 6: Autocomplete sources

**Files:**
- Create: `src/features/autocomplete/sources.ts` + `sources.test.ts`, `src/features/autocomplete/useSuggestions.ts` + `useSuggestions.test.ts`

**Interfaces:**
- Produces:
  - `type Suggestion = { source: 'mine' | 'ca' | 'us'; name: string; strengths?: string[]; form?: string }`
  - `searchDpd(q: string, signal: AbortSignal): Promise<Suggestion[]>`
    - GET `https://health-products.canada.ca/api/drug/drugproduct/?brandname=<q>&lang=en&type=json`
    - dedupe on `brand_name.trim().toUpperCase()`, first 5
    - name only
  - `searchRxTerms(q, signal): Promise<Suggestion[]>`
    - GET `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=<q>&ef=STRENGTHS_AND_FORMS`
    - map `[_, names, {STRENGTHS_AND_FORMS}]` to `{ name, strengths }`, first 5
  - `searchMine(q, meds: Medication[]): Suggestion[]`: case-insensitive substring match, first 5
  - `useSuggestions(q: string, meds: Medication[], remoteEnabled: boolean): { mine: Suggestion[]; ca: Group; us: Group }`
    - `Group = { items: Suggestion[]; state: 'idle' | 'loading' | 'error' | 'done' }`
    - under 3 chars → all groups idle and empty
    - 300 ms debounce
    - aborts the previous request on a new query

- [ ] **Step 1: Write the failing tests** with `fetch` mocked:
  - `dpd dedupes repeated APO-IBUPROFEN rows`
  - `rxterms maps strengths`
  - `mine matches case-insensitive`
  - `under 3 chars → idle, no fetch`
  - `remoteEnabled=false → no fetch, mine still shown`
  - `ca failing → ca.state=error, us still done`
  - `latest query wins` (Review Focus 5): resolve the "ibup" response first, then the stale "ibu" one, and assert the items still come from "ibup".
- [ ] **Step 2:** Run `npm test -- autocomplete`. Expected: FAIL.
- [ ] **Step 3:** Implement. Use fake timers for the debounce, and an `AbortController` per query plus a query-id check before setting state.
- [ ] **Step 4:** Run `npm test -- autocomplete`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: canada-first medication name suggestions`.

### Task 7: Auth, guest mode, data layer, Today

**Files:**
- Create:
  - `src/lib/supabase.ts`, `src/lib/types.ts`
  - `src/data/{meds,doses,profile}.ts`
  - `src/features/auth/{auth.ts,Welcome.tsx,GuestBanner.tsx,guestBanner.ts}` + `guestBanner.test.ts`
  - `src/features/today/{Today.tsx,WeekStrip.tsx,DoseRow.tsx,dayRange.ts}` + `dayRange.test.ts`

**Interfaces:**
- Consumes: the RPCs from Task 3
- Produces, in `auth.ts`:
  - `continueAsGuest()` → `signInAnonymously`
  - `createProfile(email, password)`: for an anonymous user, links email and password to the same user id.
    1. `updateUser({ email }, { emailRedirectTo: origin + '/settings?finish=1' })`. Locally confirmations are off, so `updateUser({ password })` follows immediately.
    2. In prod the password is held only in memory. The UI shows "Check your email to confirm".
  - `needsPasswordFinish(user): boolean`: true when the user has a confirmed email, `is_anonymous` is false, and the profile flag `password_set` is false.
    - On app load, when it returns true, Settings shows a "Set your password" form that calls `updateUser({ password })` and then sets `password_set = true`.
    - The prod flow therefore never leaves a passwordless account unnoticed.
    - Add `profiles.password_set bool default false` in Task 2; `signUp` sets it true.
  - `signUp(email, password)`
  - `signIn(email, password)`: when the current user is anonymous, the UI first confirms with the copy `Your guest data on this device will be left behind.`
  - `signOut()`
  - `isGuest(user): boolean`
- Produces, in `guestBanner.ts`: `shouldShowGuestBanner(isGuest: boolean, dismissedAt: number | null, now: number): boolean`. It returns true when the user is a guest and either `dismissedAt` is null or 7 days have passed. `localStorage` key `guestBannerDismissedAt`, with reads wrapped in try/catch.
- Produces, in `dayRange.ts`: `localDayRange(date: string /* YYYY-MM-DD */, tz: string): { from: string; to: string }`, an ISO UTC range covering that local day.
- Produces, in `data/doses.ts`:
  - `listDoses(from, to)`
  - `setDoseStatus(id, status)`
  - `logPrnDose(medId)`
  - each call followed by `generate_doses` via rpc on app load
- Produces, in `data/profile.ts`:
  - `getProfile()`
  - `updateProfile(patch)`: when `patch.time_zone` changes, it then calls rpc `regenerate_user_doses`
  - `touchLastSeen()`: run on every app load; sets `last_seen_at = now()`
  - On first load, if `time_zone` is still the default, write `Intl.DateTimeFormat().resolvedOptions().timeZone`.

- [ ] **Step 1: Write the failing tests.**
  - `guestBanner.test.ts`:
    - `not guest → false`
    - `guest never dismissed → true`
    - `dismissed 6 days ago → false`
    - `dismissed 7 days ago → true`
  - `dayRange.test.ts`:
    - `2026-10-19 in America/Toronto → 2026-10-19T04:00Z..2026-10-20T04:00Z`
    - `2026-11-01 in America/Toronto spans 25 h`
    - `same date in Asia/Tokyo differs from browser zone` (Review Focus 1: run with `TZ=UTC` and assert the range is computed from the tz arg, not the browser zone)
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the auth helpers, `dayRange` (use `Intl` offsets, no date library), and `guestBanner`.
- [ ] **Step 4:** Implement the pages.
  - `Welcome` has three buttons: "Create profile", "Sign in", "Continue without profile".
  - `Today` has:
    - the `WeekStrip` (7 days centred on today, tap to select)
    - `DoseRow` groups by local time, each with "Taken" and "Skip"
    - a "Resolved" collapsible section
    - the guest banner, with copy `Your data is only on this device. Create a profile to secure it and use it on other devices.` plus "Create profile" and "Not now" buttons
    - a refill warning chip per low med
    - a "Notifications are off on this device" banner when permission isn't granted or the subscription is disabled
- [ ] **Step 5:** Run `npm test`. Expected: PASS. Then run `npm run dev` against the local stack: continue as guest, check the banner shows, and check Today is empty.
- [ ] **Step 6:** Commit with `feat: auth with guest mode and today view`.

### Task 8: Meds tab (list, form, schedule editor, autocomplete UI, refill)

**Files:**
- Create: `src/features/meds/{MedsList.tsx,MedCard.tsx,MedForm.tsx,ScheduleEditor.tsx,NameAutocomplete.tsx}`, `src/features/meds/MedForm.test.tsx`

**Interfaces:**
- Consumes: `useSuggestions`, `refillState`/`daysLeft` from `supabase/functions/_shared/refill.ts`, `regenerate_future_doses`, `data/meds.ts`
- Produces, in `data/meds.ts`:
  - `listMeds()`
  - `saveMed(med, schedules)`: upserts, then rpc `regenerate_future_doses`
  - `deleteMed(id)`
  - `setPaused(id, paused)`: updates, then rpc `regenerate_user_doses`
  - `addStock(id, qty)`

- [ ] **Step 1: Write the failing tests** in `MedForm.test.tsx`:
  - `picking a US suggestion with strengths shows strength chips and fills strength on tap`
  - `free-text name saves without picking a suggestion`
  - `suggestion groups render in order Your meds, Canada, United States with those headings`
  - `weekdays schedule requires ≥1 day`
  - `interval requires interval_days ≥ 2`
- [ ] **Step 2:** Run `npm test -- meds`. Expected: FAIL.
- [ ] **Step 3:** Implement the UI.
  - `MedCard` shows:
    - name + strength
    - schedule summary (`Daily — 11:00 AM`, `Mon, Wed — 8:00 AM`, `Every 3 days — 9:00 AM`, `As needed`)
    - an `N pills left` chip, red when `low`
    - a pause toggle
    - "Log dose" for prn
    - "Refilled" (asks for quantity)
  - Paused meds sort last and are greyed.
  - An "+ Add" floating button opens `MedForm`.
  - Fields follow spec §7.4, with defaults from Global Constraints.
- [ ] **Step 4:** Run `npm test -- meds`. Expected: PASS. Manually add a med in the dev app and check its doses appear on Today.
- [ ] **Step 5:** Commit with `feat: medication list and editor`.

### Task 9: Service worker, push subscription, notification actions

**Files:**
- Create: `src/sw.ts`, `src/push/subscribe.ts`, `src/push/closeStale.ts`
- Modify: `vite.config.ts` (VitePWA `strategies: 'injectManifest'`, `srcDir: 'src'`, `filename: 'sw.ts'`, manifest name `MedTracker`, `theme_color #161616`, icons 192/512)

**Interfaces:**
- Consumes: `PushPayload` (Task 4), `dose-action` (Task 5)
- Produces, in `subscribe.ts`:
  - `enablePushOnThisDevice(label: string): Promise<'ok' | 'denied' | 'unsupported'>`: requests permission, subscribes with `VITE_VAPID_PUBLIC_KEY`, upserts `push_subscriptions` by `endpoint` with `enabled = true`
  - `setDeviceEnabled(enabled: boolean)`
  - `getDeviceState(): Promise<'on' | 'off' | 'denied' | 'unsupported'>`
- Produces, in `closeStale.ts`: `closeStaleNotifications(pendingDoseIds: Set<string>)`.
  - On `visibilitychange` to visible, the app refetches Today's doses, then calls this function.
  - This is how a dose marked Taken on the phone shows up on the laptop (spec §9).
- `sw.ts` behaviour:
  - `push`:
    - `showNotification(title, { body, tag, data })`
    - dose payloads get actions `[{action:'taken',title:'Taken'},{action:'snooze',title:'Snooze'}]`
  - `notificationclick`:
    - with an action, POST `{token, action}` to `${VITE_SUPABASE_URL}/functions/v1/dose-action` with header `apikey: VITE_SUPABASE_ANON_KEY`, then close the notification
    - on a non-2xx response, or with no action, focus or open `/today`

- [ ] **Step 1:** Implement `vite.config.ts` changes, `sw.ts`, `subscribe.ts`, `closeStale.ts`. There is no unit test here: push APIs aren't available in jsdom, and Step 3 is the check.
- [ ] **Step 2:** Run `npm run build && npx vite preview`. Expected: Lighthouse/DevTools shows the app as installable with an active service worker.
- [ ] **Step 3:** Generate local VAPID keys (`npx web-push generate-vapid-keys`), enable push in Chrome desktop, insert a due dose, and POST `send-reminders`. Expected:
  - the notification appears
  - "Taken" marks the dose taken in the DB and decrements stock
  - "Snooze" sets `snoozed_until`
- [ ] **Step 4:** Commit with `feat: push notifications with taken and snooze actions`.

### Task 10: History + Settings

**Files:**
- Create: `src/features/history/History.tsx`, `src/features/settings/Settings.tsx`, `src/features/settings/exportCsv.ts` + `exportCsv.test.ts`

**Interfaces:**
- Produces: `toCsv(meds: Medication[], schedules: Schedule[]): string` with columns `name,strength,form,schedule,units_per_dose,stock,notes`, RFC 4180 quoting.

- [ ] **Step 1: Write the failing test** in `exportCsv.test.ts`:
  - `quotes commas and quotes in notes`
  - `schedule column uses the MedCard summary text`
- [ ] **Step 2:** Run `npm test -- exportCsv`. Expected: FAIL.
- [ ] **Step 3:** Implement `toCsv`.
  - `History`: per active med, last 7 days as ✓ / – / ✗ icons (taken / skipped / missed); tap a med for a 30-day list.
  - `Settings` sections:
    - Account: email or "Guest", nickname, time zone select, sign out, create profile when guest
    - Notifications on this device: toggle plus "Send test notification", which shows a local notification via `registration.showNotification('Test', …)`, with no server involved.
    - Snooze length
    - Medication name suggestions toggle
    - Export med plan (downloads CSV)
    - Delete account (confirm dialog, then `delete-account`)
    - Battery-optimization tip for Android
- [ ] **Step 4:** Run `npm test`. Expected: PASS.
- [ ] **Step 5:** Commit with `feat: history and settings`.

### Task 11: Cron wiring + E2E

**Files:**
- Create: `supabase/migrations/0005_cron.sql`, `playwright.config.ts`, `tests/e2e/guest.spec.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- `0005_cron.sql` schedules:
  - `send-reminders` every minute: `net.http_post` to `<project_url>/functions/v1/send-reminders` with header `x-cron-secret`.
    - Both values are read from Vault secrets `project_url` and `cron_secret`.
    - Wrapped in a SQL function that returns early when either secret is null, so local stacks without Vault secrets don't post to a null URL.
  - `generate_doses()` every 15 min
  - `mark_missed()` every 15 min
  - monthly: `purge_stale_guests()`, a security definer function owned by `postgres`.
    - Deletes `auth.users` rows that are `is_anonymous` and whose `profiles.last_seen_at < now() - interval '90 days'`.
    - Before relying on it, check that the role can delete from `auth.users` on hosted Supabase (`\dp auth.users`).
    - If it can't, drop this job from v1 and note that in the README; don't work around it.

- [ ] **Step 1: Write the e2e specs** against `npm run dev` + the local stack.
  - `guest.spec.ts`:
    1. Continue without profile.
    2. Add med "Test Med" at a time 1 minute from now.
    3. Banner visible.
    4. Create profile with a random email and password `Test-pass-123!`. This is a local test value; record it in `tests/e2e/fixtures.ts`.
    5. "Test Med" is still listed.
    6. A new browser context signs in with the same credentials and sees "Test Med".
  - `smoke.spec.ts`:
    1. Sign up.
    2. Add med with stock 10.
    3. The dose appears on Today.
    4. Click Taken; the Meds card shows `9 pills left`.
    5. History shows ✓ for today.
- [ ] **Step 1b:** Add the integration test `purge_stale_guests deletes a guest with last_seen_at 91 days ago, keeps one at 89 days, keeps non-anonymous users`.
- [ ] **Step 2:** Run `npm run test:e2e`. Expected: PASS. Fix the app, not the tests, on failure.
- [ ] **Step 3:** Run `npx supabase db reset` and confirm `select jobname from cron.job` lists the 4 jobs.
- [ ] **Step 4:** Commit with `feat: cron schedules and e2e coverage`.

### Task 12: Deploy + README + Android check (needs owner)

**Files:**
- Create: `README.md`, `vercel.json` (SPA rewrite to `/index.html`)

- [ ] **Step 1:** Write `README.md`:
  - local setup
  - env variables
  - deploy steps
  - Android install ("Add to Home screen" in Chrome) and the battery-optimization tip
  - iOS note: Home Screen + iOS 16.4+
  - Supabase free-project pause note
  - check that 43k function calls/month is within the current free quota; fallback is to change the cron to `*/5 * * * *`
- [ ] **Step 2: Stop for owner.** The owner creates the Supabase project and the Vercel account and gives Claude the project URL and anon key; Claude never handles the service-role key in chat. The owner (or Claude via CLI after `npx supabase login`, run by the owner) then:
  1. `npx supabase link`
  2. `npx supabase db push`
  3. `npx supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:… CRON_SECRET=… ACTION_TOKEN_KEY=…`
  4. `npx supabase functions deploy`
  5. sets the Vault secrets `project_url` and `cron_secret`
  6. turns on email confirmations and anonymous sign-ins in the dashboard
  7. imports the repo in Vercel with the three `VITE_*` env vars
- [ ] **Step 3: Manual verification on the owner's Android phone:**
  1. Install from Chrome.
  2. Enable notifications.
  3. Add a med due in 2 minutes.
  4. Close the app → notification arrives.
  5. "Taken" → the laptop view shows taken and stock decremented.
  6. Turn the device toggle off → the next dose produces no push on the phone while the laptop (if enabled) still gets one.
  7. Guest → create profile keeps data.
- [ ] **Step 4:** Commit with `docs: readme and deploy config`.
