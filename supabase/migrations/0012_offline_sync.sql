-- Offline sync: the app queues changes made without a connection and replays them later, possibly
-- twice when a response is lost. Every RPC the queue sends is therefore safe to repeat, and takes
-- the time the user acted (clamped to the last 7 days, never the future) instead of now().
-- Nothing here changes the online behavior of existing callers: new parameters all default to it.

create function public.clamp_client_time(p_at timestamptz) returns timestamptz
language sql stable set search_path = '' as $$
  select least(greatest(coalesce(p_at, now()), now() - interval '7 days'), now())
$$;

-- Ops already applied, for RPCs that are not naturally idempotent (add_stock).
create table public.applied_ops (
  op_id uuid primary key,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.applied_ops enable row level security;
create policy owner_all on public.applied_ops for all using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.applied_ops from anon;

-- set_dose_status: as in 0003, with the client's action time.
drop function public.set_dose_status(uuid, text);
create function public.set_dose_status(p_dose uuid, p_status text, p_acted_at timestamptz default null)
returns public.dose_events
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
      acted_at = case when p_status = 'pending' then null else public.clamp_client_time(p_acted_at) end,
      snoozed_until = case when p_status in ('taken', 'skipped') then null else snoozed_until end,
      notified_at = case
        when p_status = 'pending' and scheduled_for <= now() then coalesce(notified_at, now())
        else notified_at
      end
  where id = p_dose
  returning * into d;
  return d;
end;
$$;

-- By (med, time) instead of id: regeneration replaces pending dose ids, so a queued id can go stale.
create function public.set_dose_status_at(
  p_med uuid, p_scheduled_for timestamptz, p_status text, p_acted_at timestamptz default null
) returns public.dose_events
language plpgsql security invoker set search_path = '' as $$
declare
  dose_id uuid;
begin
  select id into dose_id from public.dose_events
  where medication_id = p_med and scheduled_for = p_scheduled_for and user_id = auth.uid();
  if dose_id is null then
    return null;
  end if;
  return public.set_dose_status(dose_id, p_status, p_acted_at);
end;
$$;

-- log_prn_dose: a client id makes a replay return the first row without touching stock again.
drop function public.log_prn_dose(uuid);
create function public.log_prn_dose(p_med uuid, p_id uuid default null, p_at timestamptz default null)
returns public.dose_events
language plpgsql security invoker set search_path = '' as $$
declare
  m public.medications;
  d public.dose_events;
  t timestamptz := public.clamp_client_time(p_at);
begin
  select * into m from public.medications where id = p_med for update;
  if not found then
    return null;
  end if;

  if p_id is not null then
    select * into d from public.dose_events where id = p_id;
    if found then
      return d;
    end if;
  end if;

  insert into public.dose_events (id, user_id, medication_id, scheduled_for, status, acted_at)
  values (coalesce(p_id, gen_random_uuid()), m.user_id, m.id, t, 'taken', t)
  returning * into d;

  update public.medications set stock = greatest(stock - m.units_per_dose, 0)
  where id = m.id and stock is not null;
  return d;
end;
$$;

-- add_stock: as in 0010; with p_op, a repeat of the same op returns the stock unchanged.
drop function public.add_stock(uuid, numeric);
create function public.add_stock(p_med uuid, p_qty numeric, p_op uuid default null) returns numeric
language plpgsql security invoker set search_path = '' as $$
declare
  result numeric;
begin
  if p_qty is null or not (p_qty > 0 and p_qty < 'Infinity') then
    raise exception 'quantity must be greater than 0' using errcode = '22023';
  end if;
  if p_op is not null then
    insert into public.applied_ops (op_id, user_id) values (p_op, auth.uid()) on conflict do nothing;
    if not found then
      select stock into result from public.medications where id = p_med and user_id = auth.uid();
      if not found then
        raise exception 'medication not found' using errcode = 'P0002';
      end if;
      return result;
    end if;
  end if;
  update public.medications set stock = coalesce(stock, 0) + p_qty, updated_at = now()
  where id = p_med and user_id = auth.uid()
  returning stock into result;
  if not found then
    raise exception 'medication not found' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

-- save_med: as in 0011. p_create with a client id inserts that id; a replay of the same create
-- returns it unchanged. Without p_create a given id stays update-only (P0002 if gone).
drop function public.save_med(jsonb, jsonb);
create function public.save_med(p_med jsonb, p_schedules jsonb, p_create boolean default false) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  med_id uuid := nullif(p_med->>'id', '')::uuid;
  uid uuid := auth.uid();
  s jsonb;
  old_times time[];
  owner text;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if med_id is null or p_create then
    if med_id is not null then
      -- RLS hides other users' rows, so ask without it whether the id is taken.
      owner := public.medication_owner(med_id);
      if owner = 'mine' then
        return med_id; -- replay of a create that already landed
      elsif owner = 'other' then
        raise exception 'medication id belongs to another user' using errcode = '42501';
      end if;
    end if;
    insert into public.medications (id, user_id, name, strength, form, notes, units_per_dose, stock, refill_threshold_days, notify)
    values (
      coalesce(med_id, gen_random_uuid()), uid, p_med->>'name', p_med->>'strength', p_med->>'form', p_med->>'notes',
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

-- Whose med id this is, regardless of RLS: 'mine', 'other', or null if unused. Never returns
-- the other user's id. save_med (security invoker) calls it, so authenticated may execute it.
create function public.medication_owner(p_med uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when m.user_id = auth.uid() then 'mine' else 'other' end
  from public.medications m where m.id = p_med
$$;

-- Pause/resume in one call (was a table update plus a separate regenerate RPC).
create function public.set_paused(p_med uuid, p_paused boolean) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  update public.medications set paused = p_paused, updated_at = now()
  where id = p_med and user_id = auth.uid();
  if not found then
    raise exception 'medication not found' using errcode = 'P0002';
  end if;
  perform public.regenerate_user_doses();
end;
$$;

-- Settings in one call; only the four user-editable columns (as 0008's column grant).
create function public.update_profile(p_patch jsonb) returns public.profiles
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

revoke execute on function public.clamp_client_time(timestamptz) from public, anon;
revoke execute on function public.medication_owner(uuid) from public, anon;
revoke execute on function public.set_dose_status(uuid, text, timestamptz) from public, anon;
revoke execute on function public.set_dose_status_at(uuid, timestamptz, text, timestamptz) from public, anon;
revoke execute on function public.log_prn_dose(uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.add_stock(uuid, numeric, uuid) from public, anon;
revoke execute on function public.save_med(jsonb, jsonb, boolean) from public, anon;
revoke execute on function public.set_paused(uuid, boolean) from public, anon;
revoke execute on function public.update_profile(jsonb) from public, anon;

grant execute on function public.clamp_client_time(timestamptz) to authenticated;
grant execute on function public.medication_owner(uuid) to authenticated;
grant execute on function public.set_dose_status(uuid, text, timestamptz) to authenticated;
grant execute on function public.set_dose_status_at(uuid, timestamptz, text, timestamptz) to authenticated;
grant execute on function public.log_prn_dose(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.add_stock(uuid, numeric, uuid) to authenticated;
grant execute on function public.save_med(jsonb, jsonb, boolean) to authenticated;
grant execute on function public.set_paused(uuid, boolean) to authenticated;
grant execute on function public.update_profile(jsonb) to authenticated;
