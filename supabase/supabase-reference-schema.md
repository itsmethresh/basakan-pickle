-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.
-- Includes notification_settings and hold/booking security additions from the
-- additive migrations dated 20261023.

CREATE TABLE public.courts (
  id smallint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT courts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.settings (
  id smallint NOT NULL DEFAULT 1 CHECK (id = 1),
  business_name text NOT NULL DEFAULT 'Pickleball Courts'::text,
  hourly_rate numeric NOT NULL DEFAULT 200 CHECK (hourly_rate >= 0::numeric),
  open_hour smallint NOT NULL DEFAULT 5 CHECK (open_hour >= 0 AND open_hour <= 23),
  close_hour smallint NOT NULL DEFAULT 24 CHECK (close_hour >= 1 AND close_hour <= 24),
  hold_minutes smallint NOT NULL DEFAULT 10 CHECK (hold_minutes >= 1 AND hold_minutes <= 60),
  gcash_qr_path text,
  gcash_account_name text,
  gcash_number text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.notification_settings (
  id smallint NOT NULL DEFAULT 1 CHECK (id = 1),
  owner_notification_email text,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT notification_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.admin_users (
  user_id uuid NOT NULL,
  email text,
  CONSTRAINT admin_users_pkey PRIMARY KEY (user_id),
  CONSTRAINT admin_users_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.bookings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  reference_code text NOT NULL UNIQUE,
  access_token uuid NOT NULL DEFAULT gen_random_uuid(),
  court_id smallint NOT NULL,
  booking_date date NOT NULL,
  first_name text,
  last_name text,
  phone text CHECK (phone IS NULL OR phone ~ '^(09|\+639)[0-9]{9}$'::text),
  email text,
  total_hours smallint NOT NULL CHECK (total_hours > 0),
  hourly_rate numeric NOT NULL,
  total_amount numeric NOT NULL,
  receipt_path text,
  status USER-DEFINED NOT NULL DEFAULT 'pending'::booking_status,
  hold_expires_at timestamp with time zone,
  admin_notes text,
  submitted_at timestamp with time zone,
  confirmed_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT bookings_pkey PRIMARY KEY (id),
  CONSTRAINT bookings_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id)
);
CREATE TABLE public.booking_slots (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  booking_id uuid NOT NULL,
  court_id smallint NOT NULL,
  booking_date date NOT NULL,
  slot_hour smallint NOT NULL CHECK (slot_hour >= 0 AND slot_hour <= 23),
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT booking_slots_pkey PRIMARY KEY (id),
  CONSTRAINT booking_slots_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES public.bookings(id),
  CONSTRAINT booking_slots_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id)
);
CREATE TABLE public.booking_holds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  access_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  court_id smallint NOT NULL,
  booking_date date NOT NULL,
  slot_hours ARRAY NOT NULL CHECK (cardinality(slot_hours) > 0),
  hourly_rate numeric NOT NULL CHECK (hourly_rate >= 0::numeric),
  hold_expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT booking_holds_pkey PRIMARY KEY (id),
  CONSTRAINT booking_holds_court_id_fkey FOREIGN KEY (court_id) REFERENCES public.courts(id)
);
CREATE INDEX booking_holds_hold_expires_at_idx
  ON public.booking_holds USING btree (hold_expires_at);
CREATE UNIQUE INDEX active_booking_slot_key
  ON public.booking_slots USING btree (court_id, booking_date, slot_hour)
  WHERE is_active;

-- The customer summary RPC must have one unambiguous overload on deployed
-- databases: public.get_my_booking(uuid, uuid) -> jsonb.
-- Remove legacy get_my_booking(uuid, text) overloads when applying the additive
-- migration; PostgREST otherwise returns PGRST203 for UUID booking links.

-- Transaction RPCs on deployed schemas use UUID access tokens:
-- hold_slots(integer, date, integer[])
-- cancel_hold(uuid, uuid)
-- submit_payment(uuid, uuid, text, text, text, text, text)
-- admin_delete_booking(uuid) -> text receipt_path
-- The transaction-hardening migration detects the deployed slot_hours integer
-- array type at runtime and safely casts the hold_slots input to match.
-- booking and slot table writes are restricted to admins by RLS policies.
--
-- The private receipts bucket is limited to 5 MiB and image/jpeg, image/png,
-- image/webp. Uploads require an unexpired hold folder; deletion is allowed
-- only for a receipt path not referenced by a booking. Restrictive storage
-- policies prevent older permissive rules from bypassing receipt protections.