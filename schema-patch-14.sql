-- Run in Supabase SQL editor: Customers module internal notes.
create table if not exists customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  author text,
  note text not null,
  created_at timestamptz not null default now()
);

alter table customer_notes enable row level security;

drop policy if exists "customer_notes admin all" on customer_notes;
create policy "customer_notes admin all" on customer_notes
  for all using (is_admin());

alter publication supabase_realtime add table customer_notes;
