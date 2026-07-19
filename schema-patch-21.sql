alter table jobs add column if not exists rating_professionalism int2 check (rating_professionalism between 1 and 5);
alter table jobs add column if not exists rating_communication int2 check (rating_communication between 1 and 5);
alter table jobs add column if not exists rating_speed int2 check (rating_speed between 1 and 5);
alter table jobs add column if not exists rating_parcel_condition int2 check (rating_parcel_condition between 1 and 5);
alter table jobs add column if not exists review_image_url text;
alter table jobs add column if not exists review_edited_at timestamptz;

insert into storage.buckets (id, name, public) values ('review-photos', 'review-photos', true) on conflict (id) do nothing;

drop policy if exists "review-photos public read" on storage.objects;
create policy "review-photos public read" on storage.objects
  for select using (bucket_id = 'review-photos');

drop policy if exists "review-photos owner write" on storage.objects;
create policy "review-photos owner write" on storage.objects
  for insert with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "review-photos owner update" on storage.objects;
create policy "review-photos owner update" on storage.objects
  for update using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);
