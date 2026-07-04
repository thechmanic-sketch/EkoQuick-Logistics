-- Ekoquick unified app schema (run in Supabase SQL editor)

create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('customer','driver','admin')),
  full_name text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  driver_id uuid references profiles(id) on delete set null,
  pickup text not null,
  dropoff text not null,
  vehicle text not null,
  distance numeric,
  duration text,
  quote numeric,
  customer_phone text,
  status text not null default 'pending' check (status in ('pending','assigned','in_progress','delivered','cancelled')),
  driver_lat double precision,
  driver_lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_customer_id_idx on jobs(customer_id);
create index if not exists jobs_driver_id_idx on jobs(driver_id);

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles enable row level security;
alter table jobs enable row level security;

drop policy if exists "profiles select own or admin" on profiles;
create policy "profiles select own or admin" on profiles
  for select using (id = auth.uid() or is_admin());

drop policy if exists "profiles insert own" on profiles;
create policy "profiles insert own" on profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles update own or admin" on profiles;
create policy "profiles update own or admin" on profiles
  for update using (id = auth.uid() or is_admin());

drop policy if exists "jobs select own or admin" on jobs;
create policy "jobs select own or admin" on jobs
  for select using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "jobs insert own" on jobs;
create policy "jobs insert own" on jobs
  for insert with check (customer_id = auth.uid());

drop policy if exists "jobs update driver or admin" on jobs;
create policy "jobs update driver or admin" on jobs
  for update using (driver_id = auth.uid() or is_admin());

-- Realtime for live tracking
alter publication supabase_realtime add table jobs;
