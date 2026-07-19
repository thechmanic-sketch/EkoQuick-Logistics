-- Ekoquick — full database setup.
-- Run this once in the Supabase SQL editor on a fresh project.
-- (If you already ran the old schema.sql on an existing project, you don't
-- need this — schema.sql only carries the incremental changes on top of it.)

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('customer', 'driver', 'admin')),
  full_name text not null,
  username text unique,
  email text,
  phone text,
  vehicle_class text,
  last_lat double precision,
  last_lng double precision,
  last_seen_at timestamptz,
  account_status text not null default 'active'
    check (account_status in ('active', 'paused', 'banned')),
  avatar_url text,
  license_url text,
  id_doc_url text,
  vehicle_reg_url text,
  insurance_url text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles select own or admin" on profiles;
create policy "profiles select own or admin" on profiles
  for select using (id = auth.uid() or is_admin());

drop policy if exists "profiles select driver names" on profiles;
create policy "profiles select driver names" on profiles
  for select using (role = 'driver');

drop policy if exists "profiles insert own" on profiles;
create policy "profiles insert own" on profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles update own or admin" on profiles;
create policy "profiles update own or admin" on profiles
  for update using (id = auth.uid() or is_admin());

-- Looks up a user's email by username so the client can log in with
-- "username" while Supabase Auth itself only accepts email + password.
create or replace function get_email_by_username(uname text)
returns text
language sql
security definer
stable
as $$
  select email from profiles where username = uname limit 1;
$$;

grant execute on function get_email_by_username(text) to anon, authenticated;

-- Auto-create a profiles row whenever a new auth user signs up, reading
-- the role/full_name/username/phone that the client passed as signUp()
-- metadata. Runs as security definer so it isn't blocked by RLS even
-- when the client has no active session yet (e.g. email confirmation
-- pending) — this is what actually lets signup work.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, role, full_name, username, email, phone, vehicle_class)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'username',
    new.email,
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'vehicle_class'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  driver_id uuid references profiles (id) on delete set null,
  pickup text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff text not null,
  dropoff_lat double precision,
  dropoff_lng double precision,
  vehicle text not null,
  distance numeric,
  duration numeric,
  quote numeric not null,
  customer_phone text,
  receiver_name text,
  receiver_phone text,
  collection_code text,
  delivery_code text,
  status text not null default 'pending'
    check (status in ('pending', 'offered', 'to_pickup', 'to_dropoff', 'delivered', 'cancelled')),
  driver_lat double precision,
  driver_lng double precision,
  rating int2 check (rating between 1 and 5),
  rating_comment text,
  to_pickup_at timestamptz,
  to_dropoff_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);

alter table jobs enable row level security;

drop policy if exists "jobs select own or driver or admin" on jobs;
create policy "jobs select own or driver or admin" on jobs
  for select using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "jobs insert own" on jobs;
create policy "jobs insert own" on jobs
  for insert with check (customer_id = auth.uid());

drop policy if exists "jobs update own or driver or admin" on jobs;
create policy "jobs update own or driver or admin" on jobs
  for update using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

-- Enable realtime updates on jobs (used for live tracking + dashboard refresh)
alter publication supabase_realtime add table jobs;

-- ---------------------------------------------------------------------
-- Storage: profile photos (public) + driver documents (private)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('driver-docs', 'driver-docs', false) on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner write" on storage.objects;
create policy "driver-docs owner write" on storage.objects
  for insert with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner update" on storage.objects;
create policy "driver-docs owner update" on storage.objects
  for update using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner or admin read" on storage.objects;
create policy "driver-docs owner or admin read" on storage.objects
  for select using (bucket_id = 'driver-docs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- ---------------------------------------------------------------------
-- Platform settings (e.g. commission rate) — editable without a code deploy
-- ---------------------------------------------------------------------
create table if not exists settings (
  key text primary key,
  value text not null
);
insert into settings (key, value) values ('driver_share', '0.85') on conflict (key) do nothing;

alter table settings enable row level security;

drop policy if exists "settings public read" on settings;
create policy "settings public read" on settings for select using (true);

drop policy if exists "settings admin write" on settings;
create policy "settings admin write" on settings for update using (is_admin());

-- ---------------------------------------------------------------------
-- Admin account
-- ---------------------------------------------------------------------
-- Admin signup is not public. Create the admin's auth user first via
-- Supabase Dashboard -> Authentication -> Add user, then run:
--
--   insert into profiles (id, role, full_name, username, email)
--   values ('<the-new-user-uuid>', 'admin', 'Admin Name', 'admin', 'admin@example.com');
