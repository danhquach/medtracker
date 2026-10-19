-- Reminder claiming and snooze.

-- Atomically claim due doses for sending: concurrent runs never claim the same dose.
-- Re-checks notify/paused at claim time; at most p_limit per call (backlog drains on later runs).
-- Service role / cron only.
create function public.claim_due_doses(p_limit int default 50)
returns table (
  dose_id uuid, user_id uuid, medication_id uuid, med_name text, strength text, scheduled_for timestamptz,
  due_at timestamptz
)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select de.id, coalesce(de.snoozed_until, de.scheduled_for) as due_at
    from public.dose_events de
    join public.medications m on m.id = de.medication_id and m.user_id = de.user_id
    where de.status = 'pending'
      and m.notify
      and not m.paused
      and ((de.notified_at is null and de.scheduled_for <= now()) or de.snoozed_until <= now())
    order by de.scheduled_for
    limit greatest(p_limit, 0)
    for update of de skip locked
  ),
  upd as (
    update public.dose_events de
    set notified_at = now(), snoozed_until = null
    from due
    where de.id = due.id
    returning de.id, de.user_id, de.medication_id, de.scheduled_for, due.due_at
  )
  select upd.id, upd.user_id, upd.medication_id, m.name, m.strength, upd.scheduled_for, upd.due_at
  from upd
  join public.medications m on m.id = upd.medication_id
  order by upd.scheduled_for;
end;
$$;

-- Security invoker: RLS applies when a user calls it. dose-action calls it with the service role
-- after verifying the action token. Returns null when the dose is missing or not pending.
create function public.snooze_dose(p_dose uuid, p_minutes int) returns public.dose_events
language plpgsql security invoker set search_path = '' as $$
declare
  d public.dose_events;
begin
  if p_minutes is null or p_minutes not in (5, 10, 15, 30, 60) then
    raise exception 'invalid snooze minutes: %', p_minutes using errcode = '22023';
  end if;
  update public.dose_events
  set snoozed_until = now() + make_interval(mins => p_minutes)
  where id = p_dose and status = 'pending'
  returning * into d;
  return d;
end;
$$;

-- Give claimed doses back to the queue after a transient send failure (notified_at null + scheduled_for
-- in the past makes them due again). A snooze the user set during the send window is kept. Service role only.
create function public.unclaim_doses(p_ids uuid[]) returns int
language plpgsql security invoker set search_path = '' as $$
declare
  n int;
begin
  update public.dose_events
  set notified_at = null
  where id = any (p_ids) and status = 'pending'
    and (snoozed_until is null or snoozed_until <= now());
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.claim_due_doses(int) from public, anon, authenticated;
revoke execute on function public.unclaim_doses(uuid[]) from public, anon, authenticated;
revoke execute on function public.snooze_dose(uuid, int) from public, anon;
grant execute on function public.snooze_dose(uuid, int) to authenticated;
