-- Atomic med save: med row + schedule replace + dose regeneration in one transaction.
-- Security invoker: RLS applies, user_id is always auth.uid(), and only editable columns are read
-- from input (never user_id / paused / refill_alerted_at).
create function public.save_med(p_med jsonb, p_schedules jsonb) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  med_id uuid := nullif(p_med->>'id', '')::uuid;
  uid uuid := auth.uid();
  s jsonb;
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
      units_per_dose = (p_med->>'units_per_dose')::numeric, stock = (p_med->>'stock')::numeric,
      refill_threshold_days = (p_med->>'refill_threshold_days')::int, notify = (p_med->>'notify')::bool,
      updated_at = now()
    where id = med_id and user_id = uid;
    if not found then
      raise exception 'medication not found' using errcode = 'P0002';
    end if;
  end if;

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
  return med_id;
end;
$$;

-- Atomic increment; untracked stock (null) starts at p_qty.
create function public.add_stock(p_med uuid, p_qty numeric) returns numeric
language plpgsql security invoker set search_path = '' as $$
declare
  result numeric;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'quantity must be greater than 0' using errcode = '22023';
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

revoke execute on function public.save_med(jsonb, jsonb) from public, anon;
revoke execute on function public.add_stock(uuid, numeric) from public, anon;
grant execute on function public.save_med(jsonb, jsonb) to authenticated;
grant execute on function public.add_stock(uuid, numeric) to authenticated;
