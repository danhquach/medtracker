# MedTracker

[![CI](https://github.com/danhquach/medtracker/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/danhquach/medtracker/actions/workflows/ci.yml)
[![Live app](https://img.shields.io/badge/live-danhquach.github.io%2Fmedtracker-2ea44f)](https://danhquach.github.io/medtracker/)

**Open the app:** https://danhquach.github.io/medtracker/ (no install needed; start as a guest or sign in. To get reminders, install it to your home screen, see [Installing the app](#installing-the-app)). The live app uses the production Supabase project.

Medication reminder PWA. Vite + React + TypeScript; Supabase (Postgres + RLS, SQL functions, `pg_cron` + `pg_net`, Vault, Edge Functions `send-reminders` / `dose-action` / `delete-account`); Web Push (VAPID). Migrations `0001`-`0007` live in `supabase/migrations`.

## Local setup

There is one hosted Supabase project and it is **PRODUCTION** (GitHub issue #10). `npm run dev` with `.env.local` reads and writes production data. A separate test project or local Docker setup comes later.

```sh
npm install
```

Production auth settings: anonymous sign-ins ON (guest mode), email confirmation ON.

### Environment files (all gitignored)

| File | Variables | Template |
|---|---|---|
| `.env.local` | `VITE_SUPABASE_URL` (`https://<project-ref>.supabase.co`), `VITE_SUPABASE_ANON_KEY` (publishable key), `VITE_VAPID_PUBLIC_KEY` | `.env.example` |
| `.env.test` | `SUPABASE_ENV` (`test` only for a dedicated test project), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_DB_PASSWORD` (quote it), `ACTION_TOKEN_KEY`, `CRON_SECRET` | none; see names here |
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

Integration and e2e tests create and delete users. They refuse to run unless `.env.test` sets `SUPABASE_ENV=test`. Set that only when `.env.test` points at a dedicated test project, never at production.

```sh
npm run test:e2e
```

Chromium only.

```sh
npx supabase db reset --linked --yes
```

**WARNING: this wipes the linked project. The linked project is production, so do not run it until a separate test project exists.**

## Workflow

Every change reaches `main` through a pull request; never push or `git merge` to `main` directly.

1. Pick or file a GitHub issue. Titles start with `MT-<issue number>: `.
2. Branch from the latest `origin/main`.
3. Run `npm run lint`, `npx tsc --noEmit -p tests`, `npm test` and `npm run build` (which also type-checks `src`) locally; also run `npm run test:int` / `npm run test:e2e` when the change touches Supabase or user flows (see Tests).
4. Open a PR against `main`. CI runs on it.
5. Merge only when all green: review findings resolved, CI passes, and the issue's acceptance criteria are met. Squash or merge commit; auto-merge is allowed and does the same check. GitHub enforces only CI and resolved review threads; no approval is required, so checking the findings and acceptance criteria is up to whoever merges.
6. The merge to `main` reruns CI and deploys to GitHub Pages.

CI (`.github/workflows/ci.yml`, [runs](https://github.com/danhquach/medtracker/actions/workflows/ci.yml)) runs on pull requests, on pushes to `main` and manually (`workflow_dispatch`); the repo is public, so Actions minutes are free.

- **Lint, unit, build:** `npm ci`, lint, type-check (`src` and `tests`), unit tests, build. On `main` it builds for Pages (`build:pages`, base `/medtracker/`) and uploads the artifact. PRs build with base `/`, so a problem that shows only under `/medtracker/` (asset paths, router, service worker scope) first appears on the live site after merge.
- **Lint, test, build:** the required status check; passes only when the build job succeeded.
- **Deploy to GitHub Pages:** `main` only, after the check passes.

Integration and e2e tests need secrets, so CI does not run them; run them locally.

"Update behind PRs" (`.github/workflows/update-behind-prs.yml`) runs on each push to `main`. Because `main` requires PR branches to be up to date, it merges `main` into every open PR that has auto-merge on, which reruns CI and lets auto-merge finish. It needs the repo secret `AUTO_UPDATE_TOKEN`: a fine-grained PAT for this repo with Contents and Pull requests read/write (a `GITHUB_TOKEN` push would not trigger CI). PRs without auto-merge must be updated by hand ("Update branch").

Branch and tag protection (rulesets):

- `main` (`protect-main`): PR required, no force-push or deletion, squash or merge commits, stale reviews dismissed, conversations resolved, required check "Lint, test, build" (strict: branch must be up to date).
- Tags `v*` (`protect-release-tags`): admins only.

## Deploy (owner)

Pre-deploy security checklist:
- [ ] `anon` / `authenticated` have no SELECT on `net.http_request_queue` or `net._http_response`.
- [ ] Prod secrets (VAPID keys, `ACTION_TOKEN_KEY`, `CRON_SECRET`) are new and distinct from local/test ones.

Steps (the existing project is production, see GitHub issue #10; check each step against it, since some were done while it was the test project):

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
   The public key goes in `VAPID_PUBLIC_KEY` (secrets below) and in `VITE_VAPID_PUBLIC_KEY` (Actions variable, step 7). The private key goes only in `VAPID_PRIVATE_KEY` (secrets below); never commit it or put it in a `VITE_` variable. `ACTION_TOKEN_KEY` and `CRON_SECRET` are new random values.
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
6. Dashboard: turn ON email confirmation and anonymous sign-ins. Set Site URL and redirect URLs to the GitHub Pages URL (see Deploy to GitHub Pages, step 4; `createProfile` redirects to `${origin}/settings?finish=1`).
7. Frontend: follow Deploy to GitHub Pages below. `vercel.json` is left over from an earlier Vercel setup; Pages does not use it.

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

## Daylight saving

Dose times follow the profile's time zone (`0013_time_zones.sql`; the offline client matches it):

- A time skipped when clocks spring forward moves forward by the gap: 02:30 becomes 03:30.
- A time that happens twice when clocks fall back is the second one, after the change.
- A med has one dose per instant, so 02:00 and 03:00 on a spring-forward day give one dose that day.
- Auto-detect adopts a device's zone only until a zone is set; after that, only Settings changes it.

## Known risks

- Android battery optimization can delay pushes (tip above).
- iOS requires Home Screen install + iOS 16.4+.
- Supabase free projects pause after about a week idle; open the dashboard to restore. The "Keep Supabase awake" workflow (`.github/workflows/keep-alive.yml`) pings the REST API daily to prevent this. GitHub disables scheduled workflows after 60 days without repo activity; re-enable it in the Actions tab if that happens.
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

GitHub issues, titled `MT-<issue number>: ...` ([open issues](https://github.com/danhquach/medtracker/issues)). Labels include security, hardening, polish, tests, tooling, ops, bug, enhancement, accessibility and documentation.
