create table if not exists saved_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  address_type text not null default 'other'
    check (address_type in ('home', 'work', 'business', 'warehouse', 'family', 'other')),
  street text not null,
  suburb text,
  city text,
  province text,
  postal_code text,
  lat double precision,
  lng double precision,
  contact_person text,
  contact_phone text,
  contact_email text,
  notes text,
  is_default_pickup boolean not null default false,
  is_default_dropoff boolean not null default false,
  created_at timestamptz not null default now()
);

alter table saved_addresses enable row level security;

drop policy if exists "saved_addresses owner all" on saved_addresses;
create policy "saved_addresses owner all" on saved_addresses
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());
