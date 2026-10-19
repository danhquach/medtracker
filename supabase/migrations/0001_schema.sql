create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  nickname text,
  time_zone text not null default 'America/Toronto',
  snooze_minutes int not null default 10 check (snooze_minutes in (5, 10, 15, 30, 60)),
  suggestions_enabled bool not null default true,
  last_seen_at timestamptz default now(),
  password_set bool default false
);

create table public.medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  name text not null,
  strength text,
  form text check (form in ('tablet', 'capsule', 'liquid', 'other')),
  notes text,
  units_per_dose numeric not null default 1,
  stock numeric,
  refill_threshold_days int,
  notify bool not null default true,
  paused bool not null default false,
  refill_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  medication_id uuid not null references public.medications on delete cascade,
  kind text not null check (kind in ('daily', 'weekdays', 'interval', 'prn')),
  times time[],
  weekdays int[],
  interval_days int,
  start_date date,
  end_date date
);

create table public.dose_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  medication_id uuid not null references public.medications on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'taken', 'skipped', 'missed')),
  acted_at timestamptz,
  notified_at timestamptz,
  snoozed_until timestamptz,
  unique (medication_id, scheduled_for)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device_label text,
  enabled bool not null default true,
  created_at timestamptz not null default now()
);

create index on public.medications (user_id);
create index on public.schedules (user_id);
create index on public.schedules (medication_id);
create index on public.dose_events (user_id);
create index on public.push_subscriptions (user_id);

-- Auto-create a profile for every new auth user (including anonymous guests).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
