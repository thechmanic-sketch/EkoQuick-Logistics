-- Run in Supabase SQL editor: vehicle detail fields + document
-- verification metadata (expiry, who verified it, when), plus a
-- residential address and join date is already covered by created_at.
alter table profiles add column if not exists vehicle_make text;
alter table profiles add column if not exists vehicle_model text;
alter table profiles add column if not exists vehicle_year text;
alter table profiles add column if not exists vehicle_color text;
alter table profiles add column if not exists registration_number text;
alter table profiles add column if not exists address text;

alter table profiles add column if not exists license_expiry date;
alter table profiles add column if not exists insurance_expiry date;
alter table profiles add column if not exists documents_verified_by text;
alter table profiles add column if not exists documents_verified_at timestamptz;
