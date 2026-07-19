-- Run in Supabase SQL editor: Finances module — real refund tracking.
-- (No payment-method/payment-gateway columns are added: this platform has
-- no payment processor integration, every job is settled directly between
-- customer and driver, so there is no real "payment method" data to store.)
alter table jobs add column if not exists refunded boolean not null default false;
alter table jobs add column if not exists refund_amount numeric;
alter table jobs add column if not exists refund_reason text;
alter table jobs add column if not exists refunded_at timestamptz;
alter table jobs add column if not exists refunded_by text;
