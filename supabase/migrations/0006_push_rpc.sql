-- Claims a push endpoint for the caller. An endpoint belongs to one browser: another user's row is
-- taken over only when the caller proves control by presenting the same subscription keys
-- (p256dh + auth are only known to the browser that holds the subscription). Otherwise 42501.
create function public.claim_push_endpoint(p_endpoint text, p_p256dh text, p_auth text, p_label text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sub_id uuid;
  other record;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if length(p_endpoint) > 2048 or p_p256dh !~ '^[A-Za-z0-9_-]{87}$' or p_auth !~ '^[A-Za-z0-9_-]{22}$'
     or length(coalesce(p_label, '')) > 100 then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;

  select user_id, p256dh, auth into other
    from public.push_subscriptions where endpoint = p_endpoint and user_id <> uid;
  if found then
    if other.p256dh <> p_p256dh or other.auth <> p_auth then
      raise exception 'endpoint belongs to another user' using errcode = '42501';
    end if;
    delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> uid;
  end if;

  if (select count(*) from public.push_subscriptions where user_id = uid and endpoint <> p_endpoint) >= 10 then
    raise exception 'too many subscriptions' using errcode = '54000';
  end if;

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
