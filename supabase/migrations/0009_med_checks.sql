-- Reject nonsense schedule and stock values at the database, whatever client writes them.
-- Fails (and rolls back) if existing rows already violate a rule.
alter table public.medications
  add constraint units_per_dose_positive check (units_per_dose > 0),
  add constraint stock_not_negative check (stock >= 0);

alter table public.schedules
  add constraint weekdays_iso check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]),
  add constraint weekdays_required check (kind <> 'weekdays' or coalesce(cardinality(weekdays), 0) > 0),
  add constraint interval_days_positive check (interval_days > 0),
  add constraint interval_days_required check (kind <> 'interval' or interval_days is not null);

-- Keep medications.updated_at current on every update, not only when the RPCs remember to.
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger medications_touch_updated_at
  before update on public.medications
  for each row execute function public.touch_updated_at();

-- Trigger-only; nobody should call it directly.
revoke all on function public.touch_updated_at() from public, anon, authenticated;
