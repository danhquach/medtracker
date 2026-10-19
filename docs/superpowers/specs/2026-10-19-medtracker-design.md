# MedTracker — Design

Date: 2026-10-19
Status: Draft, awaiting owner approval

## 1. Intent

A personal, ad-free replacement for the MyTherapy Android app. The owner uses
MyTherapy for three things only: keeping a list of their medications, getting a
reminder at dose time, and being told when to refill. Everything else
(measurements, symptoms, community, streaks, promos, ads) is noise.

It must work on the owner's Android phone first, but also on any other device
(laptop, tablet, someone else's phone) when the phone isn't nearby. Data
follows the account, not the device.

No PHI is stored beyond what the owner types in about their own meds. The
account exists only to keep each person's data private and unique.

## 2. Goals

1. **Med list:** add, edit, pause/resume, and delete medications.
2. **Reminders:** a push notification at each scheduled dose time, with
   Taken / Skip / Snooze actions, delivered even when the app is closed.
3. **Dose log:** every scheduled dose ends up Taken, Skipped, or Missed.
4. **Refill alerts:** pill count goes down automatically on Taken, and the
   owner is warned when supply drops below a threshold.
5. **Any device:** sign in from any browser and see the same data.
5a. **Use without a profile:** the app works immediately with no sign-up
   (guest mode). The app recommends creating a profile for security and
   multi-device access, but never forces it.
6. **Notification control:** turn notifications on or off per device and per
   med, so a laptop or a paused med stays quiet.

## 3. Non-goals

- Measurements, symptoms, activities, Health Connect.
- Barcode scanning, drug interaction checks, drug monographs. (Name
  autocomplete *is* in scope; see 7.4a.)
- Caregiver / family sharing, care recipients.
- Streaks, gamification, daily pictures, travel planner, community, support chat.
- Native Android app (may revisit later if web push proves unreliable).

## 4. Anti-goals (failure even if it "works")

- Any ads, trackers, or analytics SDKs.
- One user able to see another user's data, by any route.
- A reminder that silently doesn't fire, with no indication to the user.
- A notification that keeps showing after the dose is marked (a known
  MyTherapy bug).
- Setup that feels heavier than MyTherapy's.

## 5. Constraints

- Free tier only (Supabase free, Vercel free).
- The owner creates the Supabase and Vercel accounts and supplies keys;
  the builder never creates accounts.
- No secrets committed to the repo. `.env.example` lists the variables.
- Must install to the Android home screen from Chrome and send notifications
  from there.

## 6. Decided by the owner

- Scope: med list + reminders + refill alerts; no measurement/symptom tracking.
- App is usable without creating a profile; profile creation is suggested
  for security, not required.
- Med name autocomplete: Canadian sources first, US second, grouped by region.
- Primary device: Android phone; must also be usable on other devices.
- Notifications must be switchable on/off.
- Accept Supabase + Vercel hosted setup (owner creates the accounts).
- MyTherapy screenshots are the visual reference (layout, not branding).

## 7. Builder's calls (made in conversation, owner can override)

### 7.1 Platform and stack

- **Installable web app (PWA)**: Vite + React + TypeScript, `vite-plugin-pwa`
  for manifest + service worker.
- **Backend:** Supabase: Postgres, Auth, Row Level Security, Edge Functions,
  `pg_cron`.
- **Push:** standard Web Push (VAPID). Sent from a Supabase Edge Function
  using the `web-push` npm package.
- **Hosting:** Vercel static deploy of the frontend.
- **Tests:** Vitest for domain logic; Playwright for a small E2E smoke suite.

Why not native Android: slightly more reliable alarms, but it doesn't solve
"other devices" and costs far more to build. Web push on Android Chrome works
when the app is closed.

### 7.2 Account / profile

- **Guest mode (owner's requirement):** on first launch the app offers
  "Create profile", "Sign in", and "Continue without profile".
  - *Builder's call:* "Continue without profile" uses Supabase **anonymous
    sign-in**. The guest still gets a real user id, so RLS, sync and push
    reminders all work the same as for a full profile.
  - Guest data is tied to that one browser's session. If the browser's
    storage is cleared, or the device is lost, the data cannot be recovered,
    and the guest can't open it from another device.
- **Nudge, don't force:** while in guest mode, a dismissible banner on
  Today says the data is only on this device and asks the guest to create a
  profile to secure it. After dismissal it comes back once every 7 days. The
  same message stays in Settings.
- **Upgrade keeps data:** creating a profile from guest mode links an email
  and password to the existing anonymous user (`updateUser`), so nothing
  is migrated or lost.
- Signing in to an *existing* profile while in guest mode warns that the
  guest data will be left behind. v1 does not merge it.
- *Builder's call:* anonymous users inactive for 90 days are deleted by a
  monthly cron job, so abandoned guests don't pile up.
- Full profile: Supabase Auth, **email + password** (email confirmation on).
- Profile: optional display nickname + **time zone** (auto-detected, editable).
  No real name, DOB, or other identifiers asked for.
- Every table has `user_id`; RLS policy on every table:
  `user_id = auth.uid()` for select/insert/update/delete. No exceptions,
  no service-role access from the client.
- Server-side secrets (service-role key, VAPID private key, cron shared
  secret, action-token HMAC key) live only in Supabase function secrets,
  never in the frontend or repo. Edge Functions are the only code that uses
  the service role, and each one scopes its writes to a single verified user.
- Delete account: an Edge Function deletes the `auth.users` row; all tables
  cascade from it.

### 7.3 Screens (three tabs + settings, dark theme, warm red accent)

- **Today** (home): week strip (7 days, today highlighted, tap a day to view
  it). List of that day's doses grouped by time, each with Taken / Skip.
  Done doses collapse into "Resolved". Past days are viewable and editable
  (late marking allowed). Banner at top if notifications are off or not
  permitted on this device. Refill warnings show here too.
- **Meds**: cards like MyTherapy's Treatment tab: name + strength, schedule
  summary ("Daily — 11:00 AM"), "N pills left" chip, pause toggle. Paused meds
  sort below active ones and are greyed. "+ Add" floating button.
- **History**: per med, last 7 days as check / skip / miss icons; tap a med for
  a longer list (30 days, scrollable).
- **Settings**: account (email, nickname, time zone, sign out), notifications
  on this device (on/off + "send test notification"), snooze length,
  export med plan (CSV), delete account (deletes all rows).

### 7.4 Medication fields

| Field | Notes |
|---|---|
| name | required, free text |
| strength | free text, e.g. "200 mg" |
| form | tablet / capsule / liquid / other (icon only) |
| notes | free text: what it's for, food instructions |
| schedule | see 7.5 |
| units_per_dose | number, default 1 |
| stock | current pill count, nullable (null = don't track) |
| refill_threshold_days | default 7 |
| notify | per-med on/off, default on |
| paused | bool; paused meds generate no doses and no reminders |

### 7.4a Medication name autocomplete (owner's requirement)

The owner wants suggestions while typing the name. **Canadian results come
first**, US results second, shown in **separate labelled groups** so the
owner can pick by region.

Suggestion list, top to bottom:

1. **Your meds:** matches from the user's own existing and past meds. Local
   only.
2. **Canada:** from the Health Canada Drug Product Database (DPD).
3. **United States:** from NIH RxTerms.

Picking a suggestion fills the name. Where the source supplies them, it also
fills strength and form; the user can edit any field afterwards. Free text
always remains allowed, so a med not found in any list can still be saved.

Sources, verified 2026-10-19 (both free, no key, CORS `*`, so they can be
called from the browser):

- **Canada (DPD):**
  `https://health-products.canada.ca/api/drug/drugproduct/?brandname=<q>&lang=en&type=json`
  - Substring match on brand name: `ibupro` returned 94 rows (65 unique names), including
    APO-IBUPROFEN, APO-IBUPROFEN TAB 600MG and ALTI-IBUPROFEN TAB 400MG.
  - Results include duplicates and non-marketed or cancelled products, and
    there's no strength field on this endpoint.
  - *Builder's call:* dedupe by brand name. Exclude non-marketed products if
    the DPD status data allows it cheaply, otherwise show them all. Take
    strength and form from DPD's active-ingredient and dosage-form endpoints
    only if that's simple; otherwise name only.
- **US (RxTerms):**
  `https://clinicaltables.nlm.nih.gov/api/rxterms/v3/search?terms=<q>&ef=STRENGTHS_AND_FORMS`
  - Prefix match. It returns a display name plus a strength/form list, e.g.
    "Ibuprofen (Oral Pill)" → 100 mg Tab … 800 mg Tab.
  - Picking a result shows the strengths as tappable chips.

Behaviour (builder's calls):

- Search starts at 3 characters, with a 300 ms debounce.
- Both sources are queried in parallel. Each group shows up to 5 results and
  renders independently, so a slow or failed source never blocks the other.
  A failed source shows a quiet "unavailable" note in its group.
- Privacy: only the typed letters are sent, with no user id or token.
  Settings has a "Medication name suggestions" on/off switch (default on).
  When it's off, only "Your meds" suggestions are shown.

### 7.5 Schedules

- Supported: **daily at one or more times**, **specific weekdays at one or
  more times**, **every N days** from a start date, and **as needed** (no
  reminders, log manually).
- Optional start date and end date (for short courses like antibiotics).
- Times are wall-clock in the profile time zone (a dose at 08:00 stays 08:00
  after DST or travel once the time zone is updated).

### 7.6 Dose lifecycle

- Doses are materialized as rows (`dose_events`) for today + tomorrow (in each
  user's time zone) by a SQL function `generate_doses()`, run by `pg_cron`
  every 15 minutes and also called right after any med/schedule/time-zone
  edit. Insert is idempotent (unique key). No backfill of older days: if the
  system was down, those days simply have no rows. *(Builder's call.)*
- Exception (MT-39): saving a med also creates today's already-passed doses
  for times that are new to that med (all times for a new med), so they can be
  marked Taken or Skip. They are created already notified, so no reminder is
  sent. Cron, boot, pause and time zone changes still create future doses only.
- Editing a schedule, pausing, or changing time zone deletes and regenerates
  only rows that are `pending`, `scheduled_for > now()`, and not yet
  notified. Anything already notified or acted on is left alone.
- States: `pending` → `taken` | `skipped` | `missed`.
- `missed`: a SQL function `mark_missed()` (cron, every 15 min) flips
  `pending` rows whose scheduled day has ended in the user's time zone.
  Manual marking of a missed dose later is still allowed.
- Taken decrements `stock` by `units_per_dose`, clamped at 0; un-marking a
  Taken restores it.
- "As needed" meds: no generated rows; a "Log dose" button on the med card
  creates a taken row.

### 7.7 Reminders

- `pg_cron` runs every minute and calls the `send-reminders` Edge Function
  (via `pg_net`, authenticated with a shared secret header; the function
  rejects calls without it).
- A dose is **due** when `status = pending` and either
  (`notified_at is null` and `scheduled_for <= now()`) or
  (`snoozed_until <= now()`). For each due dose it sends one push to every
  **enabled** subscription of that user, sets `notified_at = now()` and
  `snoozed_until = null`. Paused meds and meds with `notify = off` are skipped.
- Notification actions: **Taken**, **Snooze**. Tapping the body opens Today.
- **How actions authenticate** *(builder's call)*: the push payload carries a
  short-lived signed action token (HMAC over dose id + user id + expiry,
  valid 24 h). The service worker posts it to a `dose-action` Edge Function,
  which verifies it and updates only that one dose. No Supabase session is
  needed in the service worker. If the token has expired or the call fails,
  the worker opens the app on Today instead.
- Snooze sets `snoozed_until = now() + snooze length` (default 10 min;
  options 5/10/15/30/60). The next cron run after that re-sends.
- **No repeat nagging** beyond snooze in v1 (one push per dose).
- Notification `tag` = dose id. Marking the dose on the device closes its
  notification there. Other devices' stale notifications are closed when the
  app is opened on them (the app closes notifications whose dose is no longer
  pending). No "silent" push is attempted, since Chrome won't reliably allow it.
- Dead push subscriptions (404/410) are deleted automatically.

### 7.8 Refill alerts

- Average doses per day *(builder's call)*: daily = number of times;
  weekdays = times × weekday count / 7; every N days = times / N.
- Days left = `stock / (units_per_dose × average doses per day)`.
- No refill tracking when `stock` is null, the med is "as needed", or it's
  paused.
- When days left ≤ `refill_threshold_days` (stock 0 included): a warning
  chip on the med card and on Today, plus **one** push notification
  (`refill_alerted_at` set). It is re-armed whenever days left rises back
  above the threshold (after a refill or a manual stock edit).
- The check runs inside `send-reminders` and right after each Taken.
- "Refilled" action on the med: enter quantity added → stock += quantity.

### 7.9 Notifications on/off

- **Per device:** each browser's push subscription row has `enabled`. The
  Settings toggle flips it (or unsubscribes when the browser permission is
  revoked).
- **Per med:** the `notify` field.
- Turning a device off never affects other devices.

## 8. Data model (sketch)

- `profiles(user_id PK, nickname, time_zone, snooze_minutes)`
- `medications(id, user_id, name, strength, form, notes, units_per_dose,
  stock, refill_threshold_days, notify, paused, refill_alerted_at,
  created_at, updated_at)`
- `schedules(id, user_id, medication_id, kind[daily|weekdays|interval|prn],
  times time[], weekdays int[], interval_days, start_date, end_date)`
- `dose_events(id, user_id, medication_id, scheduled_for timestamptz,
  status, acted_at, notified_at, snoozed_until)`, unique on
  (medication_id, scheduled_for)
- `push_subscriptions(id, user_id, endpoint unique, p256dh, auth,
  device_label, enabled, created_at)`

## 9. Verification (definition of done for v1)

- Vitest: autocomplete merge (group order Your meds → Canada → US, DPD
  dedupe, one source failing still renders the other).
- Vitest: schedule expansion (daily, weekdays, interval, end date, DST
  boundary), days-left math, missed-dose rollover.
- RLS test: two test users; user B cannot read/write any of user A's rows
  through the anon key (all five tables).
- Playwright guest flow: continue without profile → add med → banner shown →
  create profile → same med still present → sign in on a second browser
  context sees it.
- Playwright smoke: sign up → add med → dose appears on Today → mark Taken →
  stock decrements → History shows check.
- Manual on the owner's Android phone: install from Chrome, receive a
  reminder with the app closed, Taken from the notification updates the
  laptop view, device toggle off → no push on that device.

## 10. Left to the builder

- Component library / styling approach (keep it light; no heavy UI kit
  required).
- Exact copy, icons, spacing.
- Folder structure, state management, migration tooling.
- Whether the service worker uses Workbox strategies or a hand-written
  worker for push handling.

## 11. Known risks

- Android battery optimization can delay web push. Mitigation: Settings
  shows a "send test notification" button and a tip to exclude Chrome from
  battery optimization.
- iPhone/iPad: web push only works once the app is added to the Home Screen
  (iOS 16.4+). Documented, not engineered around.
- Per-minute cron ≈ 43k Edge Function calls/month, within the Supabase free
  quota (verify the current limit during setup; fallback is a 5-minute
  interval).
- Supabase free projects pause after a week of no activity; daily use and
  the per-minute cron keep it active. Documented in README.
