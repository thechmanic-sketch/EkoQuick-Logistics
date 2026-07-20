-- Live ETA (written periodically by driver-navigation.js from real Google
-- Routes API duration, not a straight-line/haversine guess) and the two
-- notification gaps this closes:
--   1. Customer wasn't notified when the driver actually arrived (only on
--      status changes — arrival is a timestamp-only update, no status change).
--   2. No "arriving soon" warning existed at all.
alter table jobs add column if not exists eta_seconds numeric;

create or replace function notify_on_arrival() returns trigger as $$
begin
  if TG_OP = 'UPDATE' and old.arrived_at_pickup_at is null and new.arrived_at_pickup_at is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (new.customer_id, 'customer', 'Your driver has arrived at pickup', new.pickup, 'delivery_update', new.id, 'high', 'open_delivery');
  end if;
  if TG_OP = 'UPDATE' and old.arrived_at_dropoff_at is null and new.arrived_at_dropoff_at is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (new.customer_id, 'customer', 'Your driver has arrived', new.dropoff, 'delivery_update', new.id, 'high', 'open_delivery');
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_arrival on jobs;
create trigger trg_notify_on_arrival
  after update of arrived_at_pickup_at, arrived_at_dropoff_at on jobs
  for each row execute function notify_on_arrival();

-- Fires once when the live ETA first drops to 3 minutes or under for the
-- active leg (pickup or dropoff) — not on every tick, via the old/new
-- threshold-crossing check below.
create or replace function notify_on_eta_soon() returns trigger as $$
begin
  if new.eta_seconds is not null and new.eta_seconds <= 180
     and (old.eta_seconds is null or old.eta_seconds > 180)
     and new.status in ('to_pickup', 'to_dropoff') then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (
      new.customer_id, 'customer',
      case when new.status = 'to_pickup' then 'Your driver arrives in about 3 minutes' else 'Your delivery arrives in about 3 minutes' end,
      case when new.status = 'to_pickup' then new.pickup else new.dropoff end,
      'delivery_update', new.id, 'high', 'open_delivery'
    );
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_eta_soon on jobs;
create trigger trg_notify_on_eta_soon
  after update of eta_seconds on jobs
  for each row execute function notify_on_eta_soon();
