-- Run in Supabase SQL editor: vehicle class + live location for drivers,
-- and pickup coordinates on jobs, so auto-assign can pick the closest
-- available driver of the matching vehicle class.
alter table profiles add column if not exists vehicle_class text;
alter table profiles add column if not exists last_lat double precision;
alter table profiles add column if not exists last_lng double precision;

alter table jobs add column if not exists pickup_lat double precision;
alter table jobs add column if not exists pickup_lng double precision;

-- Drivers need to write their own last_lat/last_lng even when they don't
-- own the row via the jobs table (this is their own profile row, which
-- "profiles update own or admin" already covers — no change needed there).

-- Re-create handle_new_user so driver signups also store their vehicle_class.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into profiles (id, role, full_name, username, email, phone, vehicle_class)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'username',
    new.email,
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'vehicle_class'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
