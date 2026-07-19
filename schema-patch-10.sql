-- Run in Supabase SQL editor: Reviews & Complaints module.

-- Review moderation fields (admin reply + hide) on existing job ratings.
alter table jobs add column if not exists review_hidden boolean not null default false;
alter table jobs add column if not exists review_reply text;
alter table jobs add column if not exists review_reply_at timestamptz;

-- Complaints — a separate workflow from a simple star rating: has a
-- category, priority, investigation status and staff assignment.
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references profiles (id) on delete set null,
  driver_id uuid references profiles (id) on delete set null,
  job_id uuid references jobs (id) on delete set null,
  category text not null check (category in (
    'late_delivery', 'rude_behaviour', 'dangerous_driving', 'damaged_package',
    'missing_package', 'wrong_delivery', 'fraud', 'poor_communication',
    'vehicle_hygiene', 'other'
  )),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  assigned_staff text,
  description text not null,
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  investigation_started_at timestamptz,
  driver_contacted_at timestamptz,
  customer_contacted_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz
);

alter table complaints enable row level security;

drop policy if exists "complaints admin all" on complaints;
create policy "complaints admin all" on complaints
  for all using (is_admin());

-- Internal notes / resolution history entries logged against a complaint.
create table if not exists complaint_notes (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints (id) on delete cascade,
  author text,
  note text not null,
  created_at timestamptz not null default now()
);

alter table complaint_notes enable row level security;

drop policy if exists "complaint_notes admin all" on complaint_notes;
create policy "complaint_notes admin all" on complaint_notes
  for all using (is_admin());

alter publication supabase_realtime add table complaints;
alter publication supabase_realtime add table complaint_notes;
