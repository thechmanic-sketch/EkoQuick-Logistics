-- Run in Supabase SQL editor: Commissions module — vehicle-class/driver/
-- campaign overrides on top of the existing default driver_share setting,
-- plus a full change-history log.

create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null check (rule_type in ('vehicle_class', 'driver', 'campaign')),
  vehicle_class text,
  driver_id uuid references profiles (id) on delete cascade,
  start_date date,
  end_date date,
  driver_share numeric not null check (driver_share >= 0 and driver_share <= 1),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

alter table commission_rules enable row level security;

drop policy if exists "commission_rules admin all" on commission_rules;
create policy "commission_rules admin all" on commission_rules
  for all using (is_admin());

drop policy if exists "commission_rules public read active" on commission_rules;
create policy "commission_rules public read active" on commission_rules
  for select using (active = true);

create table if not exists commission_history (
  id uuid primary key default gen_random_uuid(),
  changed_by text,
  scope text not null,
  previous_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

alter table commission_history enable row level security;

drop policy if exists "commission_history admin all" on commission_history;
create policy "commission_history admin all" on commission_history
  for all using (is_admin());

alter publication supabase_realtime add table commission_rules;
alter publication supabase_realtime add table commission_history;
