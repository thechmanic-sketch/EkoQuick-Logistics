-- Run in Supabase SQL editor: payment method infrastructure (Cash today,
-- Card ready for a gateway once one is connected, EFT for business accounts
-- via manual proof-of-payment verification).

-- Lets an admin flag an account as a business, which is what unlocks EFT
-- as a payment option at booking time.
alter table profiles add column if not exists customer_type text not null default 'individual'
  check (customer_type in ('individual', 'business'));

alter table jobs add column if not exists payment_method text not null default 'cash'
  check (payment_method in ('cash', 'card', 'eft'));
alter table jobs add column if not exists payment_status text not null default 'pending'
  check (payment_status in ('pending', 'paid', 'failed', 'refunded'));
alter table jobs add column if not exists gateway_provider text;
alter table jobs add column if not exists gateway_reference text;
alter table jobs add column if not exists eft_proof_url text;
alter table jobs add column if not exists payment_verified_by text;
alter table jobs add column if not exists payment_verified_at timestamptz;

-- Private bucket for EFT proof-of-payment uploads.
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;

drop policy if exists "payment-proofs owner write" on storage.objects;
create policy "payment-proofs owner write" on storage.objects
  for insert with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "payment-proofs owner or admin read" on storage.objects;
create policy "payment-proofs owner or admin read" on storage.objects
  for select using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- ---------------------------------------------------------------------
-- Driver payouts — weekly (or any period) allocation of driver earnings,
-- so a delivery is never paid out twice.
-- ---------------------------------------------------------------------
create table if not exists driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_amount numeric not null,
  job_count int not null default 0,
  status text not null default 'paid' check (status in ('pending', 'paid')),
  paid_by text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table driver_payouts enable row level security;

drop policy if exists "driver_payouts admin all" on driver_payouts;
create policy "driver_payouts admin all" on driver_payouts
  for all using (is_admin());

drop policy if exists "driver_payouts driver read own" on driver_payouts;
create policy "driver_payouts driver read own" on driver_payouts
  for select using (driver_id = auth.uid());

alter table jobs add column if not exists payout_id uuid references driver_payouts (id) on delete set null;

alter publication supabase_realtime add table driver_payouts;
