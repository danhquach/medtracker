-- Users may read their profile and edit their settings, nothing else. The row is created by the
-- auth.users trigger and removed only by the account-delete cascade; the bookkeeping columns
-- (last_seen_at, password_set) are written only through the RPCs below.

-- Repair rows lost before this guard existed, then make the bookkeeping columns non-nullable.
insert into public.profiles (user_id) select id from auth.users on conflict (user_id) do nothing;
update public.profiles set last_seen_at = coalesce(last_seen_at, now()), password_set = coalesce(password_set, false)
  where last_seen_at is null or password_set is null;
alter table public.profiles
  alter column last_seen_at set not null,
  alter column password_set set not null;

drop policy owner_all on public.profiles;
create policy owner_select on public.profiles for select using (user_id = auth.uid());
create policy owner_update on public.profiles for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (nickname, time_zone, snooze_minutes, suggestions_enabled) on public.profiles to authenticated;

-- Marks the caller active (guest purge in 0007 keys off last_seen_at).
create function public.touch_last_seen() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.profiles set last_seen_at = now() where user_id = auth.uid();
end;
$$;

-- Records that the caller has a password; a no-op unless auth actually holds one.
create function public.mark_password_set() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  update public.profiles p set password_set = true
    from auth.users u
    where p.user_id = auth.uid() and u.id = p.user_id and coalesce(u.encrypted_password, '') <> '';
end;
$$;

revoke all on function public.touch_last_seen() from public, anon;
revoke all on function public.mark_password_set() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;
grant execute on function public.mark_password_set() to authenticated;

-- Trigger-only; nobody should call it directly.
revoke all on function public.handle_new_user() from public, anon, authenticated;
