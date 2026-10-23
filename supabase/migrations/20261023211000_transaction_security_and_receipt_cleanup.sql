-- Harden customer transaction RPCs, direct admin table access, and receipt uploads.
-- This migration targets the deployed schema documented in supabase-reference-schema.md.

alter table public.bookings enable row level security;
alter table public.booking_slots enable row level security;
alter table public.booking_holds enable row level security;

revoke all on public.bookings, public.booking_slots, public.booking_holds from anon, authenticated;
grant select, insert, update, delete on public.bookings, public.booking_slots to authenticated;
grant usage, select on sequence public.booking_slots_id_seq to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all
  on public.bookings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists bookings_admin_guard on public.bookings;
create policy bookings_admin_guard
  on public.bookings as restrictive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists booking_slots_admin_all on public.booking_slots;
create policy booking_slots_admin_all
  on public.booking_slots for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists booking_slots_admin_guard on public.booking_slots;
create policy booking_slots_admin_guard
  on public.booking_slots as restrictive for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

do $$
begin
  if exists (
    select 1
    from public.booking_slots
    where is_active
    group by court_id, booking_date, slot_hour
    having count(*) > 1
  ) then
    raise exception 'Duplicate active booking slots exist; resolve them before applying transaction hardening.';
  end if;
end
$$;

create unique index if not exists active_booking_slot_key
  on public.booking_slots (court_id, booking_date, slot_hour)
  where is_active;

create or replace function public.can_upload_booking_receipt(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  select
    p_object_name is not null
    and array_length(string_to_array(p_object_name, '/'), 1) = 2
    and split_part(p_object_name, '/', 2) not in ('', '.', '..')
    and exists (
      select 1
      from public.booking_holds h
      where h.id::text = split_part(p_object_name, '/', 1)
        and h.hold_expires_at > now()
    )
    and not exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'receipts'
        and split_part(o.name, '/', 1) = split_part(p_object_name, '/', 1)
    );
$$;

create or replace function public.can_delete_unattached_receipt(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  select
    p_object_name is not null
    and array_length(string_to_array(p_object_name, '/'), 1) = 2
    and split_part(p_object_name, '/', 2) not in ('', '.', '..')
    and not exists (
      select 1
      from public.bookings b
      where b.receipt_path = p_object_name
    );
$$;

revoke all on function public.can_upload_booking_receipt(text) from public;
grant execute on function public.can_upload_booking_receipt(text) to anon, authenticated;
revoke all on function public.can_delete_unattached_receipt(text) from public;
grant execute on function public.can_delete_unattached_receipt(text) to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists receipts_upload on storage.objects;
create policy receipts_upload
  on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'receipts'
    and public.can_upload_booking_receipt(name)
  );
drop policy if exists receipts_upload_guard on storage.objects;
create policy receipts_upload_guard
  on storage.objects as restrictive for insert to anon, authenticated
  with check (
    bucket_id <> 'receipts'
    or public.can_upload_booking_receipt(name)
  );

drop policy if exists receipts_read_guard on storage.objects;
create policy receipts_read_guard
  on storage.objects as restrictive for select to anon, authenticated
  using (
    bucket_id <> 'receipts'
    or public.is_admin()
  );

drop policy if exists receipts_update_guard on storage.objects;
create policy receipts_update_guard
  on storage.objects as restrictive for update to anon, authenticated
  using (bucket_id <> 'receipts')
  with check (bucket_id <> 'receipts');

drop policy if exists receipts_unattached_delete on storage.objects;
create policy receipts_unattached_delete
  on storage.objects for delete to anon, authenticated
  using (
    bucket_id = 'receipts'
    and public.can_delete_unattached_receipt(name)
  );
drop policy if exists receipts_delete_guard on storage.objects;
create policy receipts_delete_guard
  on storage.objects as restrictive for delete to anon, authenticated
  using (
    bucket_id <> 'receipts'
    or public.can_delete_unattached_receipt(name)
  );

-- Replace legacy token overloads; access_token is UUID in the deployed schema.
drop function if exists public.hold_slots(integer, date, integer[]);
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
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour is null) then
    raise exception 'INVALID_SLOT';
  end if;
  slot_count := cardinality(p_hours);
  if (select count(distinct selected.hour) from unnest(p_hours) as selected(hour)) <> slot_count then
    raise exception 'DUPLICATE_SLOTS';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_court_id::text || p_date::text));
  delete from public.booking_holds where hold_expires_at <= now();

  foreach slot_hour in array p_hours loop
    if slot_hour < cfg.open_hour or slot_hour >= cfg.close_hour then
      raise exception 'OUTSIDE_HOURS';
    end if;
    if p_date = now_local::date and slot_hour <= extract(hour from now_local) then
      raise exception 'SLOT_PASSED';
    end if;
  end loop;

  if exists (
    select 1
    from public.booking_slots s
    where s.court_id = p_court_id
      and s.booking_date = p_date
      and s.is_active
      and s.slot_hour = any(p_hours)
  ) or exists (
    select 1
    from public.booking_holds h
    cross join lateral unnest(h.slot_hours) as held(hour)
    where h.court_id = p_court_id
      and h.booking_date = p_date
      and h.hold_expires_at > now()
      and held.hour = any(p_hours)
  ) then
    raise exception 'SLOT_TAKEN';
  end if;

  execute format(
    'insert into public.booking_holds (court_id, booking_date, slot_hours, hourly_rate, hold_expires_at)
     values ($1, $2, $3::%s, $4, $5)
     returning *',
    slot_hours_type
  )
  into hold
  using p_court_id, p_date, p_hours, cfg.hourly_rate,
    now() + make_interval(mins => cfg.hold_minutes);

  return jsonb_build_object(
    'booking_id', hold.id,
    'access_token', hold.access_token,
    'hourly_rate', hold.hourly_rate,
    'total_hours', cardinality(hold.slot_hours),
    'total_amount', hold.hourly_rate * cardinality(hold.slot_hours),
    'hold_expires_at', hold.hold_expires_at
  );
end
$$;

drop function if exists public.cancel_hold(uuid, text);
drop function if exists public.cancel_hold(uuid, uuid);
create function public.cancel_hold(p_booking_id uuid, p_access_token uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
  delete from public.booking_holds
  where id = p_booking_id and access_token = p_access_token;
$$;

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
    select * into bk
    from public.bookings
    where id = p_booking_id and access_token = p_access_token;
    if bk.id is not null then
      return jsonb_build_object(
        'booking_id', bk.id,
        'access_token', bk.access_token,
        'status', bk.status,
        'receipt_path', bk.receipt_path
      );
    end if;
    raise exception 'HOLD_EXPIRED';
  end if;

  if hold.hold_expires_at <= now() then raise exception 'HOLD_EXPIRED'; end if;
  if first_name_clean = '' or length(first_name_clean) > 80 then raise exception 'INVALID_FIRST_NAME'; end if;
  if last_name_clean = '' or length(last_name_clean) > 80 then raise exception 'INVALID_LAST_NAME'; end if;
  if phone_clean !~ '^(09|\+639)[0-9]{9}$' then raise exception 'INVALID_PHONE'; end if;
  if length(email_clean) > 254 or email_clean !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_EMAIL';
  end if;
  if p_receipt_path !~ ('^' || hold.id::text || '/[^/]+$') then raise exception 'INVALID_RECEIPT_PATH'; end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'receipts' and name = p_receipt_path
  ) then
    raise exception 'RECEIPT_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext(hold.court_id::text || hold.booking_date::text));

  if exists (
    select 1
    from public.booking_slots s
    cross join lateral unnest(hold.slot_hours) as held(hour)
    where s.court_id = hold.court_id
      and s.booking_date = hold.booking_date
      and s.is_active
      and s.slot_hour = held.hour
  ) then
    raise exception 'SLOT_TAKEN';
  end if;

  begin
    insert into public.bookings (
      id, reference_code, access_token, court_id, booking_date, first_name, last_name,
      phone, email, total_hours, hourly_rate, total_amount, receipt_path, status, submitted_at
    )
    values (
      hold.id,
      'BP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
      hold.access_token, hold.court_id, hold.booking_date, first_name_clean, last_name_clean,
      phone_clean, email_clean, cardinality(hold.slot_hours), hold.hourly_rate,
      hold.hourly_rate * cardinality(hold.slot_hours), p_receipt_path, 'pending', now()
    )
    returning * into bk;

    insert into public.booking_slots (booking_id, court_id, booking_date, slot_hour, is_active)
    select bk.id, hold.court_id, hold.booking_date, selected.hour, true
    from unnest(hold.slot_hours) as selected(hour);
  exception when unique_violation then
    raise exception 'SLOT_TAKEN';
  end;

  delete from public.booking_holds where id = hold.id;
  return jsonb_build_object(
    'booking_id', bk.id,
    'access_token', bk.access_token,
    'status', bk.status,
    'receipt_path', bk.receipt_path
  );
end
$$;

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
  now_local timestamp := now() at time zone 'Asia/Manila';
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into bk from public.bookings where id = p_booking_id for update;
  if bk.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if bk.status in ('rejected', 'cancelled') then raise exception 'BOOKING_LOCKED'; end if;
  select * into cfg from public.settings where id = 1;
  if cfg.id is null then raise exception 'SETTINGS_UNAVAILABLE'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and is_active) then
    raise exception 'INVALID_COURT';
  end if;
  if p_date is null or p_date < now_local::date then raise exception 'PAST_DATE'; end if;
  if slot_count = 0 then raise exception 'NO_SLOTS_SELECTED'; end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour is null) then
    raise exception 'INVALID_SLOT';
  end if;
  if (select count(distinct selected.hour) from unnest(p_hours) as selected(hour)) <> slot_count then
    raise exception 'DUPLICATE_SLOTS';
  end if;
  if exists (
    select 1
    from unnest(p_hours) as selected(hour)
    where selected.hour < cfg.open_hour or selected.hour >= cfg.close_hour
  ) then
    raise exception 'OUTSIDE_HOURS';
  end if;
  if exists (
    select 1
    from unnest(p_hours) as selected(hour)
    where selected.hour < 0 or selected.hour > 23
      or (p_date + make_interval(hours => selected.hour)) <= now_local
  ) then
    raise exception 'SLOT_IN_PAST';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_court_id::text || p_date::text));
  delete from public.booking_holds where hold_expires_at <= now();

  if exists (
    select 1
    from public.booking_slots s
    where s.court_id = p_court_id
      and s.booking_date = p_date
      and s.is_active
      and s.booking_id <> p_booking_id
      and s.slot_hour = any(p_hours)
  ) or exists (
    select 1
    from public.booking_holds h
    cross join lateral unnest(h.slot_hours) as held(hour)
    where h.court_id = p_court_id
      and h.booking_date = p_date
      and h.hold_expires_at > now()
      and held.hour = any(p_hours)
  ) then
    raise exception 'SLOT_TAKEN';
  end if;

  delete from public.booking_slots where booking_id = p_booking_id;
  insert into public.booking_slots (booking_id, court_id, booking_date, slot_hour, is_active)
  select p_booking_id, p_court_id, p_date, selected.hour, bk.status in ('pending', 'confirmed')
  from unnest(p_hours) as selected(hour);

  update public.bookings
  set court_id = p_court_id,
      booking_date = p_date,
      total_hours = slot_count,
      total_amount = bk.hourly_rate * slot_count
  where id = p_booking_id;
end
$$;

create or replace function public.admin_delete_booking(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, storage, pg_temp
as $$
declare
  booking_receipt text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;

  select receipt_path into booking_receipt
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;

  delete from public.booking_slots where booking_id = p_booking_id;
  delete from public.bookings where id = p_booking_id;
  return booking_receipt;
end
$$;

revoke all on function public.hold_slots(integer, date, integer[]) from public;
grant execute on function public.hold_slots(integer, date, integer[]) to anon, authenticated;
revoke all on function public.cancel_hold(uuid, uuid) from public;
grant execute on function public.cancel_hold(uuid, uuid) to anon, authenticated;
revoke all on function public.submit_payment(uuid, uuid, text, text, text, text, text) from public;
grant execute on function public.submit_payment(uuid, uuid, text, text, text, text, text) to anon, authenticated;
revoke all on function public.admin_reschedule_booking(uuid, integer, date, integer[]) from public, anon;
grant execute on function public.admin_reschedule_booking(uuid, integer, date, integer[]) to authenticated;
revoke all on function public.admin_delete_booking(uuid) from public, anon;
grant execute on function public.admin_delete_booking(uuid) to authenticated;

notify pgrst, 'reload schema';
