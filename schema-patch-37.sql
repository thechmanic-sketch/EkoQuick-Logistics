-- Ekoquick Store — Phase 1 (pilot) schema.
-- Adds a 'supplier' profile role plus the marketplace tables: supplier_details,
-- products, store_orders, order_items, cart_items, supplier_payouts.
-- Store deliveries reuse the existing jobs table (one job per supplier per
-- checkout) — nothing about dispatch, tracking or OTP codes changes.

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('customer', 'driver', 'admin', 'supplier'));

-- ---------------------------------------------------------------------
-- supplier_details — one row per supplier profile
-- ---------------------------------------------------------------------
create table if not exists supplier_details (
  id uuid primary key references profiles (id) on delete cascade,
  business_name text not null,
  pickup_address text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  id_doc_url text,
  business_reg_url text,
  bank_name text,
  account_number text,
  account_holder text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected')),
  commission_override numeric,
  created_at timestamptz not null default now()
);

alter table supplier_details enable row level security;

drop policy if exists "supplier reads own details" on supplier_details;
create policy "supplier reads own details" on supplier_details
  for select using (id = auth.uid() or is_admin());

drop policy if exists "supplier updates own details" on supplier_details;
create policy "supplier updates own details" on supplier_details
  for update using (id = auth.uid() or is_admin());

drop policy if exists "supplier inserts own details" on supplier_details;
create policy "supplier inserts own details" on supplier_details
  for insert with check (id = auth.uid());

-- ---------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  description text,
  price numeric not null check (price > 0),
  photo_url text,
  stock_count int not null default 0 check (stock_count >= 0),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table products enable row level security;

drop policy if exists "anyone reads approved active products" on products;
create policy "anyone reads approved active products" on products
  for select using (
    (approval_status = 'approved' and active = true)
    or supplier_id = auth.uid()
    or is_admin()
  );

drop policy if exists "supplier manages own products" on products;
create policy "supplier manages own products" on products
  for all using (supplier_id = auth.uid() or is_admin())
  with check (supplier_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- cart_items
-- ---------------------------------------------------------------------
create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  qty int not null default 1 check (qty > 0),
  created_at timestamptz not null default now(),
  unique (customer_id, product_id)
);

alter table cart_items enable row level security;

drop policy if exists "customer manages own cart" on cart_items;
create policy "customer manages own cart" on cart_items
  for all using (customer_id = auth.uid())
  with check (customer_id = auth.uid());

-- ---------------------------------------------------------------------
-- store_orders — one row per supplier per checkout, linked to a jobs row
-- for the actual delivery leg
-- ---------------------------------------------------------------------
create table if not exists store_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  supplier_id uuid not null references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  subtotal numeric not null,
  platform_fee numeric not null default 2,
  status text not null default 'pending'
    check (status in ('pending', 'ready', 'cancelled_by_supplier', 'in_delivery', 'delivered', 'cancelled')),
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text
);

alter table store_orders enable row level security;

drop policy if exists "customer reads own store orders" on store_orders;
create policy "customer reads own store orders" on store_orders
  for select using (customer_id = auth.uid() or supplier_id = auth.uid() or is_admin());

drop policy if exists "customer inserts own store orders" on store_orders;
create policy "customer inserts own store orders" on store_orders
  for insert with check (customer_id = auth.uid());

drop policy if exists "supplier updates own store orders" on store_orders;
create policy "supplier updates own store orders" on store_orders
  for update using (supplier_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------------
-- order_items
-- ---------------------------------------------------------------------
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  store_order_id uuid not null references store_orders (id) on delete cascade,
  product_id uuid not null references products (id),
  title text not null,
  qty int not null,
  unit_price numeric not null
);

alter table order_items enable row level security;

drop policy if exists "order items follow parent order" on order_items;
create policy "order items follow parent order" on order_items
  for select using (
    exists (
      select 1 from store_orders so
      where so.id = order_items.store_order_id
        and (so.customer_id = auth.uid() or so.supplier_id = auth.uid() or is_admin())
    )
  );

drop policy if exists "customer inserts own order items" on order_items;
create policy "customer inserts own order items" on order_items
  for insert with check (
    exists (
      select 1 from store_orders so
      where so.id = order_items.store_order_id and so.customer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- supplier_payouts — mirrors driver_payouts
-- ---------------------------------------------------------------------
create table if not exists supplier_payouts (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references profiles (id) on delete cascade,
  store_order_id uuid references store_orders (id) on delete set null,
  gross numeric not null,
  platform_fee numeric not null,
  net numeric not null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

alter table supplier_payouts enable row level security;

drop policy if exists "supplier reads own payouts" on supplier_payouts;
create policy "supplier reads own payouts" on supplier_payouts
  for select using (supplier_id = auth.uid() or is_admin());

drop policy if exists "admin manages payouts" on supplier_payouts;
create policy "admin manages payouts" on supplier_payouts
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- realtime — suppliers/admin watch store_orders live, same as jobs
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table store_orders;
alter publication supabase_realtime add table products;
