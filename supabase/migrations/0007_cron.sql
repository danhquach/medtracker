-- Scheduled jobs (pg_cron) and the HTTP trigger for send-reminders (pg_net).
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Posts to the send-reminders Edge Function. URL and shared secret come from Vault secrets
-- `project_url` and `cron_secret` (set per environment by the owner, never in a migration).
-- Missing secret = no-op, so environments without them (local, TEST) never post to a null URL.
create function public.cron_send_reminders() returns void
language plpgsql security definer set search_path = '' as $$
declare
  project_url text;
  cron_secret text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'cron_secret';
  if project_url is null or cron_secret is null then
    return;
  end if;
  perform net.http_post(
    url := project_url || '/functions/v1/send-reminders',
    headers := jsonb_build_object('x-cron-secret', cron_secret, 'content-type', 'application/json'),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.cron_send_reminders() from public, anon, authenticated;

-- Deletes anonymous guests unseen for 90 days (profiles cascade). Owned by postgres, which can
-- delete from auth.users on hosted Supabase (verified with has_table_privilege).
create function public.purge_stale_guests() returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  delete from auth.users u
  using public.profiles p
  where p.user_id = u.id
    and u.is_anonymous
    and p.last_seen_at < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.purge_stale_guests() from public, anon, authenticated;

select cron.schedule('send-reminders', '* * * * *', $$select public.cron_send_reminders()$$);
select cron.schedule('generate-doses', '*/15 * * * *', $$select public.generate_doses()$$);
select cron.schedule('mark-missed', '*/15 * * * *', $$select public.mark_missed()$$);
select cron.schedule('purge-stale-guests', '0 3 1 * *', $$select public.purge_stale_guests()$$);
