-- Run in Supabase SQL editor: adds receiver details + pickup/delivery codes.
alter table jobs add column if not exists receiver_name text;
alter table jobs add column if not exists receiver_phone text;
alter table jobs add column if not exists collection_code text;
alter table jobs add column if not exists delivery_code text;
