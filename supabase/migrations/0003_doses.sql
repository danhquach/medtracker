-- Dose generation, missed rollover, status changes.
-- All functions are security invoker (RLS applies to signed-in callers; cron runs as postgres).

-- Insert pending doses for [p_from, p_to] (local dates in each user's time zone). p_user null = all users.
create function public.generate_doses_for(p_user uuid, p_from date, p_to date) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  insert into public.dose_events (user_id, medication_id, scheduled_for)
  select m.user_id, m.id, (d.d + t.t) at time zone p.time_zone
  from public.medications m
  join public.profiles p on p.user_id = m.user_id
  join public.schedules s on s.medication_id = m.id and s.user_id = m.user_id
  cross join lateral generate_series(p_from, p_to, interval '1 day') as g(ts)
  cross join lateral (select g.ts::date as d) d
  cross join lateral unnest(s.times) as t(t)
  where (p_user is null or m.user_id = p_user)
    and not m.paused
    and s.kind <> 'prn'
    and (s.start_date is null or d.d >= s.start_date)
    and (s.end_date is null or d.d <= s.end_date)
    and (
      s.kind = 'daily'
      or (s.kind = 'weekdays' and extract(isodow from d.d)::int = any (s.weekdays))
      or (s.kind = 'interval' and s.start_date is not null and s.interval_days > 0
          and (d.d - s.start_date) % s.interval_days = 0)
    )
  on conflict (medication_id, scheduled_for) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Today and tomorrow in each user's own time zone.
create function public.generate_doses(p_user uuid default null) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  r record;
  total int := 0;
  today date;
begin
  for r in
    select user_id, time_zone from public.profiles where p_user is null or user_id = p_user
  loop
    today := (now() at time zone r.time_zone)::date;
    total := total + public.generate_doses_for(r.user_id, today, today + 1);
  end loop;
  return total;
end;
$$;

create function public.regenerate_future_doses(p_med uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  owner uuid;
begin
  select user_id into owner from public.medications where id = p_med;
  if owner is null then
    return;
  end if;
  delete from public.dose_events
  where medication_id = p_med and status = 'pending' and notified_at is null and scheduled_for > now();
  perform public.generate_doses(owner);
end;
$$;

create function public.regenerate_user_doses() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.dose_events
  where user_id = auth.uid() and status = 'pending' and notified_at is null and scheduled_for > now();
  perform public.generate_doses(auth.uid());
end;
$$;

create function public.mark_missed() returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  update public.dose_events de
  set status = 'missed'
  from public.profiles p
  where p.user_id = de.user_id
    and de.status = 'pending'
    and (de.scheduled_for at time zone p.time_zone)::date < (now() at time zone p.time_zone)::date;
  get diagnostics n = row_count;
  return n;
end;
$$;

create function public.set_dose_status(p_dose uuid, p_status text) returns public.dose_events
language plpgsql security invoker set search_path = '' as $$
declare
  d public.dose_events;
  units numeric;
begin
  if p_status not in ('taken', 'skipped', 'pending') then
    raise exception 'invalid target status: %', p_status using errcode = '22023';
  end if;

  select * into d from public.dose_events where id = p_dose for update;
  if not found then
    return null;
  end if;

  if d.status = p_status then
    return d; -- no-op (taken -> taken etc.)
  end if;

  select units_per_dose into units from public.medications where id = d.medication_id;

  if p_status = 'taken' then
    update public.medications set stock = greatest(stock - units, 0)
    where id = d.medication_id and stock is not null;
  elsif d.status = 'taken' then
    update public.medications set stock = stock + units
    where id = d.medication_id and stock is not null;
  end if;

  update public.dose_events
  set status = p_status,
      acted_at = case when p_status = 'pending' then null else now() end
  where id = p_dose
  returning * into d;
  return d;
end;
$$;

create function public.log_prn_dose(p_med uuid) returns public.dose_events
language plpgsql security invoker set search_path = '' as $$
declare
  m public.medications;
  d public.dose_events;
begin
  select * into m from public.medications where id = p_med for update;
  if not found then
    return null;
  end if;

  insert into public.dose_events (user_id, medication_id, scheduled_for, status, acted_at)
  values (m.user_id, m.id, now(), 'taken', now())
  returning * into d;

  update public.medications set stock = greatest(stock - m.units_per_dose, 0)
  where id = m.id and stock is not null;
  return d;
end;
$$;

-- Signed-in users only (Supabase default privileges grant anon explicitly).
revoke execute on function public.generate_doses_for(uuid, date, date) from public, anon;
revoke execute on function public.generate_doses(uuid) from public, anon;
revoke execute on function public.regenerate_future_doses(uuid) from public, anon;
revoke execute on function public.regenerate_user_doses() from public, anon;
revoke execute on function public.mark_missed() from public, anon;
revoke execute on function public.set_dose_status(uuid, text) from public, anon;
revoke execute on function public.log_prn_dose(uuid) from public, anon;

grant execute on function public.generate_doses_for(uuid, date, date) to authenticated;
grant execute on function public.generate_doses(uuid) to authenticated;
grant execute on function public.regenerate_future_doses(uuid) to authenticated;
grant execute on function public.regenerate_user_doses() to authenticated;
grant execute on function public.mark_missed() to authenticated;
grant execute on function public.set_dose_status(uuid, text) to authenticated;
grant execute on function public.log_prn_dose(uuid) to authenticated;
