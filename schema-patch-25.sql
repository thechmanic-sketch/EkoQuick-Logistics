alter table jobs add column if not exists arrived_at_pickup_at timestamptz;
alter table jobs add column if not exists arrived_at_dropoff_at timestamptz;
alter table jobs add column if not exists delivery_photo_url text;
alter table jobs add column if not exists delivery_signature_url text;
alter table jobs add column if not exists delivery_photo_lat double precision;
alter table jobs add column if not exists delivery_photo_lng double precision;

insert into storage.buckets (id, name, public) values ('delivery-proofs', 'delivery-proofs', true) on conflict (id) do nothing;

drop policy if exists "delivery-proofs public read" on storage.objects;
create policy "delivery-proofs public read" on storage.objects
  for select using (bucket_id = 'delivery-proofs');

drop policy if exists "delivery-proofs owner write" on storage.objects;
create policy "delivery-proofs owner write" on storage.objects
  for insert with check (bucket_id = 'delivery-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "delivery-proofs owner update" on storage.objects;
create policy "delivery-proofs owner update" on storage.objects
  for update using (bucket_id = 'delivery-proofs' and (storage.foldername(name))[1] = auth.uid()::text);
