-- Enterprise Pricing Engine — single source of truth for every delivery quote.
-- All pricing lives in these tables, editable from Admin > Pricing Engine.
-- Every job stores a frozen snapshot (jobs.pricing_breakdown) of the pricing
-- rules used at booking time, so future pricing changes never alter
-- historical jobs' recorded fares/commissions.

create table if not exists pricing_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_id text unique not null,
  label text not null,
  icon text not null default '',
  base_fare numeric not null,
  price_per_km numeric not null,
  minimum_fare numeric not null default 0,
  max_weight_kg numeric,
  max_volume_m3 numeric,
  waiting_charge_per_min numeric not null default 0,
  extra_stop_charge numeric not null default 0,
  priority_multiplier numeric not null default 1,
  driver_commission_pct numeric not null default 85,
  platform_commission_pct numeric not null default 15,
  fuel_type text not null default 'petrol' check (fuel_type in ('petrol', 'diesel', 'electric')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pricing_distance_bands (
  id uuid primary key default gen_random_uuid(),
  min_km numeric not null,
  max_km numeric,
  rate_multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_weight_bands (
  id uuid primary key default gen_random_uuid(),
  min_kg numeric not null,
  max_kg numeric,
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_parcel_categories (
  id uuid primary key default gen_random_uuid(),
  category text unique not null,
  handling_fee numeric not null default 0,
  insurance_pct numeric not null default 0,
  requires_signature boolean not null default false,
  requires_otp boolean not null default true,
  requires_photo boolean not null default false,
  sort_order int not null default 0
);

create table if not exists pricing_traffic_multipliers (
  id uuid primary key default gen_random_uuid(),
  level text unique not null check (level in ('light', 'moderate', 'heavy', 'severe')),
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_route_difficulty (
  id uuid primary key default gen_random_uuid(),
  route_type text unique not null check (route_type in ('highway', 'urban', 'residential', 'industrial', 'rural', 'gravel', 'mountain')),
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_priority_levels (
  id uuid primary key default gen_random_uuid(),
  level text unique not null check (level in ('normal', 'scheduled', 'express', 'immediate')),
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_corporate_discounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references profiles (id) on delete cascade,
  label text not null,
  min_monthly_volume int not null default 0,
  min_monthly_spend numeric not null default 0,
  discount_pct numeric not null default 0,
  custom_rate_per_km numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists pricing_promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed', 'free_delivery')),
  discount_value numeric not null default 0,
  max_uses int,
  uses_count int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Fix a real pre-existing bug: "Request a Pickup" sets package_type =
-- 'store_pickup', but the CHECK constraint below never allowed that value,
-- so every pickup-mode booking would fail at insert time.
alter table jobs drop constraint if exists jobs_package_type_check;
alter table jobs add constraint jobs_package_type_check
  check (package_type in ('documents', 'parcel', 'electronics', 'food', 'clothing', 'furniture', 'other', 'store_pickup'));

-- Freeze the exact pricing rules used for each job, so future admin edits
-- to the tables above never retroactively change a historical job's fare,
-- driver earning, or commission.
alter table jobs add column if not exists pricing_breakdown jsonb;

-- Seed with the values already live in config.js's VEHICLES array, so
-- switching the engine on doesn't silently change today's prices.
insert into pricing_vehicles (vehicle_id, label, icon, base_fare, price_per_km, minimum_fare, driver_commission_pct, platform_commission_pct, sort_order)
values
  ('bike', 'Bike', '🏍️', 25, 5.00, 25, 85, 15, 1),
  ('smallcar', 'Small Car', '🚗', 35, 7.00, 35, 85, 15, 2),
  ('bakkie', 'Bakkie', '🛻', 80, 12.00, 80, 85, 15, 3),
  ('truck12', '1–2 Ton Truck', '🚚', 150, 18.00, 150, 85, 15, 4),
  ('truck7', '7 Ton Truck', '🚛', 250, 25.00, 250, 85, 15, 5)
on conflict (vehicle_id) do nothing;

insert into pricing_distance_bands (min_km, max_km, rate_multiplier, sort_order)
select * from (values
  (0::numeric, 5::numeric, 1::numeric, 1),
  (5, 20, 1, 2),
  (20, 50, 1, 3),
  (50, 100, 1, 4),
  (100, null, 1, 5)
) as v(min_km, max_km, rate_multiplier, sort_order)
where not exists (select 1 from pricing_distance_bands);

insert into pricing_weight_bands (min_kg, max_kg, multiplier, sort_order)
select * from (values
  (0::numeric, 5::numeric, 1::numeric, 1),
  (5, 20, 1, 2),
  (20, 50, 1.1, 3),
  (50, 100, 1.2, 4),
  (100, 250, 1.35, 5),
  (250, 500, 1.5, 6),
  (500, 1000, 1.75, 7),
  (1000, 2000, 2, 8),
  (2000, 7000, 2.5, 9)
) as v(min_kg, max_kg, multiplier, sort_order)
where not exists (select 1 from pricing_weight_bands);

-- Keyed to the exact package_type values the booking wizard actually
-- produces (new-delivery.html #packageType), not a separate fictional list —
-- otherwise every real booking would fail to match a category and silently
-- get a R0 handling fee.
insert into pricing_parcel_categories (category, handling_fee, insurance_pct, requires_signature, requires_otp, requires_photo, sort_order) values
  ('documents', 0, 0, false, true, false, 1),
  ('parcel', 0, 0, false, true, false, 2),
  ('food', 0, 0, false, true, false, 3),
  ('clothing', 5, 0, false, true, false, 4),
  ('electronics', 15, 2, true, true, true, 5),
  ('furniture', 20, 1, true, true, true, 6),
  ('other', 5, 0, false, true, false, 7),
  ('store_pickup', 5, 1, false, true, false, 8)
on conflict (category) do nothing;

insert into pricing_traffic_multipliers (level, multiplier, sort_order) values
  ('light', 1, 1),
  ('moderate', 1.1, 2),
  ('heavy', 1.25, 3),
  ('severe', 1.5, 4)
on conflict (level) do nothing;

insert into pricing_route_difficulty (route_type, multiplier, sort_order) values
  ('highway', 1, 1),
  ('urban', 1.05, 2),
  ('residential', 1.1, 3),
  ('industrial', 1.1, 4),
  ('rural', 1.15, 5),
  ('gravel', 1.3, 6),
  ('mountain', 1.4, 7)
on conflict (route_type) do nothing;

insert into pricing_priority_levels (level, multiplier, sort_order) values
  ('normal', 1, 1),
  ('scheduled', 1, 2),
  ('express', 1.5, 3),
  ('immediate', 1.75, 4)
on conflict (level) do nothing;

insert into settings (key, value) values
  ('pricing_waiting_free_minutes', '10'),
  ('pricing_waiting_charge_per_min', '2'),
  ('pricing_waiting_max_charge', '100'),
  ('pricing_extra_stop_price', '20'),
  ('pricing_extra_stop_max', '5'),
  ('pricing_fuel_petrol_price', '23.50'),
  ('pricing_fuel_diesel_price', '21.50'),
  ('pricing_fuel_base_petrol_price', '23.50'),
  ('pricing_fuel_base_diesel_price', '21.50'),
  ('pricing_fuel_adjustment_sensitivity', '0.5'),
  ('pricing_vat_enabled', 'false'),
  ('pricing_vat_pct', '15'),
  ('pricing_google_routes_api_key', '')
on conflict (key) do nothing;

alter table pricing_vehicles enable row level security;
alter table pricing_distance_bands enable row level security;
alter table pricing_weight_bands enable row level security;
alter table pricing_parcel_categories enable row level security;
alter table pricing_traffic_multipliers enable row level security;
alter table pricing_route_difficulty enable row level security;
alter table pricing_priority_levels enable row level security;
alter table pricing_corporate_discounts enable row level security;
alter table pricing_promotions enable row level security;

drop policy if exists "pricing_vehicles public read" on pricing_vehicles;
create policy "pricing_vehicles public read" on pricing_vehicles for select using (true);
drop policy if exists "pricing_vehicles admin write" on pricing_vehicles;
create policy "pricing_vehicles admin write" on pricing_vehicles for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_distance_bands public read" on pricing_distance_bands;
create policy "pricing_distance_bands public read" on pricing_distance_bands for select using (true);
drop policy if exists "pricing_distance_bands admin write" on pricing_distance_bands;
create policy "pricing_distance_bands admin write" on pricing_distance_bands for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_weight_bands public read" on pricing_weight_bands;
create policy "pricing_weight_bands public read" on pricing_weight_bands for select using (true);
drop policy if exists "pricing_weight_bands admin write" on pricing_weight_bands;
create policy "pricing_weight_bands admin write" on pricing_weight_bands for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_parcel_categories public read" on pricing_parcel_categories;
create policy "pricing_parcel_categories public read" on pricing_parcel_categories for select using (true);
drop policy if exists "pricing_parcel_categories admin write" on pricing_parcel_categories;
create policy "pricing_parcel_categories admin write" on pricing_parcel_categories for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_traffic_multipliers public read" on pricing_traffic_multipliers;
create policy "pricing_traffic_multipliers public read" on pricing_traffic_multipliers for select using (true);
drop policy if exists "pricing_traffic_multipliers admin write" on pricing_traffic_multipliers;
create policy "pricing_traffic_multipliers admin write" on pricing_traffic_multipliers for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_route_difficulty public read" on pricing_route_difficulty;
create policy "pricing_route_difficulty public read" on pricing_route_difficulty for select using (true);
drop policy if exists "pricing_route_difficulty admin write" on pricing_route_difficulty;
create policy "pricing_route_difficulty admin write" on pricing_route_difficulty for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_priority_levels public read" on pricing_priority_levels;
create policy "pricing_priority_levels public read" on pricing_priority_levels for select using (true);
drop policy if exists "pricing_priority_levels admin write" on pricing_priority_levels;
create policy "pricing_priority_levels admin write" on pricing_priority_levels for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_corporate_discounts admin all" on pricing_corporate_discounts;
create policy "pricing_corporate_discounts admin all" on pricing_corporate_discounts for all using (is_admin()) with check (is_admin());
drop policy if exists "pricing_corporate_discounts self read" on pricing_corporate_discounts;
create policy "pricing_corporate_discounts self read" on pricing_corporate_discounts for select using (customer_id = auth.uid());

drop policy if exists "pricing_promotions public read active" on pricing_promotions;
create policy "pricing_promotions public read active" on pricing_promotions for select using (active = true);
drop policy if exists "pricing_promotions admin write" on pricing_promotions;
create policy "pricing_promotions admin write" on pricing_promotions for all using (is_admin()) with check (is_admin());

create index if not exists idx_pricing_corporate_discounts_customer on pricing_corporate_discounts (customer_id);
create index if not exists idx_pricing_promotions_code on pricing_promotions (code);
