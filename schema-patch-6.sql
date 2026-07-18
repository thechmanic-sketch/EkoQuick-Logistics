-- Run in Supabase SQL editor: online/offline presence, job phase timestamps,
-- account status (pause/ban), and an editable platform settings table
-- (so the commission rate can be changed without a code deploy).

alter table profiles add column if not exists last_seen_at timestamptz;
alter table profiles add column if not exists account_status text not null default 'active';
alter table profiles drop constraint if exists profiles_account_status_check;
alter table profiles add constraint profiles_account_status_check
  check (account_status in ('active', 'paused', 'banned'));

alter table jobs add column if not exists to_pickup_at timestamptz;
alter table jobs add column if not exists to_dropoff_at timestamptz;
alter table jobs add column if not exists delivered_at timestamptz;

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
