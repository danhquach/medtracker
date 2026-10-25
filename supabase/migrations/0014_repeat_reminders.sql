-- MT-79: a dose reminder nobody answers rings again every Snooze length, at most 5 more times.
--
-- reminder_repeats: repeats sent since the last reminder at the dose time or after a snooze.
-- Null = no reminder was ever claimed for this dose (backfilled or undone doses get notified_at
-- set without a reminder), so those never start repeating.
alter table public.dose_events add column reminder_repeats int;

-- Same as 0004 plus a third way to be due: the last reminder (notified_at) is a Snooze length old,
-- nothing is snoozed, and fewer than 5 repeats were sent. due_at for a repeat is when it fell due,
-- so send-reminders' one-hour retry bound applies to it too. unclaim_doses is unchanged: it clears
-- notified_at, and the re-claim below keeps the count, so a failed repeat is retried, not lost.
create or replace function public.claim_due_doses(p_limit int default 50)
returns table (
  dose_id uuid, user_id uuid, medication_id uuid, med_name text, strength text, scheduled_for timestamptz,
  due_at timestamptz
)
language plpgsql security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select de.id,
      case
        when de.snoozed_until <= now() then 'snooze'
        when de.notified_at is null then 'first'
        else 'repeat'
      end as kind,
      case
        when de.snoozed_until <= now() or de.notified_at is null then coalesce(de.snoozed_until, de.scheduled_for)
        else de.notified_at + make_interval(mins => p.snooze_minutes)
      end as due_at
    from public.dose_events de
    join public.medications m on m.id = de.medication_id and m.user_id = de.user_id
    join public.profiles p on p.user_id = de.user_id
    where de.status = 'pending'
      and m.notify
      and not m.paused
      and coalesce(de.snoozed_until, de.scheduled_for) > now() - interval '12 hours'
      and ((de.notified_at is null and de.scheduled_for <= now())
        or de.snoozed_until <= now()
        or (de.snoozed_until is null and de.reminder_repeats < 5
          and de.notified_at + make_interval(mins => p.snooze_minutes) <= now()))
    order by de.scheduled_for
    limit greatest(p_limit, 0)
    for update of de skip locked
  ),
  upd as (
    update public.dose_events de
    set notified_at = now(),
      snoozed_until = null,
      reminder_repeats = case due.kind
        when 'snooze' then 0
        when 'first' then coalesce(de.reminder_repeats, 0)
        else de.reminder_repeats + 1
      end
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

revoke execute on function public.claim_due_doses(int) from public, anon, authenticated;

-- Once a dose is answered (taken, skipped, missed) its repeats are over: an undo back to pending
-- keeps notified_at to stay quiet (0012), and must not restart the repeats either.
create function public.end_reminder_repeats() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status <> 'pending' then
    new.reminder_repeats := null;
  end if;
  return new;
end;
$$;

create trigger dose_events_end_reminder_repeats
  before update of status on public.dose_events
  for each row execute function public.end_reminder_repeats();

-- Trigger-only; nobody should call it directly.
revoke all on function public.end_reminder_repeats() from public, anon, authenticated;
