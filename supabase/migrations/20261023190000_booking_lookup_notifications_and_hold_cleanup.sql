-- Safe, additive update for existing databases. Do not rerun supabase-schema.md
-- against production because that setup script rebuilds the booking tables.

create table if not exists public.notification_settings (
  id smallint primary key default 1 check (id = 1),
  owner_notification_email text,
  updated_at timestamptz not null default now()
);

insert into public.notification_settings (id)
values (1)
on conflict (id) do nothing;

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon, authenticated;
grant select, update on public.notification_settings to authenticated;

drop policy if exists notification_settings_admin_read on public.notification_settings;
create policy notification_settings_admin_read
  on public.notification_settings for select to authenticated
  using (public.is_admin());

drop policy if exists notification_settings_admin_update on public.notification_settings;
create policy notification_settings_admin_update
  on public.notification_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create index if not exists booking_holds_hold_expires_at_idx
  on public.booking_holds (hold_expires_at);

create or replace function public.expire_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.booking_holds where hold_expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;

revoke all on function public.expire_holds() from public, anon, authenticated;

-- Remove old expired rows and keep the table bounded going forward.
select public.expire_holds();

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'purge-expired-booking-holds'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule(
    'purge-expired-booking-holds',
    '*/10 * * * *',
    'select public.expire_holds();'
  );
end
$$;

-- Keep exactly one RPC signature: competing UUID/text overloads cause PostgREST
-- to return PGRST203 when both JSON arguments contain UUID values.
drop function if exists public.get_my_booking(uuid, text);
drop function if exists public.get_my_booking(uuid, uuid);

create function public.get_my_booking(p_booking_id uuid, p_access_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hold public.booking_holds;
  bk public.bookings;
  cname text;
begin
  select * into bk
  from public.bookings
  where id = p_booking_id and access_token = p_access_token;

  if bk.id is not null then
    select name into cname from public.courts where id = bk.court_id;
    return jsonb_build_object(
      'booking_id', bk.id,
      'status', bk.status,
      'booking_date', bk.booking_date,
      'court_name', cname,
      'hours', (
        select coalesce(jsonb_agg(slot_hour order by slot_hour), '[]'::jsonb)
        from public.booking_slots
        where booking_id = bk.id
      ),
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

  select * into hold
  from public.booking_holds
  where id = p_booking_id and access_token = p_access_token;
  if hold.id is null then raise exception 'BOOKING_NOT_FOUND'; end if;

  select name into cname from public.courts where id = hold.court_id;
  return jsonb_build_object(
    'booking_id', hold.id,
    'status', case when hold.hold_expires_at > now() then 'held' else 'expired' end,
    'booking_date', hold.booking_date,
    'court_name', cname,
    'hours', to_jsonb(hold.slot_hours),
    'hourly_rate', hold.hourly_rate,
    'total_amount', hold.hourly_rate * cardinality(hold.slot_hours),
    'hold_expires_at', hold.hold_expires_at,
    'first_name', null,
    'last_name', null
  );
end
$$;

grant execute on function public.get_my_booking(uuid, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
