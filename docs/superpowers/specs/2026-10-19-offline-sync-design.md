# Offline Mode with Later Sync — Design

Date: 2026-10-19
Status: Draft, awaiting owner approval

## 1. Intent

MedTracker must keep working when the device has no connection: the owner
opens the app (already possible, since it is a PWA with a precached shell),
sees their meds and today's doses, and can do anything they normally do.
Changes made offline are kept on the device and sent to Supabase
automatically once the connection is back. Today a lost connection means
blank screens and failed actions, because every read and write goes straight
to Supabase.

## 2. Goals

1. **Read offline:** Today, Meds, History and Settings show the last-known
   data when offline, instead of an error or a spinner.
2. **Write offline (everything):** mark a dose Taken/Skipped, log a PRN dose,
   add/edit/delete a med (including schedules), pause/resume, stop, add
   stock, change profile settings.
3. **Sync later:** queued changes send themselves, in order, when the
   connection returns (online event, app focus, app start), with no user
   action.
4. **Visible state:** a small indicator shows when the app is offline and
   how many changes are waiting, and when a change failed to sync.
5. **Correct local view:** after an offline action the UI reflects it at once
   (dose shows Taken, stock goes down, new med appears in the list).

## 3. Non-goals

- Offline sign-in / sign-up / password changes / account deletion. These
  need the server; they show a "needs a connection" message.
- Offline push subscribe/unsubscribe and the notification-action buttons
  (Taken/Skip/Snooze from a notification call an edge function from the
  service worker). Notifications themselves still arrive, since the server sends them.
- Real-time multi-device merge (no live subscriptions, CRDTs, or
  per-field merging).
- Offline name-autocomplete from remote sources (local history suggestions
  may still work if they already do).

## 4. Anti-goals (failure even if it "works")

- **Silent data loss:** a change the user made offline that never reaches
  the server, with no visible sign. Failed syncs must stay visible until
  resolved.
- **Double-applied actions:** a dose marked Taken twice, or stock decremented
  twice, because a queued call was retried.
- **Data leak across accounts:** cached data or queued changes from one user
  visible to, or sent as, another user on the same browser (sign-out, guest →
  account upgrade).
- **Blocking the online path:** online use getting slower or flakier than
  today.

## 5. Constraints

- Supabase project is **production** (see repo memory / #22): no test runs
  against it; server changes ship as new migrations only.
- Free tier; no new paid services. No new runtime dependency unless it
  clearly earns its place (IndexedDB via a tiny wrapper or hand-rolled is
  fine).
- Limited GitHub Actions minutes: avoid needless pushes.
- Several feature branches (Today, Meds, History, Settings, calendar) are in
  flight and touch the screens. This work should sit **under the
  `src/data/*` functions** so screens change as little as possible, keeping
  merge conflicts small.

## 6. Decided (owner or builder call, marked)

- **Scope = everything works offline** (owner).
- **Conflict policy = last write wins, per action, in the order the server
  receives it** (builder call; owner handed this over). Rationale: a single
  owner, occasionally on two devices; doses and med edits are rarely edited
  on two devices in the same offline window. Specifics:
  - Dose status changes are idempotent: `set_dose_status` returns early on
    taken→taken, so stock isn't decremented twice (verified in 0003).
  - `save_med` replays the whole med + schedules payload; the later save
    wins.
  - Deleting a med that the other device edited: delete wins. Editing a med
    already deleted on the server: the queued item fails and is surfaced
    (goal 4), not retried forever.
- **Client-generated IDs** (builder call): new meds and PRN doses created
  offline get a UUID on the device, so the UI can reference them and replays
  can't create duplicates. Requires server changes (new migrations):
  - `save_med` today treats a supplied `id` as update-only and raises P0002
    if the row is missing (0010/0011). Add an explicit create flag: a queued
    *create* with a client id inserts with that id (no-op if it already
    exists = replay); a queued *edit* keeps update-only, so editing a med
    deleted on the server fails with P0002 and is surfaced, never
    silently re-created.
  - `log_prn_dose` accepts a client id and is idempotent on it.
  - `add_stock` accepts an op id and ignores a repeat of the same op id
    (a retried blind increment would double-add stock).
- **Every queued write is one idempotent RPC** (builder call). `deleteMed`,
  `setPaused` (update + regenerate) and `updateProfile` (update + optional
  regenerate on time-zone change) become single RPCs, so the outbox only ever
  holds one call per user action and never a half-applied pair.
- **Time of action = when the user did it, not when it synced** (builder
  call). Dose and PRN RPCs take a client timestamp (`acted_at`, PRN
  `scheduled_for`), clamped server-side to "not in the future, not older than
  the dose window", so History shows the real time.
- **Offline dose actions target (medication_id, scheduled_for), not dose id**
  (builder call). Every `save_med`, pause and time-zone change regenerates
  future pending doses with new ids, so a queued id can go stale. Add an RPC
  `set_dose_status_at(p_med, p_scheduled_for, p_status, p_acted_at)`. If no
  such dose exists when it replays (the schedule changed so that time is
  gone), the item fails and is surfaced; it is not dropped silently.
- **Local storage = IndexedDB**, keyed per user id. Holds a read cache
  (meds, schedules, dose window, profile) and an outbox (ordered queue of
  pending calls).
- **Sign-out / account switch with unsynced changes** (builder call): if the
  outbox is non-empty, sign-out first tries to sync; if that can't finish
  (offline), it warns "N changes haven't synced and will be lost" and needs
  an explicit confirm. Same warning for guest → sign in to a *different*
  existing account (user id changes). Cache + outbox are cleared only after
  that. Guest → upgrade-in-place keeps the same user id, so nothing moves.
- **Expired session while syncing** (builder call): 401 / refresh failure
  is "retry later", not permanent; the indicator says "Sign in again to
  sync". The queue is kept.
- **Doses for new/edited schedules while offline:** the server generates
  doses, so offline the app computes *provisional* doses for the cached
  window from the schedule locally. It mirrors `generate_doses_for` fully:
  daily, weekdays and interval rules, profile time zone, today's passed-time
  backfill, and old-times skipping. Parity is unit-tested against fixtures
  that match the SQL. After sync, real rows replace them. Provisional doses
  can be marked Taken; that queues behind the `save_med` that creates them.
- **Missed-dose cron vs. queued Taken:** if `mark_missed` flipped a dose to
  missed while the device was offline, the queued Taken still wins, as it
  does online today.
- **Optimistic local effects** mirror the server: Taken decrements local
  stock by `units_per_dose` (floor 0, skip if untracked), un-taking restores
  it, `add_stock` adds.
- **Sync trigger:** `online` event, `visibilitychange` to visible, and app
  start. No background sync API (unsupported on iOS, unreliable elsewhere).
- **After a successful flush:** refetch from the server and replace the
  cache, so server-side effects (refill flags, generated doses) win.

## 7. Left to the builder

- IndexedDB wrapper choice (hand-rolled vs. `idb`), schema layout, and
  versioning.
- Exact outbox format, retry/backoff, and which errors are "permanent"
  (4xx, RLS, check-constraint violations from MT-4) vs. "retry later"
  (network, 5xx).
- How screens subscribe to cache changes (a small store/hook in `src/data`
  is expected; keep screen diffs minimal).
- Size of the cached dose window (at least what Today, the week strip and
  recent History show).
- Indicator placement and copy, within the existing app shell (MT-25) and
  AA contrast rules.
- Mock mode (`dev:mock`) support for testing offline behavior, plus unit tests
  for the outbox, local dose computation, and optimistic effects.
- An e2e test that toggles Playwright offline mode, acts, goes online, and
  checks the result against the mock backend (never production).

## 8. Done when

- With the network off (DevTools / Playwright offline), the owner can open
  the installed app, see today's doses, mark one Taken, add a new med with a
  daily schedule, and see both reflected immediately.
- Turning the network back on sends both changes without user action. The
  indicator clears, and a reload shows the server's data matching what was
  done offline, with stock decremented exactly once.
- Signing out clears cached data and the outbox for that user, after the
  unsynced-changes warning when the outbox isn't empty.
- A forced replay of every queued item (simulated lost response) leaves
  stock, doses and meds unchanged the second time.
