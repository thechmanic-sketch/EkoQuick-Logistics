-- ---------------------------------------------------------------------
-- Global notifications (persisted, unlike the old derived-only lists)
-- ---------------------------------------------------------------------
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles (id) on delete cascade,
  user_type text not null check (user_type in ('customer', 'driver', 'admin')),
  title text not null,
  body text,
  type text not null default 'general',
  delivery_id uuid references jobs (id) on delete set null,
  chat_room_id uuid,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  action_type text,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint notifications_target_check check (user_type = 'admin' or user_id is not null)
);

alter table notifications enable row level security;

drop policy if exists "notifications select own or admin" on notifications;
create policy "notifications select own or admin" on notifications
  for select using ((user_type = 'admin' and is_admin()) or user_id = auth.uid());

drop policy if exists "notifications insert any authenticated" on notifications;
create policy "notifications insert any authenticated" on notifications
  for insert with check (auth.uid() is not null);

drop policy if exists "notifications update own or admin" on notifications;
create policy "notifications update own or admin" on notifications
  for update using ((user_type = 'admin' and is_admin()) or user_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

-- Generic preference fields (channels are inert placeholders — no SMS/email/push
-- provider is connected anywhere in this app yet; only stored for when one is).
alter table profiles add column if not exists push_enabled boolean not null default true;
alter table profiles add column if not exists sms_enabled boolean not null default false;
alter table profiles add column if not exists email_enabled boolean not null default false;
alter table profiles add column if not exists notif_sound boolean not null default true;
alter table profiles add column if not exists notif_vibration boolean not null default true;
alter table profiles add column if not exists quiet_hours_start time;
alter table profiles add column if not exists quiet_hours_end time;

-- ---------------------------------------------------------------------
-- Driver <-> Admin private support line (customer never sees this)
-- ---------------------------------------------------------------------
create table if not exists driver_admin_chats (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  delivery_id uuid references jobs (id) on delete set null,
  assigned_admin_id uuid references profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'waiting', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table driver_admin_chats enable row level security;

drop policy if exists "driver_admin_chats participants select" on driver_admin_chats;
create policy "driver_admin_chats participants select" on driver_admin_chats
  for select using (driver_id = auth.uid() or is_admin());

drop policy if exists "driver_admin_chats driver insert" on driver_admin_chats;
create policy "driver_admin_chats driver insert" on driver_admin_chats
  for insert with check (driver_id = auth.uid() or is_admin());

drop policy if exists "driver_admin_chats participants update" on driver_admin_chats;
create policy "driver_admin_chats participants update" on driver_admin_chats
  for update using (driver_id = auth.uid() or is_admin());

create table if not exists driver_admin_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references driver_admin_chats (id) on delete cascade,
  sender_id uuid references profiles (id) on delete set null,
  sender_type text not null check (sender_type in ('driver', 'admin', 'system')),
  message text not null,
  created_at timestamptz not null default now()
);

alter table driver_admin_messages enable row level security;

drop policy if exists "driver_admin_messages participants select" on driver_admin_messages;
create policy "driver_admin_messages participants select" on driver_admin_messages
  for select using (
    is_admin() or exists (select 1 from driver_admin_chats c where c.id = chat_id and c.driver_id = auth.uid())
  );

drop policy if exists "driver_admin_messages participants insert" on driver_admin_messages;
create policy "driver_admin_messages participants insert" on driver_admin_messages
  for insert with check (
    is_admin() or exists (select 1 from driver_admin_chats c where c.id = chat_id and c.driver_id = auth.uid())
  );

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_admin_chats') then
    alter publication supabase_realtime add table driver_admin_chats;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_admin_messages') then
    alter publication supabase_realtime add table driver_admin_messages;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Escalation: customer/driver chat can pull an admin in explicitly
-- ---------------------------------------------------------------------
alter table chat_rooms add column if not exists escalated boolean not null default false;
alter table chat_rooms add column if not exists assigned_admin_id uuid references profiles (id) on delete set null;

-- ---------------------------------------------------------------------
-- Broadcasts
-- ---------------------------------------------------------------------
create table if not exists broadcasts (
  id uuid primary key default gen_random_uuid(),
  sender_admin_id uuid references profiles (id) on delete set null,
  audience text not null check (audience in ('all_drivers', 'all_customers', 'selected_drivers', 'selected_customers')),
  region text,
  message text not null,
  recipient_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table broadcasts enable row level security;

drop policy if exists "broadcasts admin all" on broadcasts;
create policy "broadcasts admin all" on broadcasts
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------
-- Notification-generating triggers
-- ---------------------------------------------------------------------

-- New chat message -> notify the other participant (not the sender), and admins if escalated.
create or replace function notify_on_chat_message() returns trigger as $$
declare
  v_room chat_rooms%rowtype;
  v_sender_name text;
begin
  if new.sender_type = 'system' then
    return new;
  end if;

  select * into v_room from chat_rooms where id = new.room_id;
  if v_room.id is null then
    return new;
  end if;

  select full_name into v_sender_name from profiles where id = new.sender_id;

  if new.sender_type != 'customer' and v_room.customer_id is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, chat_room_id, action_type)
    values (v_room.customer_id, 'customer', 'New message from Driver', coalesce(new.message, '[attachment]'), 'chat_message', v_room.delivery_id, v_room.id, 'open_chat');
  end if;

  if new.sender_type != 'driver' and v_room.driver_id is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, chat_room_id, action_type)
    values (v_room.driver_id, 'driver', 'New message from ' || case when new.sender_type = 'admin' then 'Admin' else 'Customer' end, coalesce(new.message, '[attachment]'), 'chat_message', v_room.delivery_id, v_room.id, 'open_chat');
  end if;

  if v_room.escalated and new.sender_type != 'admin' then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, chat_room_id, priority, action_type)
    values (null, 'admin', 'Escalated chat message', coalesce(v_sender_name, 'Someone') || ': ' || coalesce(new.message, '[attachment]'), 'chat_message', v_room.delivery_id, v_room.id, 'high', 'open_chat');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_chat_message on chat_messages;
create trigger trg_notify_on_chat_message
  after insert on chat_messages
  for each row execute function notify_on_chat_message();

-- Job status changes -> notify customer (and driver where relevant)
create or replace function notify_on_job_status() returns trigger as $$
declare
  v_title text;
begin
  if TG_OP = 'UPDATE' and old.status = new.status then
    return new;
  end if;

  v_title := case new.status
    when 'offered' then 'Driver accepted your delivery.'
    when 'to_dropoff' then 'Package collected.'
    when 'delivered' then 'Delivery completed.'
    when 'cancelled' then 'Delivery cancelled.'
    else null
  end;

  if v_title is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (new.customer_id, 'customer', v_title, new.pickup || ' → ' || new.dropoff, 'delivery_update', new.id, 'normal', 'open_delivery');
  end if;

  if TG_OP = 'UPDATE' and new.status = 'cancelled' and new.driver_id is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (new.driver_id, 'driver', 'Delivery cancelled', new.pickup || ' → ' || new.dropoff, 'delivery_update', new.id, 'normal', 'open_delivery');
  end if;

  if TG_OP = 'UPDATE' and old.status = 'pending' and new.status = 'offered' and new.driver_id is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (new.driver_id, 'driver', 'New delivery request', new.pickup || ' → ' || new.dropoff, 'new_job', new.id, 'high', 'open_delivery');
  end if;

  if TG_OP = 'UPDATE' and new.status = 'cancelled' then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (null, 'admin', 'Delivery cancelled', new.pickup || ' → ' || new.dropoff, 'delivery_update', new.id, 'normal', 'open_delivery');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_job_status on jobs;
create trigger trg_notify_on_job_status
  after update of status on jobs
  for each row execute function notify_on_job_status();

-- Payment status -> notify customer (paid) and admin (failed)
create or replace function notify_on_payment_status() returns trigger as $$
begin
  if TG_OP = 'UPDATE' and old.payment_status = new.payment_status then
    return new;
  end if;

  if new.payment_status = 'paid' then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, action_type)
    values (new.customer_id, 'customer', 'Payment received', 'R' || new.quote::text || ' for delivery ' || left(new.id::text, 8), 'payment', new.id, 'open_delivery');
    if new.driver_id is not null then
      insert into notifications (user_id, user_type, title, body, type, delivery_id, action_type)
      values (new.driver_id, 'driver', 'Earnings paid', 'Job ' || left(new.id::text, 8) || ' marked paid', 'payment', new.id, 'open_delivery');
    end if;
  end if;

  if new.payment_status = 'failed' then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (null, 'admin', 'Payment failed', 'Delivery ' || left(new.id::text, 8), 'payment', new.id, 'high', 'open_delivery');
  end if;

  if new.refunded and (TG_OP = 'INSERT' or not old.refunded) then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, action_type)
    values (new.customer_id, 'customer', 'Refund processed', 'R' || coalesce(new.refund_amount, 0)::text || ' refunded', 'refund', new.id, 'open_delivery');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_payment_status on jobs;
create trigger trg_notify_on_payment_status
  after update of payment_status, refunded on jobs
  for each row execute function notify_on_payment_status();

-- New rating -> notify driver
create or replace function notify_on_new_rating() returns trigger as $$
begin
  if new.rating is not null and (TG_OP = 'INSERT' or old.rating is null) and new.driver_id is not null then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, action_type)
    values (new.driver_id, 'driver', 'New rating received', repeat('★', new.rating), 'rating', new.id, 'open_delivery');
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_new_rating on jobs;
create trigger trg_notify_on_new_rating
  after update of rating on jobs
  for each row execute function notify_on_new_rating();

-- New driver/customer registration -> notify admin
create or replace function notify_on_new_registration() returns trigger as $$
begin
  if new.role in ('driver', 'customer') then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, action_type)
    values (null, 'admin', 'New registration', new.full_name || ' (' || new.role || ')', 'registration', null, 'open_admin_users');
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_new_registration on profiles;
create trigger trg_notify_on_new_registration
  after insert on profiles
  for each row execute function notify_on_new_registration();

-- New complaint -> notify admin
create or replace function notify_on_new_complaint() returns trigger as $$
begin
  insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
  values (null, 'admin', 'Customer complaint', new.category || ': ' || left(new.description, 100), 'complaint', new.job_id, 'high', 'open_complaint');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_new_complaint on complaints;
create trigger trg_notify_on_new_complaint
  after insert on complaints
  for each row execute function notify_on_new_complaint();

-- Driver went offline while having an active delivery -> notify admin
create or replace function notify_on_driver_offline() returns trigger as $$
begin
  if old.is_online = true and new.is_online = false then
    if exists (select 1 from jobs where driver_id = new.id and status in ('to_pickup', 'to_dropoff')) then
      insert into notifications (user_id, user_type, title, body, type, priority, action_type)
      values (null, 'admin', 'Driver offline unexpectedly', new.full_name || ' has an active delivery', 'driver_offline', 'high', 'open_admin_drivers');
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_driver_offline on profiles;
create trigger trg_notify_on_driver_offline
  after update of is_online on profiles
  for each row execute function notify_on_driver_offline();

-- Driver/Admin support thread activity -> notify the other side + admin escalation
create or replace function notify_on_driver_admin_message() returns trigger as $$
declare
  v_chat driver_admin_chats%rowtype;
  v_driver_name text;
begin
  select * into v_chat from driver_admin_chats where id = new.chat_id;
  select full_name into v_driver_name from profiles where id = v_chat.driver_id;

  if new.sender_type = 'driver' then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, priority, action_type)
    values (null, 'admin', 'Driver requested help', v_driver_name || ': ' || left(new.message, 100), 'driver_help', v_chat.delivery_id, 'high', 'open_driver_admin_chat');
  elsif new.sender_type = 'admin' then
    insert into notifications (user_id, user_type, title, body, type, delivery_id, action_type)
    values (v_chat.driver_id, 'driver', 'Admin sent a message', left(new.message, 100), 'chat_message', v_chat.delivery_id, 'open_driver_admin_chat');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_notify_on_driver_admin_message on driver_admin_messages;
create trigger trg_notify_on_driver_admin_message
  after insert on driver_admin_messages
  for each row execute function notify_on_driver_admin_message();
