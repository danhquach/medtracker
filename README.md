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

CI: private repo with limited Actions minutes, so there are no workflows. Run tests locally.

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
3. Set Edge Function secrets
   ```sh
   npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:... CRON_SECRET=... ACTION_TOKEN_KEY=...
   ```
4. Deploy functions
   ```sh
   npx supabase functions deploy
   ```
5. Create Vault secrets `project_url` (`https://<project-ref>.supabase.co`) and `cron_secret` (same value as the `CRON_SECRET` above, a NEW value for prod). The cron `send-reminders` job is a no-op until both exist.
6. Dashboard: turn ON email confirmation and anonymous sign-ins. Set Site URL and redirect URLs to the Vercel domain (`createProfile` redirects to `${origin}/settings?finish=1`).
7. Vercel: import the repo, set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`. `vercel.json` handles the SPA rewrite and `sw.js` no-cache header.

From the first prod deploy, migrations are append-only: change schema or cron only via a NEW migration.

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
