-- Basakan Pickle - destructive Supabase setup for a new project.
-- Paste this ENTIRE file into Supabase > SQL Editor and press Run.
-- WARNING: this rebuilds the bookings, booking_slots and booking_holds tables (existing bookings are deleted).
-- Your Supabase Auth users, courts, settings and admin_users rows are kept.

create schema if not exists extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- Remove every old version of the functions so the signatures below are the only ones.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_admin','get_availability','hold_slots','cancel_hold','submit_payment','get_my_booking','admin_reschedule_booking','sync_booking_slots','expire_holds')
  loop
    execute 'drop function if exists ' || r.sig || ' cascade';
  end loop;
end $$;

drop table if exists public.booking_slots cascade;
drop table if exists public.booking_holds cascade;
drop table if exists public.bookings cascade;
drop type if exists public.booking_status cascade;

-- Tables

create table if not exists public.courts (
  id integer primary key,
  name text not null,
  is_active boolean not null default true
);

create table if not exists public.settings (
  id integer primary key default 1,
  business_name text not null default 'Basakan Pickle',
  hourly_rate numeric not null default 175,
  day_hourly_rate numeric not null default 150,
  night_hourly_rate numeric not null default 200,
  open_hour integer not null default 0,
  close_hour integer not null default 24,
  hold_minutes integer not null default 10,
  gcash_qr_path text,
  gcash_account_name text,
  gcash_number text,
  updated_at timestamptz not null default now()
);

alter table public.settings add column if not exists business_name text not null default 'Basakan Pickle';
alter table public.settings add column if not exists hourly_rate numeric not null default 175;
alter table public.settings add column if not exists day_hourly_rate numeric not null default 150;
alter table public.settings add column if not exists night_hourly_rate numeric not null default 200;
alter table public.settings add column if not exists open_hour integer not null default 0;
alter table public.settings add column if not exists close_hour integer not null default 24;
alter table public.settings add column if not exists hold_minutes integer not null default 10;
alter table public.settings add column if not exists gcash_qr_path text;
alter table public.settings add column if not exists gcash_account_name text;
alter table public.settings add column if not exists gcash_number text;
alter table public.settings add column if not exists updated_at timestamptz not null default now();

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text
);
alter table public.admin_users add column if not exists email text;

create table if not exists public.notification_settings (
  id smallint primary key default 1 check (id = 1),
  owner_notification_email text,
  updated_at timestamptz not null default now()
);

insert into public.settings (id) values (1) on conflict (id) do nothing;
update public.settings
set hourly_rate = (day_hourly_rate + night_hourly_rate) / 2,
    open_hour = 0,
    close_hour = 24
where id = 1;
insert into public.notification_settings (id) values (1) on conflict (id) do nothing;
insert into public.courts (id, name)
select v.id, v.name from (values (1, 'Court 1'), (2, 'Court 2')) as v(id, name)
where not exists (select 1 from public.courts);

-- A held slot lives here only until the customer submits payment or the hold expires.
create table public.booking_holds (
  id uuid primary key default gen_random_uuid(),
  access_token text not null default replace(gen_random_uuid()::text, '-', ''),
  court_id integer not null references public.courts(id),
  booking_date date not null,
  hours integer[] not null,
  hourly_rate numeric not null check (hourly_rate >= 0),
  slot_rates numeric[] not null check (cardinality(slot_rates) = cardinality(hours)),
  total_hours integer not null,
  total_amount numeric not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists booking_holds_expires_at_idx on public.booking_holds (expires_at);

-- A booking row exists only after a payment screenshot was submitted.
create table public.bookings (
  id uuid primary key,
  reference_code text not null unique default ('BP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  access_token text not null,
  court_id integer not null references public.courts(id),
  booking_date date not null,
  first_name text,
  last_name text,
  phone text,
  email text,
  total_hours integer not null,
  hourly_rate numeric not null check (hourly_rate >= 0),
  total_amount numeric not null,
  receipt_path text,
  status text not null default 'pending' check (status in ('held','pending','confirmed','rejected','cancelled','expired')),
  hold_expires_at timestamptz,
  admin_notes text,
  submitted_at timestamptz default now(),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.booking_slots (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  court_id integer not null references public.courts(id),
  booking_date date not null,
  slot_hour integer not null,
  hourly_rate numeric not null,
  is_active boolean not null default true
);

-- Only one active booking per court, date and hour.
create unique index active_booking_slot_key on public.booking_slots (court_id, booking_date, slot_hour) where is_active;
create index booking_slots_booking_idx on public.booking_slots (booking_id);
create index bookings_date_idx on public.bookings (booking_date);

-- Helpers

create or replace function public.rate_for_hour(p_hour integer, p_day_rate numeric, p_night_rate numeric)
returns numeric language sql immutable strict set search_path = pg_catalog as $$
  select case when p_hour between 5 and 16 then p_day_rate else p_night_rate end
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid());
$$;

-- Keep slots in step with the booking status (rejected or cancelled bookings free their slots).
create function public.sync_booking_slots()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    new.confirmed_at := now();
  end if;
  update public.booking_slots set is_active = (new.status in ('pending','confirmed')) where booking_id = new.id;
  return new;
end $$;

create trigger bookings_sync_slots before update on public.bookings
for each row execute function public.sync_booking_slots();

-- Customer functions

create function public.get_availability(p_date date)
returns table (court_id integer, slot_hour integer, status text)
language sql security definer set search_path = public as $$
  select s.court_id, s.slot_hour, 'booked'::text
  from public.booking_slots s
  where s.booking_date = p_date and s.is_active
  union all
  select h.court_id, unnest(h.hours), 'held'::text
  from public.booking_holds h
  where h.booking_date = p_date and h.expires_at > now();
$$;

create function public.hold_slots(p_court_id integer, p_date date, p_hours integer[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cfg public.settings;
  now_local timestamp := (now() at time zone 'Asia/Manila');
  h integer;
  hold public.booking_holds;
  total numeric;
  rates numeric[];
  total numeric;
begin
  select * into cfg from public.settings where id = 1;
  if cfg.id is null then raise exception 'SETTINGS_UNAVAILABLE'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and is_active) then raise exception 'INVALID_COURT'; end if;
  n := coalesce(array_length(p_hours, 1), 0);
  if n = 0 then raise exception 'NO_SLOTS_SELECTED'; end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour is null or selected.hour < 0 or selected.hour > 23) then raise exception 'INVALID_SLOT'; end if;
  if (select count(distinct selected.hour) from unnest(p_hours) as selected(hour)) <> n then raise exception 'DUPLICATE_SLOTS'; end if;
  if p_date is null or p_date < now_local::date then raise exception 'PAST_DATE'; end if;

  perform pg_advisory_xact_lock(hashtext(p_court_id::text || p_date::text));
  delete from public.booking_holds where expires_at <= now();

  foreach h in array p_hours loop
    if h < cfg.open_hour or h >= cfg.close_hour then raise exception 'OUTSIDE_HOURS'; end if;
    if p_date = now_local::date and h <= extract(hour from now_local) then raise exception 'SLOT_PASSED'; end if;
  end loop;

  if exists (select 1 from public.booking_slots where court_id = p_court_id and booking_date = p_date and is_active and slot_hour = any(p_hours))
     or exists (select 1 from public.booking_holds where court_id = p_court_id and booking_date = p_date and hours && p_hours and expires_at > now()) then
    raise exception 'SLOT_TAKEN';
  end if;

  select array_agg(public.rate_for_hour(selected.hour, cfg.day_hourly_rate, cfg.night_hourly_rate) order by selected.ordinality)
  into rates from unnest(p_hours) with ordinality as selected(hour, ordinality);
  select sum(rate) into total from unnest(rates) as selected(rate);
  insert into public.booking_holds (court_id, booking_date, hours, hourly_rate, slot_rates, total_hours, total_amount, expires_at)
  values (p_court_id, p_date, p_hours, total / n, rates, n, total, now() + make_interval(mins => cfg.hold_minutes))
  returning * into hold;

  return jsonb_build_object(
    'booking_id', hold.id,
    'access_token', hold.access_token,
    'hourly_rate', hold.hourly_rate,
    'slot_rates', hold.slot_rates,
    'total_hours', hold.total_hours,
    'total_amount', hold.total_amount,
    'hold_expires_at', hold.expires_at
  );
end $$;

create function public.cancel_hold(p_booking_id uuid, p_access_token text)
returns void language sql security definer set search_path = public as $$
  delete from public.booking_holds where id = p_booking_id and access_token::text = p_access_token;
$$;

create function public.expire_holds()
returns integer language plpgsql security definer set search_path = public as $$
declare
  deleted_count integer;
begin
  delete from public.booking_holds where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;

create function public.submit_payment(
  p_booking_id uuid, p_access_token text, p_first_name text, p_last_name text,
  p_phone text, p_email text, p_receipt_path text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hold public.booking_holds;
  phone_clean text := regexp_replace(coalesce(p_phone, ''), '[\s-]', '', 'g');
  bk public.bookings;
  n integer;
begin
  select * into hold from public.booking_holds where id = p_booking_id and access_token::text = p_access_token for update;
  if hold.id is null then
    select * into bk from public.bookings where id = p_booking_id and access_token::text = p_access_token;
    if bk.id is not null then
      return jsonb_build_object('booking_id', bk.id, 'access_token', bk.access_token, 'status', bk.status, 'receipt_path', bk.receipt_path);
    end if;
    raise exception 'HOLD_EXPIRED';
  end if;
  if hold.expires_at <= now() then
    delete from public.booking_holds where id = hold.id;
    raise exception 'HOLD_EXPIRED';
  end if;

  if length(trim(coalesce(p_first_name, ''))) = 0 or length(trim(p_first_name)) > 80 then raise exception 'INVALID_FIRST_NAME'; end if;
  if length(trim(coalesce(p_last_name, ''))) = 0 or length(trim(p_last_name)) > 80 then raise exception 'INVALID_LAST_NAME'; end if;
  if phone_clean !~ '^(\+?63|0)9[0-9]{9}$' then raise exception 'INVALID_PHONE'; end if;
  if length(trim(coalesce(p_email, ''))) > 254 or coalesce(p_email, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'INVALID_EMAIL'; end if;
  if coalesce(p_receipt_path, '') !~ ('^' || hold.id::text || '/[^/]+$') then raise exception 'INVALID_RECEIPT_PATH'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'receipts' and name = p_receipt_path) then raise exception 'RECEIPT_REQUIRED'; end if;
  if cardinality(hold.slot_rates) <> cardinality(hold.hours) then raise exception 'INVALID_HOLD_PRICING'; end if;
  select sum(rate) into total from unnest(hold.slot_rates) as selected(rate);

  perform pg_advisory_xact_lock(hashtext(hold.court_id::text || hold.booking_date::text));

  begin
    insert into public.bookings (id, access_token, court_id, booking_date, first_name, last_name, phone, email,
      total_hours, hourly_rate, total_amount, receipt_path, status, submitted_at)
    values (hold.id, hold.access_token, hold.court_id, hold.booking_date, trim(p_first_name), trim(p_last_name), phone_clean,
      lower(trim(p_email)), hold.total_hours, hold.hourly_rate, total, p_receipt_path, 'pending', now())
    returning * into bk;

    insert into public.booking_slots (booking_id, court_id, booking_date, slot_hour, hourly_rate)
    select bk.id, hold.court_id, hold.booking_date, selected.hour, pricing.rate
    from unnest(hold.hours) with ordinality as selected(hour, ordinality)
    join unnest(hold.slot_rates) with ordinality as pricing(rate, ordinality) using (ordinality);
  exception when unique_violation then
    raise exception 'SLOT_TAKEN';
  end;

  delete from public.booking_holds where id = hold.id;
  return jsonb_build_object('booking_id', bk.id, 'access_token', bk.access_token, 'status', bk.status, 'receipt_path', bk.receipt_path);
end $$;

create or replace function public.get_my_booking(p_booking_id uuid, p_access_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  hold public.booking_holds;
  bk public.bookings;
  cname text;
begin
  select * into bk from public.bookings where id = p_booking_id and access_token::text = p_access_token;
  if bk.id is not null then
    select name into cname from public.courts where id = bk.court_id;
    return jsonb_build_object(
      'booking_id', bk.id, 'status', bk.status, 'booking_date', bk.booking_date, 'court_name', cname,
      'hours', (select coalesce(jsonb_agg(slot_hour order by slot_hour), '[]'::jsonb) from public.booking_slots where booking_id = bk.id),
      'slot_rates', (select coalesce(jsonb_agg(hourly_rate order by slot_hour), '[]'::jsonb) from public.booking_slots where booking_id = bk.id),
      'hourly_rate', bk.hourly_rate, 'total_amount', bk.total_amount, 'hold_expires_at', null,
      'first_name', bk.first_name, 'last_name', bk.last_name,
      'reference_code', bk.reference_code, 'email', bk.email, 'phone', bk.phone, 'submitted_at', bk.submitted_at);
  end if;

  select * into hold from public.booking_holds where id = p_booking_id and access_token::text = p_access_token;
  if hold.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  select name into cname from public.courts where id = hold.court_id;
  return jsonb_build_object(
    'booking_id', hold.id,
    'status', case when hold.expires_at > now() then 'held' else 'expired' end,
    'booking_date', hold.booking_date, 'court_name', cname,
    'hours', to_jsonb(hold.hours),
    'slot_rates', to_jsonb(hold.slot_rates), 'hourly_rate', hold.hourly_rate, 'total_amount', hold.total_amount, 'hold_expires_at', hold.expires_at,
    'first_name', null, 'last_name', null);
end $$;

-- Admin function

create or replace function public.admin_reschedule_booking(p_booking_id uuid, p_court_id integer, p_date date, p_hours integer[])
returns void language plpgsql security definer set search_path = public as $$
declare
  bk public.bookings;
  cfg public.settings;
  now_local timestamp := now() at time zone 'Asia/Manila';
  n integer := coalesce(array_length(p_hours, 1), 0);
  new_total numeric;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into bk from public.bookings where id = p_booking_id;
  if bk.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  if n = 0 then raise exception 'NO_SLOTS_SELECTED'; end if;
  if bk.status in ('rejected','cancelled') then raise exception 'BOOKING_LOCKED'; end if;
  select * into cfg from public.settings where id = 1;
  if cfg.id is null then raise exception 'SETTINGS_UNAVAILABLE'; end if;
  if not exists (select 1 from public.courts where id = p_court_id and is_active) then raise exception 'INVALID_COURT'; end if;
  if p_date is null or p_date < now_local::date then raise exception 'PAST_DATE'; end if;
  if exists (select 1 from unnest(p_hours) as selected(hour) where selected.hour is null or selected.hour < 0 or selected.hour > 23) then raise exception 'INVALID_SLOT'; end if;
  if (select count(distinct selected.hour) from unnest(p_hours) as selected(hour)) <> n then raise exception 'DUPLICATE_SLOTS'; end if;
  if exists (
    select 1 from unnest(p_hours) as selected(hour)
    where selected.hour < cfg.open_hour or selected.hour >= cfg.close_hour
  ) then raise exception 'OUTSIDE_HOURS'; end if;
  if exists (
    select 1 from unnest(p_hours) as selected(hour)
    where (p_date + make_interval(hours => selected.hour)) <= now_local
  ) then raise exception 'SLOT_IN_PAST'; end if;

  perform pg_advisory_xact_lock(hashtext(p_court_id::text || p_date::text));
  delete from public.booking_holds where expires_at <= now();

  if exists (select 1 from public.booking_slots where court_id = p_court_id and booking_date = p_date and is_active and booking_id <> p_booking_id and slot_hour = any(p_hours))
     or exists (select 1 from public.booking_holds where court_id = p_court_id and booking_date = p_date and hours && p_hours) then
    raise exception 'SLOT_TAKEN';
  end if;

  delete from public.booking_slots where booking_id = p_booking_id;
  select sum(public.rate_for_hour(selected.hour, cfg.day_hourly_rate, cfg.night_hourly_rate))
  into new_total from unnest(p_hours) as selected(hour);
  insert into public.booking_slots (booking_id, court_id, booking_date, slot_hour, hourly_rate, is_active)
  select p_booking_id, p_court_id, p_date, selected.hour,
    public.rate_for_hour(selected.hour, cfg.day_hourly_rate, cfg.night_hourly_rate),
    bk.status in ('pending','confirmed')
  from unnest(p_hours) as selected(hour);

  update public.bookings
  set court_id = p_court_id, booking_date = p_date, total_hours = n,
      hourly_rate = new_total / n, total_amount = new_total
  where id = p_booking_id;
end $$;

create or replace function public.admin_delete_booking(p_booking_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  booking_receipt text;
begin
  if not public.is_admin() then raise exception 'FORBIDDEN'; end if;
  select receipt_path into booking_receipt from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  delete from public.booking_slots where booking_id = p_booking_id;
  delete from public.bookings where id = p_booking_id;
  return booking_receipt;
end $$;

create or replace function public.can_upload_booking_receipt(p_object_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_object_name is not null
    and array_length(string_to_array(p_object_name, '/'), 1) = 2
    and split_part(p_object_name, '/', 2) not in ('', '.', '..')
    and exists (
      select 1 from public.booking_holds h
      where h.id::text = split_part(p_object_name, '/', 1)
        and h.expires_at > now()
    )
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'receipts'
        and split_part(o.name, '/', 1) = split_part(p_object_name, '/', 1)
    );
$$;

create or replace function public.can_delete_unattached_receipt(p_object_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_object_name is not null
    and array_length(string_to_array(p_object_name, '/'), 1) = 2
    and split_part(p_object_name, '/', 2) not in ('', '.', '..')
    and not exists (select 1 from public.bookings b where b.receipt_path = p_object_name);
$$;

-- Permissions

alter table public.courts enable row level security;
alter table public.settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_slots enable row level security;
alter table public.booking_holds enable row level security;
alter table public.notification_settings enable row level security;

revoke all on public.courts, public.settings, public.admin_users, public.bookings, public.booking_slots, public.booking_holds from anon, authenticated;
revoke all on public.notification_settings from anon, authenticated;
grant select on public.courts, public.settings to anon, authenticated;
grant select, update on public.notification_settings to authenticated;
grant update on public.settings to authenticated;
grant select on public.admin_users to authenticated;
grant select, insert, update, delete on public.bookings, public.booking_slots to authenticated;
grant usage, select on all sequences in schema public to authenticated;

drop policy if exists courts_read on public.courts;
create policy courts_read on public.courts for select using (true);
drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (true);
drop policy if exists settings_admin_update on public.settings;
create policy settings_admin_update on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_users_self on public.admin_users;
create policy admin_users_self on public.admin_users for select to authenticated using (user_id = auth.uid());
drop policy if exists bookings_admin_all on public.bookings;
create policy bookings_admin_all on public.bookings for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists bookings_admin_guard on public.bookings;
create policy bookings_admin_guard on public.bookings as restrictive for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists booking_slots_admin_all on public.booking_slots;
create policy booking_slots_admin_all on public.booking_slots for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists booking_slots_admin_guard on public.booking_slots;
create policy booking_slots_admin_guard on public.booking_slots as restrictive for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists notification_settings_admin_read on public.notification_settings;
create policy notification_settings_admin_read on public.notification_settings for select to authenticated using (public.is_admin());
drop policy if exists notification_settings_admin_update on public.notification_settings;
create policy notification_settings_admin_update on public.notification_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke execute on all functions in schema public from public;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.get_availability(date) to anon, authenticated;
grant execute on function public.hold_slots(integer, date, integer[]) to anon, authenticated;
grant execute on function public.cancel_hold(uuid, text) to anon, authenticated;
grant execute on function public.submit_payment(uuid, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_my_booking(uuid, text) to anon, authenticated;
grant execute on function public.admin_reschedule_booking(uuid, integer, date, integer[]) to authenticated;
grant execute on function public.admin_delete_booking(uuid) to authenticated;
revoke all on function public.can_upload_booking_receipt(text) from public;
grant execute on function public.can_upload_booking_receipt(text) to anon, authenticated;
revoke all on function public.can_delete_unattached_receipt(text) from public;
grant execute on function public.can_delete_unattached_receipt(text) to anon, authenticated;
revoke all on function public.expire_holds() from public, anon, authenticated;

do $$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'purge-expired-booking-holds'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule('purge-expired-booking-holds', '*/10 * * * *', 'select public.expire_holds();');
end $$;

-- Storage: customers upload receipts, only admins can read them; the QR image bucket is public and limited to 2 MiB JPEG/PNG/WEBP files.

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = true, file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
update storage.buckets
set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'receipts';

drop policy if exists receipts_upload on storage.objects;
create policy receipts_upload on storage.objects for insert to anon, authenticated
with check (bucket_id = 'receipts' and public.can_upload_booking_receipt(name));
drop policy if exists receipts_upload_guard on storage.objects;
create policy receipts_upload_guard on storage.objects as restrictive for insert to anon, authenticated
with check (bucket_id <> 'receipts' or public.can_upload_booking_receipt(name));
drop policy if exists receipts_admin_read on storage.objects;
create policy receipts_admin_read on storage.objects for select to authenticated using (bucket_id = 'receipts' and public.is_admin());
drop policy if exists receipts_read_guard on storage.objects;
create policy receipts_read_guard on storage.objects as restrictive for select to anon, authenticated
using (bucket_id <> 'receipts' or public.is_admin());
drop policy if exists receipts_update_guard on storage.objects;
create policy receipts_update_guard on storage.objects as restrictive for update to anon, authenticated
using (bucket_id <> 'receipts') with check (bucket_id <> 'receipts');
drop policy if exists receipts_admin_delete on storage.objects;
create policy receipts_admin_delete on storage.objects for delete to authenticated using (bucket_id = 'receipts' and public.is_admin());
drop policy if exists receipts_unattached_delete on storage.objects;
create policy receipts_unattached_delete on storage.objects for delete to anon, authenticated
using (bucket_id = 'receipts' and public.can_delete_unattached_receipt(name));
drop policy if exists receipts_delete_guard on storage.objects;
create policy receipts_delete_guard on storage.objects as restrictive for delete to anon, authenticated
using (bucket_id <> 'receipts' or public.can_delete_unattached_receipt(name));
drop policy if exists assets_public_read on storage.objects;
create policy assets_public_read on storage.objects for select using (bucket_id = 'assets');
drop policy if exists assets_admin_write on storage.objects;
create policy assets_admin_write on storage.objects for all to authenticated using (bucket_id = 'assets' and public.is_admin()) with check (bucket_id = 'assets' and public.is_admin());
drop policy if exists assets_insert_admin_guard on storage.objects;
create policy assets_insert_admin_guard on storage.objects as restrictive for insert to public
with check (bucket_id <> 'assets' or public.is_admin());
drop policy if exists assets_update_admin_guard on storage.objects;
create policy assets_update_admin_guard on storage.objects as restrictive for update to public
using (bucket_id <> 'assets' or public.is_admin())
with check (bucket_id <> 'assets' or public.is_admin());
drop policy if exists assets_delete_admin_guard on storage.objects;
create policy assets_delete_admin_guard on storage.objects as restrictive for delete to public
using (bucket_id <> 'assets' or public.is_admin());

-- Make an existing Supabase Auth user an admin: replace the email below, then run this statement on its own.
-- insert into public.admin_users (user_id, email)
-- select id, email from auth.users where lower(email) = lower('your-admin-email@example.com')
-- on conflict (user_id) do update set email = excluded.email;

notify pgrst, 'reload schema';
