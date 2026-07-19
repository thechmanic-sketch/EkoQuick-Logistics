-- Run in Supabase SQL editor: supporting images/files on complaints.

insert into storage.buckets (id, name, public) values ('complaint-evidence', 'complaint-evidence', false) on conflict (id) do nothing;

drop policy if exists "complaint-evidence admin all" on storage.objects;
create policy "complaint-evidence admin all" on storage.objects
  for all using (bucket_id = 'complaint-evidence' and is_admin());

create table if not exists complaint_attachments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text,
  uploaded_by text,
  created_at timestamptz not null default now()
);

alter table complaint_attachments enable row level security;

drop policy if exists "complaint_attachments admin all" on complaint_attachments;
create policy "complaint_attachments admin all" on complaint_attachments
  for all using (is_admin());

alter publication supabase_realtime add table complaint_attachments;
