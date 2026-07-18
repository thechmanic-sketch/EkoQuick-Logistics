-- Run in Supabase SQL editor: profile photos + driver document uploads and
-- verification workflow.

alter table profiles add column if not exists avatar_url text;
alter table profiles add column if not exists license_url text;
alter table profiles add column if not exists id_doc_url text;
alter table profiles add column if not exists vehicle_reg_url text;
alter table profiles add column if not exists insurance_url text;
alter table profiles add column if not exists verification_status text not null default 'pending';

alter table profiles drop constraint if exists profiles_verification_status_check;
alter table profiles add constraint profiles_verification_status_check
  check (verification_status in ('pending', 'approved', 'rejected'));

-- Storage buckets: avatars are public (so a plain <img src> works anywhere),
-- driver documents are private (only the driver themself and admins can read).
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('driver-docs', 'driver-docs', false) on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner write" on storage.objects;
create policy "driver-docs owner write" on storage.objects
  for insert with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner update" on storage.objects;
create policy "driver-docs owner update" on storage.objects
  for update using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner or admin read" on storage.objects;
create policy "driver-docs owner or admin read" on storage.objects
  for select using (bucket_id = 'driver-docs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));
