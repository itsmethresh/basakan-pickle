alter table public.settings
  add column if not exists day_hourly_rate numeric not null default 150,
  add column if not exists night_hourly_rate numeric not null default 200;

alter table public.settings
  drop constraint if exists settings_day_hourly_rate_check,
  add constraint settings_day_hourly_rate_check check (day_hourly_rate >= 0),
  drop constraint if exists settings_night_hourly_rate_check,
  add constraint settings_night_hourly_rate_check check (night_hourly_rate >= 0);

alter table public.settings
  alter column hourly_rate set default 175,
  alter column open_hour set default 0,
  alter column close_hour set default 24;

update public.settings
set hourly_rate = (day_hourly_rate + night_hourly_rate) / 2,
    open_hour = 0,
    close_hour = 24
where id = 1;

alter table public.booking_slots
  add column if not exists hourly_rate numeric;

update public.booking_slots slot
set hourly_rate = booking.hourly_rate
from public.bookings booking
where booking.id = slot.booking_id
  and slot.hourly_rate is null;

alter table public.booking_slots
  alter column hourly_rate set not null;

alter table public.booking_slots
  drop constraint if exists booking_slots_hourly_rate_check,
  add constraint booking_slots_hourly_rate_check check (hourly_rate >= 0);

alter table public.booking_holds
  add column if not exists slot_rates numeric[];

update public.booking_holds hold
set slot_rates = (
  select array_agg(hold.hourly_rate order by selected.ordinality)
  from unnest(hold.slot_hours) with ordinality as selected(hour, ordinality)
)
where hold.slot_rates is null;

alter table public.booking_holds
  alter column slot_rates set not null;

alter table public.booking_holds
  drop constraint if exists booking_holds_slot_rates_check,
  add constraint booking_holds_slot_rates_check
    check (cardinality(slot_rates) = cardinality(slot_hours));

create or replace function public.rate_for_hour(p_hour integer, p_day_rate numeric, p_night_rate numeric)
returns numeric
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case when p_hour between 5 and 16 then p_day_rate else p_night_rate end
$$;

do $$
declare
  existing_function record;
begin
  for existing_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'hold_slots'
      and p.prokind = 'f'
  loop
    execute format('drop function %s', existing_function.signature);
  end loop;
end
$$;

create function public.hold_slots(p_court_id integer, p_date date, p_hours integer[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  cfg public.settings;
  now_local timestamp := now() at time zone 'Asia/Manila';
  hold public.booking_holds;
  slot_hour integer;
  slot_count integer;
  slot_hours_type text;
  calculated_rates numeric[];
  calculated_total numeric;
begin
  select format_type(a.atttypid, a.atttypmod)
  into slot_hours_type
  from pg_attribute a
  where a.attrelid = 'public.booking_holds'::regclass
    and a.attname = 'slot_hours'
    and a.attnum > 0
    and not a.attisdropped;

  if slot_hours_type is null or slot_hours_type not in ('smallint[]', 'integer[]', 'bigint[]') then
    raise exception 'UNSUPPORTED_SLOT_HOURS_TYPE';
  end if;

  select * into cfg from public.settings where id = 1;
  if cfg.id is null then raise exception 'SETTINGS_UNAVAILABLE'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and is_active) then
    raise exception 'INVALID_COURT';
  end if;
  if p_date is null or p_date < now_local::date then raise exception 'PAST_DATE'; end if;
  if coalesce(cardinality(p_hours), 0) = 0 then raise exception 'NO_SLOTS_SELECTED'; end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour is null or selected.hour < 0 or selected.hour > 23) then
    raise exception 'INVALID_SLOT';
  end if;
  slot_count := cardinality(p_hours);
  if (select count(distinct selected.hour) from unnest(p_hours) as selected(hour)) <> slot_count then
    raise exception 'DUPLICATE_SLOTS';
  end if;
  if (select count(*) from unnest(p_hours) as selected(hour) where selected.hour < cfg.open_hour or selected.hour >= cfg.close_hour) > 0 then
    raise exception 'OUTSIDE_HOURS';
  end if;
  if exists (
    select 1 from unnest(p_hours) as selected(hour)
    where p_date = now_local::date and selected.hour <= extract(hour from now_local)
  ) then
    raise exception 'SLOT_PASSED';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_court_id::text || p_date::text));
  delete from public.booking_holds where hold_expires_at <= now();

  if exists (
    select 1 from public.booking_slots s
    where s.court_id = p_court_id and s.booking_date = p_date
      and s.is_active and s.slot_hour = any(p_hours)
  ) or exists (
    select 1 from public.booking_holds h
    cross join lateral unnest(h.slot_hours) as held(hour)
    where h.court_id = p_court_id and h.booking_date = p_date
      and h.hold_expires_at > now() and held.hour = any(p_hours)
  ) then
    raise exception 'SLOT_TAKEN';
  end if;

  select array_agg(public.rate_for_hour(selected.hour, cfg.day_hourly_rate, cfg.night_hourly_rate) order by selected.ordinality)
  into calculated_rates
  from unnest(p_hours) with ordinality as selected(hour, ordinality);
  select coalesce(sum(rate), 0) into calculated_total from unnest(calculated_rates) as rates(rate);

  execute format(
    'insert into public.booking_holds (court_id, booking_date, slot_hours, hourly_rate, slot_rates, hold_expires_at)
     values ($1, $2, $3::%s, $4, $5, $6)
     returning *',
    slot_hours_type
  )
  into hold
  using p_court_id, p_date, p_hours, calculated_total / slot_count, calculated_rates,
    now() + make_interval(mins => cfg.hold_minutes);

  return jsonb_build_object(
    'booking_id', hold.id,
    'access_token', hold.access_token,
    'hourly_rate', hold.hourly_rate,
    'slot_rates', hold.slot_rates,
    'total_hours', cardinality(hold.slot_hours),
    'total_amount', calculated_total,
    'hold_expires_at', hold.hold_expires_at
  );
end
$$;

do $$
begin
  if (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'hold_slots'
      and p.prokind = 'f'
  ) <> 1 then
    raise exception 'HOLD_SLOTS_OVERLOAD_REMAINS';
  end if;
end
$$;

revoke all on function public.hold_slots(integer, date, integer[]) from public;
grant execute on function public.hold_slots(integer, date, integer[]) to anon, authenticated;

drop function if exists public.submit_payment(uuid, text, text, text, text, text, text);
drop function if exists public.submit_payment(uuid, uuid, text, text, text, text, text);
create function public.submit_payment(
  p_booking_id uuid,
  p_access_token uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_receipt_path text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  hold public.booking_holds;
  bk public.bookings;
  total_amount numeric;
  phone_clean text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  first_name_clean text := trim(coalesce(p_first_name, ''));
  last_name_clean text := trim(coalesce(p_last_name, ''));
  email_clean text := lower(trim(coalesce(p_email, '')));
begin
  select * into hold
  from public.booking_holds
  where id = p_booking_id and access_token = p_access_token
  for update;

  if hold.id is null then
    select * into bk from public.bookings
    where id = p_booking_id and access_token = p_access_token;
    if bk.id is not null then
      return jsonb_build_object('booking_id', bk.id, 'access_token', bk.access_token, 'status', bk.status, 'receipt_path', bk.receipt_path);
    end if;
    raise exception 'HOLD_EXPIRED';
  end if;

  if hold.hold_expires_at <= now() then raise exception 'HOLD_EXPIRED'; end if;
  if first_name_clean = '' or length(first_name_clean) > 80 then raise exception 'INVALID_FIRST_NAME'; end if;
  if last_name_clean = '' or length(last_name_clean) > 80 then raise exception 'INVALID_LAST_NAME'; end if;
  if phone_clean !~ '^(09|\+639)[0-9]{9}$' then raise exception 'INVALID_PHONE'; end if;
  if length(email_clean) > 254 or email_clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if p_receipt_path !~ ('^' || hold.id::text || '/[^/]+$') then raise exception 'INVALID_RECEIPT_PATH'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'receipts' and name = p_receipt_path) then
    raise exception 'RECEIPT_REQUIRED';
  end if;
  if cardinality(hold.slot_rates) <> cardinality(hold.slot_hours) then raise exception 'INVALID_HOLD_PRICING'; end if;
  select coalesce(sum(rate), 0) into total_amount from unnest(hold.slot_rates) as rates(rate);

  perform pg_advisory_xact_lock(hashtext(hold.court_id::text || hold.booking_date::text));
  if exists (
    select 1 from public.booking_slots s
    cross join lateral unnest(hold.slot_hours) as held(hour)
    where s.court_id = hold.court_id and s.booking_date = hold.booking_date
      and s.is_active and s.slot_hour = held.hour
  ) then
    raise exception 'SLOT_TAKEN';
  end if;

  begin
    insert into public.bookings (
      id, reference_code, access_token, court_id, booking_date, first_name, last_name,
      phone, email, total_hours, hourly_rate, total_amount, receipt_path, status, submitted_at
    )
    values (
      hold.id, 'BP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      hold.access_token, hold.court_id, hold.booking_date, first_name_clean, last_name_clean,
      phone_clean, email_clean, cardinality(hold.slot_hours), total_amount / cardinality(hold.slot_hours),
      total_amount, p_receipt_path, 'pending', now()
    )
    returning * into bk;

    insert into public.booking_slots (booking_id, court_id, booking_date, slot_hour, hourly_rate, is_active)
    select bk.id, hold.court_id, hold.booking_date, selected.hour, pricing.rate, true
    from unnest(hold.slot_hours) with ordinality as selected(hour, ordinality)
    join unnest(hold.slot_rates) with ordinality as pricing(rate, ordinality) using (ordinality);
  exception when unique_violation then
    raise exception 'SLOT_TAKEN';
  end;

  delete from public.booking_holds where id = hold.id;
  return jsonb_build_object('booking_id', bk.id, 'access_token', bk.access_token, 'status', bk.status, 'receipt_path', bk.receipt_path);
end
$$;

revoke all on function public.submit_payment(uuid, uuid, text, text, text, text, text) from public;
grant execute on function public.submit_payment(uuid, uuid, text, text, text, text, text) to anon, authenticated;

create or replace function public.admin_reschedule_booking(
  p_booking_id uuid,
  p_court_id integer,
  p_date date,
  p_hours integer[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  bk public.bookings;
  cfg public.settings;
  slot_count integer := coalesce(cardinality(p_hours), 0);
  new_total numeric;
  now_local timestamp := now() at time zone 'Asia/Manila';
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if bk.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if bk.status in ('rejected', 'cancelled') then raise exception 'BOOKING_LOCKED'; end if;
  select * into cfg from public.settings where id = 1;
  if cfg.id is null then raise exception 'SETTINGS_UNAVAILABLE'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and is_active) then raise exception 'INVALID_COURT'; end if;
  if p_date is null or p_date < now_local::date then raise exception 'PAST_DATE'; end if;
  if slot_count = 0 then raise exception 'NO_SLOTS_SELECTED'; end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour is null or selected.hour < 0 or selected.hour > 23) then
    raise exception 'INVALID_SLOT';
  end if;
  if (select count(distinct selected.hour) from unnest(p_hours) as selected(hour)) <> slot_count then raise exception 'DUPLICATE_SLOTS'; end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour < cfg.open_hour or selected.hour >= cfg.close_hour) then
    raise exception 'OUTSIDE_HOURS';
  end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where (p_date + make_interval(hours => selected.hour)) <= now_local) then
    raise exception 'SLOT_IN_PAST';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_court_id::text || p_date::text));
  delete from public.booking_holds where hold_expires_at <= now();
  if exists (
    select 1 from public.booking_slots s
    where s.court_id = p_court_id and s.booking_date = p_date
      and s.is_active and s.booking_id <> p_booking_id and s.slot_hour = any(p_hours)
  ) or exists (
    select 1 from public.booking_holds h
    cross join lateral unnest(h.slot_hours) as held(hour)
    where h.court_id = p_court_id and h.booking_date = p_date
      and h.hold_expires_at > now() and held.hour = any(p_hours)
  ) then
    raise exception 'SLOT_TAKEN';
  end if;

  select coalesce(sum(public.rate_for_hour(selected.hour, cfg.day_hourly_rate, cfg.night_hourly_rate)), 0)
  into new_total from unnest(p_hours) as selected(hour);

  delete from public.booking_slots where booking_id = p_booking_id;
  insert into public.booking_slots (booking_id, court_id, booking_date, slot_hour, hourly_rate, is_active)
  select p_booking_id, p_court_id, p_date, selected.hour,
    public.rate_for_hour(selected.hour, cfg.day_hourly_rate, cfg.night_hourly_rate),
    bk.status in ('pending', 'confirmed')
  from unnest(p_hours) as selected(hour);

  update public.bookings
  set court_id = p_court_id,
      booking_date = p_date,
      total_hours = slot_count,
      hourly_rate = new_total / slot_count,
      total_amount = new_total
  where id = p_booking_id;
end
$$;

create or replace function public.get_my_booking(p_booking_id uuid, p_access_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  hold public.booking_holds;
  bk public.bookings;
  cname text;
begin
  select * into bk from public.bookings where id = p_booking_id and access_token = p_access_token;

  if bk.id is not null then
    select name into cname from public.courts where id = bk.court_id;
    return jsonb_build_object(
      'booking_id', bk.id,
      'status', bk.status,
      'booking_date', bk.booking_date,
      'court_name', cname,
      'hours', (select coalesce(jsonb_agg(slot_hour order by slot_hour), '[]'::jsonb) from public.booking_slots where booking_id = bk.id),
      'slot_rates', (select coalesce(jsonb_agg(hourly_rate order by slot_hour), '[]'::jsonb) from public.booking_slots where booking_id = bk.id),
      'hourly_rate', bk.hourly_rate,
      'total_amount', bk.total_amount,
      'hold_expires_at', null,
      'first_name', bk.first_name,
      'last_name', bk.last_name,
      'reference_code', bk.reference_code,
      'email', bk.email,
      'phone', bk.phone,
      'submitted_at', bk.submitted_at
    );
  end if;

  select * into hold from public.booking_holds where id = p_booking_id and access_token = p_access_token;
  if hold.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;

  select name into cname from public.courts where id = hold.court_id;
  return jsonb_build_object(
    'booking_id', hold.id,
    'status', case when hold.hold_expires_at > now() then 'held' else 'expired' end,
    'booking_date', hold.booking_date,
    'court_name', cname,
    'hours', to_jsonb(hold.slot_hours),
    'slot_rates', to_jsonb(hold.slot_rates),
    'hourly_rate', hold.hourly_rate,
    'total_amount', (select coalesce(sum(rate), 0) from unnest(hold.slot_rates) as rates(rate)),
    'hold_expires_at', hold.hold_expires_at,
    'first_name', null,
    'last_name', null
  );
end
$$;

grant execute on function public.get_my_booking(uuid, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
