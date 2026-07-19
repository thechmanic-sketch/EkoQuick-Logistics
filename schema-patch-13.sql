-- Run in Supabase SQL editor: Dispatch Center assignment/reassignment log.
create table if not exists dispatch_log (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  action text not null check (action in ('assign', 'reassign')),
  previous_driver_id uuid references profiles (id) on delete set null,
  new_driver_id uuid references profiles (id) on delete set null,
  admin_name text,
  created_at timestamptz not null default now()
);

alter table dispatch_log enable row level security;

drop policy if exists "dispatch_log admin all" on dispatch_log;
create policy "dispatch_log admin all" on dispatch_log
  for all using (is_admin());

alter publication supabase_realtime add table dispatch_log;
