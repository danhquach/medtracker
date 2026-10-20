-- MT-39: adding a med, or adding a time to a med, now also creates today's doses whose time has
-- already passed, so the user can mark them Taken or Skip. Only save_med backfills: cron, app boot,
-- pause and time zone changes still create future doses only. Earlier days are never backfilled.
-- A backfilled dose is created with notified_at set, so no reminder is sent for it.

-- generate_doses_for gains p_med (limit to one med) and p_skip_times (times that get no dose).
-- Doses already due when created get notified_at = now() (normal runs use p_after = now(), so
-- they never create one).
drop function public.generate_doses_for(uuid, date, date, timestamptz);

create function public.generate_doses_for(
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
  cross join lateral generate_series(p_from, p_to, interval '1 day') as g(ts)
  cross join lateral (select g.ts::date as d) d
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

revoke execute on function public.generate_doses_for(uuid, date, date, timestamptz, uuid, time[])
  from public, anon, authenticated;

-- Today's already-passed doses for one of the caller's meds, except at p_skip_times.
-- Security definer to reach the internal generate_doses_for; only the med's owner may call it.
create function public.backfill_today_doses(p_med uuid, p_skip_times time[] default '{}') returns int
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid;
  tz text;
  today date;
begin
  select m.user_id, p.time_zone into owner, tz
  from public.medications m
  join public.profiles p on p.user_id = m.user_id
  where m.id = p_med;
  if owner is null or owner is distinct from auth.uid() then
    return 0;
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = tz) then
    return 0;
  end if;
  today := (now() at time zone tz)::date;
  return public.generate_doses_for(owner, today, today, '-infinity', p_med, p_skip_times);
end;
$$;

revoke execute on function public.backfill_today_doses(uuid, time[]) from public, anon;
grant execute on function public.backfill_today_doses(uuid, time[]) to authenticated;

-- save_med: as in 0010, plus the backfill. Times the med already had before this save are skipped,
-- so an edit that adds no time (or a med resumed after a pause) never brings back an earlier dose.
create or replace function public.save_med(p_med jsonb, p_schedules jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  med_id uuid := nullif(p_med->>'id', '')::uuid;
  uid uuid := auth.uid();
  s jsonb;
  old_times time[];
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if med_id is null then
    insert into public.medications (user_id, name, strength, form, notes, units_per_dose, stock, refill_threshold_days, notify)
    values (
      uid, p_med->>'name', p_med->>'strength', p_med->>'form', p_med->>'notes',
      (p_med->>'units_per_dose')::numeric, (p_med->>'stock')::numeric,
      (p_med->>'refill_threshold_days')::int, (p_med->>'notify')::bool
    )
    returning id into med_id;
  else
    update public.medications set
      name = p_med->>'name', strength = p_med->>'strength', form = p_med->>'form', notes = p_med->>'notes',
      units_per_dose = (p_med->>'units_per_dose')::numeric,
      stock = case when p_med ? 'stock' then (p_med->>'stock')::numeric else stock end,
      refill_threshold_days = (p_med->>'refill_threshold_days')::int, notify = (p_med->>'notify')::bool,
      updated_at = now()
    where id = med_id and user_id = uid;
    if not found then
      raise exception 'medication not found' using errcode = 'P0002';
    end if;
  end if;

  select coalesce(array_agg(distinct t.t), '{}') into old_times
  from public.schedules sc cross join lateral unnest(sc.times) as t(t)
  where sc.medication_id = med_id and sc.user_id = uid;

  delete from public.schedules where medication_id = med_id and user_id = uid;
  for s in select * from jsonb_array_elements(coalesce(p_schedules, '[]'::jsonb)) loop
    insert into public.schedules (user_id, medication_id, kind, times, weekdays, interval_days, start_date, end_date)
    values (
      uid, med_id, s->>'kind',
      array(select jsonb_array_elements_text(coalesce(s->'times', '[]'::jsonb)))::time[],
      case when jsonb_typeof(s->'weekdays') = 'array'
        then array(select jsonb_array_elements_text(s->'weekdays'))::int[] end,
      (s->>'interval_days')::int, (s->>'start_date')::date, (s->>'end_date')::date
    );
  end loop;

  perform public.regenerate_future_doses(med_id);
  perform public.backfill_today_doses(med_id, old_times);
  return med_id;
end;
$$;
