-- Public "Track Parcel" page support.
-- 4-digit collection_code/delivery_code are for physical handoff confirmation,
-- not safe as a global public lookup key (not unique, easily guessable).
-- This adds a real per-job tracking number plus a SECURITY DEFINER function
-- that returns only non-sensitive fields to anonymous visitors who supply
-- both the tracking number AND a phone number on the job (proves they're
-- the customer, the receiver, or the pickup contact — not just anyone).

alter table jobs add column if not exists tracking_number text;

create or replace function set_tracking_number() returns trigger as $$
declare
  candidate text;
  tries int := 0;
begin
  if new.tracking_number is not null then
    return new;
  end if;
  loop
    candidate := 'EQ' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from jobs where tracking_number = candidate);
    tries := tries + 1;
    exit when tries > 10;
  end loop;
  if tries > 10 then
    candidate := 'EQ' || upper(substr(md5(random()::text || clock_timestamp()::text || new.id::text), 1, 8));
  end if;
  new.tracking_number := candidate;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_tracking_number on jobs;
create trigger trg_set_tracking_number
before insert on jobs
for each row execute function set_tracking_number();

update jobs set tracking_number = 'EQ' || upper(substr(md5(random()::text || id::text), 1, 6))
where tracking_number is null;

drop index if exists idx_jobs_tracking_number;
alter table jobs drop constraint if exists jobs_tracking_number_unique;
alter table jobs add constraint jobs_tracking_number_unique unique (tracking_number);
create index if not exists idx_jobs_tracking_number on jobs (tracking_number);

create or replace function public_track_job(p_tracking_number text, p_phone text)
returns table (
  status text,
  vehicle text,
  pickup text,
  dropoff text,
  distance numeric,
  duration text,
  quote numeric,
  delivery_type text,
  driver_name text,
  driver_vehicle_make text,
  driver_vehicle_model text,
  driver_lat double precision,
  driver_lng double precision,
  collection_code text,
  delivery_code text,
  assigned_at timestamptz,
  to_pickup_at timestamptz,
  to_dropoff_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  scheduled_at timestamptz,
  created_at timestamptz
)
security definer
set search_path = public
as $$
  select j.status, j.vehicle, j.pickup, j.dropoff, j.distance, j.duration, j.quote, j.delivery_type,
         p.full_name, p.vehicle_make, p.vehicle_model,
         j.driver_lat, j.driver_lng, j.collection_code, j.delivery_code,
         j.assigned_at, j.to_pickup_at, j.to_dropoff_at, j.delivered_at, j.cancelled_at, j.scheduled_at, j.created_at
  from jobs j
  left join profiles p on p.id = j.driver_id
  where j.tracking_number = upper(trim(p_tracking_number))
    and p_phone in (j.customer_phone, j.receiver_phone, j.pickup_contact_phone)
  limit 1;
$$ language sql;

grant execute on function public_track_job(text, text) to anon;
