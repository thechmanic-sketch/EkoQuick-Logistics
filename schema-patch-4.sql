-- Run in Supabase SQL editor: new job status lifecycle (offered/to_pickup/
-- to_dropoff replace the old assigned/in_progress), plus dropoff coordinates
-- for turn-by-turn directions on the driver side.
alter table jobs add column if not exists dropoff_lat double precision;
alter table jobs add column if not exists dropoff_lng double precision;

alter table jobs drop constraint if exists jobs_status_check;
alter table jobs add constraint jobs_status_check
  check (status in ('pending', 'offered', 'to_pickup', 'to_dropoff', 'delivered', 'cancelled'));
