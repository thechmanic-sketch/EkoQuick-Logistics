-- Run in Supabase SQL editor: Book Delivery module — sender/recipient
-- detail, parcel information, special handling, delivery type (with a
-- real express surcharge), and scheduled (future) bookings.

alter table jobs add column if not exists sender_name text;
alter table jobs add column if not exists sender_email text;
alter table jobs add column if not exists pickup_contact_name text;
alter table jobs add column if not exists pickup_contact_phone text;
alter table jobs add column if not exists pickup_notes text;

alter table jobs add column if not exists receiver_email text;
alter table jobs add column if not exists dropoff_notes text;

alter table jobs add column if not exists package_type text
  check (package_type in ('documents', 'parcel', 'electronics', 'food', 'clothing', 'furniture', 'other'));
alter table jobs add column if not exists package_description text;
alter table jobs add column if not exists package_quantity int;
alter table jobs add column if not exists package_weight_kg numeric;
alter table jobs add column if not exists package_dimensions text;
alter table jobs add column if not exists fragile boolean not null default false;
alter table jobs add column if not exists keep_upright boolean not null default false;
alter table jobs add column if not exists handle_with_care boolean not null default false;

alter table jobs add column if not exists delivery_type text not null default 'standard'
  check (delivery_type in ('standard', 'express'));
alter table jobs add column if not exists scheduled_at timestamptz;
