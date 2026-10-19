-- A push endpoint belongs to one browser. If another account signs in on that browser,
-- the new user takes over the endpoint (the previous user's row is removed).
create function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sub_id uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> uid;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_label, enabled)
  values (uid, p_endpoint, p_p256dh, p_auth, p_label, true)
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, device_label = excluded.device_label,
        enabled = true, user_id = uid
  returning id into sub_id;
  return sub_id;
end;
$$;

revoke all on function public.claim_push_endpoint(text, text, text, text) from public, anon;
grant execute on function public.claim_push_endpoint(text, text, text, text) to authenticated;
