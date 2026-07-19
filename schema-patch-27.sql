alter table profiles add column if not exists bank_name text;
alter table profiles add column if not exists bank_account_holder text;
alter table profiles add column if not exists bank_account_number text;
alter table profiles add column if not exists bank_branch_code text;

create table if not exists withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  amount numeric not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  notes text
);

alter table withdrawal_requests enable row level security;

drop policy if exists "withdrawal_requests driver select own" on withdrawal_requests;
create policy "withdrawal_requests driver select own" on withdrawal_requests
  for select using (driver_id = auth.uid() or is_admin());

drop policy if exists "withdrawal_requests driver insert own" on withdrawal_requests;
create policy "withdrawal_requests driver insert own" on withdrawal_requests
  for insert with check (driver_id = auth.uid());

drop policy if exists "withdrawal_requests admin update" on withdrawal_requests;
create policy "withdrawal_requests admin update" on withdrawal_requests
  for update using (is_admin());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'withdrawal_requests') then
    alter publication supabase_realtime add table withdrawal_requests;
  end if;
end $$;

insert into settings (key, value) values ('min_withdrawal_amount', '100') on conflict (key) do nothing;
