create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  category text not null check (category in (
    'delivery_issue', 'driver_complaint', 'payment_issue', 'technical_problem', 'missing_parcel', 'damaged_parcel', 'other'
  )),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_customer', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table support_tickets enable row level security;

drop policy if exists "support_tickets customer select own" on support_tickets;
create policy "support_tickets customer select own" on support_tickets
  for select using (customer_id = auth.uid() or is_admin());

drop policy if exists "support_tickets customer insert own" on support_tickets;
create policy "support_tickets customer insert own" on support_tickets
  for insert with check (customer_id = auth.uid());

drop policy if exists "support_tickets customer or admin update" on support_tickets;
create policy "support_tickets customer or admin update" on support_tickets
  for update using (customer_id = auth.uid() or is_admin());

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets (id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'staff')),
  sender_name text not null,
  message text not null,
  attachment_url text,
  created_at timestamptz not null default now()
);

alter table support_ticket_messages enable row level security;

drop policy if exists "support_ticket_messages select own ticket or admin" on support_ticket_messages;
create policy "support_ticket_messages select own ticket or admin" on support_ticket_messages
  for select using (
    is_admin() or exists (select 1 from support_tickets t where t.id = ticket_id and t.customer_id = auth.uid())
  );

drop policy if exists "support_ticket_messages insert own ticket or admin" on support_ticket_messages;
create policy "support_ticket_messages insert own ticket or admin" on support_ticket_messages
  for insert with check (
    is_admin() or exists (select 1 from support_tickets t where t.id = ticket_id and t.customer_id = auth.uid())
  );

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_tickets') then
    alter publication supabase_realtime add table support_tickets;
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_ticket_messages') then
    alter publication supabase_realtime add table support_ticket_messages;
  end if;
end $$;

insert into storage.buckets (id, name, public) values ('support-attachments', 'support-attachments', false) on conflict (id) do nothing;

drop policy if exists "support-attachments owner write" on storage.objects;
create policy "support-attachments owner write" on storage.objects
  for insert with check (bucket_id = 'support-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "support-attachments owner or admin read" on storage.objects;
create policy "support-attachments owner or admin read" on storage.objects
  for select using (bucket_id = 'support-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
