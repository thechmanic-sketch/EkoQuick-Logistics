-- Documents: police clearance + rejection reason
alter table profiles add column if not exists police_clearance_url text;
alter table profiles add column if not exists police_clearance_expiry date;
alter table profiles add column if not exists documents_rejected_reason text;

-- Vehicle: photo, VIN, licence disc, roadworthy
alter table profiles add column if not exists vehicle_photo_url text;
alter table profiles add column if not exists vehicle_vin text;
alter table profiles add column if not exists license_disc_url text;
alter table profiles add column if not exists license_disc_expiry date;
alter table profiles add column if not exists roadworthy_url text;
alter table profiles add column if not exists roadworthy_expiry date;

-- Driver notification preferences
alter table profiles add column if not exists dnotif_new_job boolean not null default true;
alter table profiles add column if not exists dnotif_job_cancelled boolean not null default true;
alter table profiles add column if not exists dnotif_payment_received boolean not null default true;
alter table profiles add column if not exists dnotif_weekly_summary boolean not null default true;
alter table profiles add column if not exists dnotif_support_reply boolean not null default true;
alter table profiles add column if not exists dnotif_promotion boolean not null default true;
alter table profiles add column if not exists dnotif_maintenance_reminder boolean not null default true;
alter table profiles add column if not exists dnotif_document_expiring boolean not null default true;
alter table profiles add column if not exists dnotif_account_status boolean not null default true;

-- Referrals
alter table profiles add column if not exists referral_code text unique;

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles (id) on delete cascade,
  referred_id uuid references profiles (id) on delete set null,
  referred_role text not null check (referred_role in ('driver', 'customer')),
  reward_amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  created_at timestamptz not null default now()
);

alter table referrals enable row level security;

drop policy if exists "referrals referrer select own" on referrals;
create policy "referrals referrer select own" on referrals
  for select using (referrer_id = auth.uid() or is_admin());

drop policy if exists "referrals insert own" on referrals;
create policy "referrals insert own" on referrals
  for insert with check (true);

drop policy if exists "referrals admin update" on referrals;
create policy "referrals admin update" on referrals
  for update using (is_admin());

-- Expenses (self-logged by driver)
create table if not exists driver_expenses (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  category text not null check (category in ('fuel', 'repairs', 'parking', 'tolls', 'maintenance', 'other')),
  amount numeric not null,
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

alter table driver_expenses enable row level security;

drop policy if exists "driver_expenses owner all" on driver_expenses;
create policy "driver_expenses owner all" on driver_expenses
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

-- Shifts (clock in/out + breaks)
create table if not exists driver_shifts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  break_start_at timestamptz,
  total_break_minutes int not null default 0,
  created_at timestamptz not null default now()
);

alter table driver_shifts enable row level security;

drop policy if exists "driver_shifts owner all" on driver_shifts;
create policy "driver_shifts owner all" on driver_shifts
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_shifts') then
    alter publication supabase_realtime add table driver_shifts;
  end if;
end $$;
