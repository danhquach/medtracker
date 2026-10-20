-- MT-14: time zone and daylight-saving edge cases.
--
-- How a dose time maps to an instant (Postgres `(date + time) at time zone tz`, mirrored by the
-- client's localWallTimeUtc):
--   * Spring forward (gap): a time that does not exist moves forward by the gap.
--     02:30 on 2027-03-14 in America/Toronto is 03:30 EDT.
--   * Fall back (fold): a time that happens twice is the later one (after the clocks go back).
--     01:30 on 2027-11-07 in America/Toronto is 01:30 EST.
--   * A med has at most one dose per instant, so two times that land on the same instant on a
--     gap day (02:00 and 03:00 in Toronto) give one dose that day.

-- Days are counted with integers: a date series built from timestamps follows the session time
-- zone and can lose a day where midnight is skipped (America/Santiago drops one in September).
create or replace function public.generate_doses_for(
  p_user uuid, p_from date, p_to date, p_after timestamptz default '-infinity',
  p_med uuid default null, p_skip_times time[] default '{}'
) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  insert into public.dose_events (user_id, medication_id, scheduled_for, notified_at)
  select m.user_id, m.id, x.due, case when x.due <= now() then now() end
  from public.medications m
  join public.profiles p on p.user_id = m.user_id
  join public.schedules s on s.medication_id = m.id and s.user_id = m.user_id
  cross join lateral generate_series(0, p_to - p_from) as g(i)
  cross join lateral (select p_from + g.i as d) d
  cross join lateral unnest(s.times) as t(t)
  cross join lateral (select (d.d + t.t) at time zone p.time_zone as due) x
  where (p_user is null or m.user_id = p_user)
    and (p_med is null or m.id = p_med)
    and not (t.t = any (coalesce(p_skip_times, '{}')))
    and x.due > p_after
    and not m.paused
    and s.kind <> 'prn'
    and (s.start_date is null or d.d >= s.start_date)
    and (s.end_date is null or d.d <= s.end_date)
    and (
      s.kind = 'daily'
      or (s.kind = 'weekdays' and extract(isodow from d.d)::int = any (s.weekdays))
      or (s.kind = 'interval' and s.start_date is not null and s.interval_days > 0
          and (d.d - s.start_date) % nullif(s.interval_days, 0) = 0)
    )
  on conflict (medication_id, scheduled_for) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- As 0003, but the time zone list is read once per call (`in (select ...)` is a hashed subplan),
-- not once per profile.
create or replace function public.generate_doses(p_user uuid default null) returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  total int := 0;
  today date;
  target uuid := case when auth.uid() is null then p_user else auth.uid() end;
begin
  if target is null and coalesce(auth.role(), '') = 'authenticated' then
    raise exception 'all-users generation is not permitted for signed-in callers' using errcode = '42501';
  end if;
  for r in
    select p.user_id, p.time_zone
    from public.profiles p
    where (target is null or p.user_id = target)
      and p.time_zone in (select z.name from pg_catalog.pg_timezone_names z)
  loop
    if target is not null then
      today := (now() at time zone r.time_zone)::date;
      total := total + public.generate_doses_for(r.user_id, today, today + 1, now());
    else
      begin
        today := (now() at time zone r.time_zone)::date;
        total := total + public.generate_doses_for(r.user_id, today, today + 1, now());
      exception when others then
        raise warning 'generate_doses skipped user %: %', r.user_id, sqlerrm;
      end;
    end if;
  end loop;
  return total;
end;
$$;

-- As 0003, but the time zone list is read once per call, not once per dose.
create or replace function public.mark_missed() returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  update public.dose_events de
  set status = 'missed'
  from public.profiles p
  where p.user_id = de.user_id
    and de.status = 'pending'
    and (de.snoozed_until is null or de.snoozed_until <= now())
    and p.time_zone in (select z.name from pg_catalog.pg_timezone_names z)
    and (de.scheduled_for at time zone p.time_zone)::date < (now() at time zone p.time_zone)::date;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Whether the user (or a first auto-detect) has set the zone. Kept on the profile, not per device,
-- so a new device never replaces a zone that was set on purpose. Any zone other than the signup
-- default was set by someone; a profile still on the default may never have been.
alter table public.profiles add column time_zone_chosen bool not null default false;
update public.profiles set time_zone_chosen = true where time_zone <> 'America/Toronto';

-- As 0012; any patch that names a zone (even the current one) marks it chosen.
create or replace function public.update_profile(p_patch jsonb) returns public.profiles
language plpgsql security invoker set search_path = '' as $$
declare
  before_tz text;
  p public.profiles;
begin
  select time_zone into before_tz from public.profiles where user_id = auth.uid();
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  update public.profiles set
    nickname = case when p_patch ? 'nickname' then p_patch->>'nickname' else nickname end,
    time_zone = case when p_patch ? 'time_zone' then p_patch->>'time_zone' else time_zone end,
    time_zone_chosen = time_zone_chosen or p_patch ? 'time_zone',
    snooze_minutes = case when p_patch ? 'snooze_minutes' then (p_patch->>'snooze_minutes')::int else snooze_minutes end,
    suggestions_enabled = case when p_patch ? 'suggestions_enabled'
      then (p_patch->>'suggestions_enabled')::bool else suggestions_enabled end
  where user_id = auth.uid()
  returning * into p;
  if p.time_zone is distinct from before_tz then
    perform public.regenerate_user_doses();
  end if;
  return p;
end;
$$;

grant update (time_zone_chosen) on public.profiles to authenticated;
