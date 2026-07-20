-- Public contact form submissions (contact.html). Anonymous visitors can
-- insert; only admins can read. Without this the contact form would have
-- nowhere real to send its data.
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'resolved')),
  created_at timestamptz not null default now()
);

alter table contact_messages enable row level security;

drop policy if exists "contact_messages anyone can insert" on contact_messages;
create policy "contact_messages anyone can insert" on contact_messages
  for insert with check (true);

drop policy if exists "contact_messages admin read" on contact_messages;
create policy "contact_messages admin read" on contact_messages
  for select using (is_admin());

drop policy if exists "contact_messages admin update" on contact_messages;
create policy "contact_messages admin update" on contact_messages
  for update using (is_admin());

create index if not exists idx_contact_messages_status on contact_messages (status);
