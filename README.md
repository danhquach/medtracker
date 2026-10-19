# MedTracker

Medication reminder PWA. Vite + React + TypeScript; Supabase (Postgres + RLS, SQL functions, `pg_cron` + `pg_net`, Vault, Edge Functions `send-reminders` / `dose-action` / `delete-account`); Web Push (VAPID). Migrations `0001`-`0007` live in `supabase/migrations`.

## Local setup

Local dev and tests use a hosted Supabase **TEST** project (no Docker).

```sh
npm install
```

Test project settings: anonymous sign-ins ON, email confirmation OFF (test only, never in prod).

### Environment files (all gitignored)

| File | Variables | Template |
|---|---|---|
| `.env.local` | `VITE_SUPABASE_URL` (`https://<project-ref>.supabase.co`), `VITE_SUPABASE_ANON_KEY` (publishable key), `VITE_VAPID_PUBLIC_KEY` | `.env.example` |
| `.env.test` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD` (quote it), `ACTION_TOKEN_KEY`, `CRON_SECRET` | none; see names here |
| `supabase/functions/.env` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`, `ACTION_TOKEN_KEY` | `supabase/functions/.env.example` |

Never commit real values.

### Run

```sh
npm run dev
```

### Tests

```sh
npm test
```

```sh
npm run test:int
```

Hits the TEST project.

```sh
npm run test:e2e
```

Chromium only.

```sh
npx supabase db reset --linked --yes
```

**WARNING: TEST ONLY. This wipes the linked project. Never run it against prod.**

CI (`.github/workflows/ci.yml`) runs on pull requests and on pushes to `main` (the repo is public, so Actions minutes are free). It lints, type-checks, runs unit tests and builds. Integration and e2e tests need secrets, so run them locally. The required status check is "Lint, test, build". Deploy to GitHub Pages happens on merge to `main`.

Branch and tag protection:

- `main`: PR required, no force-push or deletion, squash or merge commits, stale reviews dismissed, conversations resolved, required check "Lint, test, build" (strict: branch must be up to date).
- Tags `v*`: admins only.

## Deploy (owner)

Pre-deploy security checklist:
- [ ] `anon` / `authenticated` have no SELECT on `net.http_request_queue` or `net._http_response`.
- [ ] Prod secrets (VAPID keys, `ACTION_TOKEN_KEY`, `CRON_SECRET`) are new and distinct from local/test ones.

Steps (use a separate prod Supabase project; the free plan allows 2 projects, see GitHub issue #10):

1. Link the project
   ```sh
   npx supabase link
   ```
2. Apply migrations
   ```sh
   npx supabase db push
   ```
3. Generate VAPID keys, then set Edge Function secrets. Generate with:
   ```sh
   npx web-push generate-vapid-keys
   ```
   The public key goes in `VAPID_PUBLIC_KEY` (secrets below) and in `VITE_VAPID_PUBLIC_KEY` (Vercel env, step 7). The private key goes only in `VAPID_PRIVATE_KEY` (secrets below); never commit it or put it in a `VITE_` variable. `ACTION_TOKEN_KEY` and `CRON_SECRET` are new random values.
   ```sh
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... CRON_SECRET=... ACTION_TOKEN_KEY=...
   ```
4. Deploy functions
   ```sh
   npx supabase functions deploy
   ```
5. Create the Vault secrets in the SQL editor of the PROD project only (placeholders below; `<new-random-secret>` must equal the `CRON_SECRET` set in step 3). The cron `send-reminders` job is a no-op until both exist.
   ```sql
   select vault.create_secret('<https://project-ref.supabase.co>', 'project_url');
   select vault.create_secret('<new-random-secret>', 'cron_secret');
   ```
6. Dashboard: turn ON email confirmation and anonymous sign-ins. Set Site URL and redirect URLs to the Vercel domain (`createProfile` redirects to `${origin}/settings?finish=1`).
7. Vercel: import the repo, set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`. `vercel.json` handles the SPA rewrite and `sw.js` no-cache header.

From the first prod deploy, migrations are append-only: change schema or cron only via a NEW migration.

## Deploy to GitHub Pages

Served at `https://danhquach.github.io/medtracker/` (sub-path build via `VITE_BASE=/medtracker/`; local dev and tests stay at `/`).

1. The repo must be public (GitHub Pages on the free plan).
2. Settings > Pages > Source: GitHub Actions.
3. Settings > Secrets and variables > Actions > Variables: add `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`. These are public values baked into the bundle; the build fails early if any is empty.
4. Supabase Auth: set Site URL to `https://danhquach.github.io/medtracker/` and add `https://danhquach.github.io/medtracker/**` to Redirect URLs (wildcard so `settings?finish=1` matches).
5. Reminders need the Vault secrets (see Deploy steps 3 and 5) on whichever Supabase project the build points at.
6. Merge to `main` (or run the "CI" workflow manually on `main`); the "Deploy to GitHub Pages" job publishes after the checks pass. The Pages build fails early if a variable is empty; PR builds use base `/` and need no variables. `build:pages` copies `index.html` to `404.html` (SPA fallback) and adds `.nojekyll`.

## Troubleshooting reminders

Reminders not arriving:
- Supabase dashboard > Edge Functions > `send-reminders` > Logs. The function returns HTTP 500 (with the run counts as JSON) when any send/claim step errored, 200 otherwise.
- Cron-side view of recent calls (SQL editor):
  ```sql
  select status_code, content from net._http_response order by created desc limit 20;
  ```
  `401` = `cron_secret` Vault value differs from the `CRON_SECRET` function secret; `500` = misconfigured secrets or errors in the run; no rows = Vault secrets missing or cron job not scheduled.
- Doses more than 12 hours overdue are intentionally not sent.

## Installing the app

- **Android (Chrome):** menu > Add to Home screen / Install app, then enable notifications.
  - Reminders late? In Android settings, set Chrome's battery use to Unrestricted.
- **iOS:** push works only after Add to Home Screen (Safari share sheet) and needs iOS 16.4+. Enable push once from inside the installed app.

## Known risks

- Android battery optimization can delay pushes (tip above).
- iOS requires Home Screen install + iOS 16.4+.
- Supabase free projects pause after about a week idle; open the dashboard to restore.
- Per-minute cron is about 43k function calls/month. Verify against the current free quota. Fallback: change the schedule to `*/5 * * * *` (in `0007_cron.sql` before prod exists; via a NEW migration after).

## Manual device checklist

1. Install from Chrome (Android).
2. Enable notifications.
3. Add a med due in 2 minutes.
4. Close the app; notification arrives.
5. Tap "Taken"; the laptop view shows taken and stock decremented.
6. Turn the device toggle off; the next dose sends no push to the phone while the laptop (if enabled) still gets one.
7. Guest > create profile keeps data; verify the email-confirmation path on prod settings.
8. Enable push once on Safari/iOS (Home Screen install).

## Tracking

GitHub issues #1-#10 (labels: security, hardening, polish, tests, tooling, ops).
