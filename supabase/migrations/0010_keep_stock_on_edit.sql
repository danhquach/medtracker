-- MT-11: an edit saved from a stale form must not undo a refill or a dose taken meanwhile.
-- save_med now changes stock only when p_med has a "stock" key; the client leaves it out when
-- the user didn't touch the field. add_stock also rejects NaN and Infinity (numeric allows both).
-- create or replace keeps the existing grants.
create or replace function public.save_med(p_med jsonb, p_schedules jsonb) returns uuid
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
      units_per_dose = (p_med->>'units_per_dose')::numeric,
      stock = case when p_med ? 'stock' then (p_med->>'stock')::numeric else stock end,
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

-- Atomic increment; untracked stock (null) starts at p_qty. NaN sorts above Infinity, so the
-- upper bound rejects both.
create or replace function public.add_stock(p_med uuid, p_qty numeric) returns numeric
language plpgsql security invoker set search_path = '' as $$
declare
  result numeric;
begin
  if p_qty is null or not (p_qty > 0 and p_qty < 'Infinity') then
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
