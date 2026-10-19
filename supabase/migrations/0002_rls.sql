alter table public.profiles enable row level security;
alter table public.medications enable row level security;
alter table public.schedules enable row level security;
alter table public.dose_events enable row level security;
alter table public.push_subscriptions enable row level security;

create policy owner_all on public.profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.medications for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.schedules for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.dose_events for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy owner_all on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
