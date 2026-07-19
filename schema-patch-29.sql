-- ---------------------------------------------------------------------
-- In-app chat: rooms, messages, typing, reactions, per-user settings
-- ---------------------------------------------------------------------
create table if not exists chat_rooms (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references jobs (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  driver_id uuid references profiles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id)
);

alter table chat_rooms enable row level security;

drop policy if exists "chat_rooms participants select" on chat_rooms;
create policy "chat_rooms participants select" on chat_rooms
  for select using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "chat_rooms participants insert" on chat_rooms;
create policy "chat_rooms participants insert" on chat_rooms
  for insert with check (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "chat_rooms participants update" on chat_rooms;
create policy "chat_rooms participants update" on chat_rooms
  for update using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references chat_rooms (id) on delete cascade,
  sender_id uuid references profiles (id) on delete set null,
  sender_type text not null check (sender_type in ('customer', 'driver', 'admin', 'system')),
  message text,
  message_type text not null default 'text' check (message_type in ('text', 'image', 'voice', 'location', 'system')),
  image_url text,
  voice_url text,
  voice_duration_seconds numeric,
  location_lat double precision,
  location_lng double precision,
  reply_to uuid references chat_messages (id) on delete set null,
  edited boolean not null default false,
  deleted boolean not null default false,
  deleted_for_everyone boolean not null default false,
  pinned boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table chat_messages enable row level security;

drop policy if exists "chat_messages participants select" on chat_messages;
create policy "chat_messages participants select" on chat_messages
  for select using (
    is_admin() or exists (select 1 from chat_rooms r where r.id = room_id and (r.customer_id = auth.uid() or r.driver_id = auth.uid()))
  );

drop policy if exists "chat_messages participants insert" on chat_messages;
create policy "chat_messages participants insert" on chat_messages
  for insert with check (
    is_admin() or exists (select 1 from chat_rooms r where r.id = room_id and (r.customer_id = auth.uid() or r.driver_id = auth.uid()))
  );

drop policy if exists "chat_messages sender or admin update" on chat_messages;
create policy "chat_messages sender or admin update" on chat_messages
  for update using (sender_id = auth.uid() or is_admin());

create table if not exists typing_status (
  room_id uuid not null references chat_rooms (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  typing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table typing_status enable row level security;

drop policy if exists "typing_status participants select" on typing_status;
create policy "typing_status participants select" on typing_status
  for select using (
    is_admin() or exists (select 1 from chat_rooms r where r.id = room_id and (r.customer_id = auth.uid() or r.driver_id = auth.uid()))
  );

drop policy if exists "typing_status own upsert" on typing_status;
create policy "typing_status own upsert" on typing_status
  for insert with check (user_id = auth.uid());

drop policy if exists "typing_status own update" on typing_status;
create policy "typing_status own update" on typing_status
  for update using (user_id = auth.uid());

create table if not exists message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references chat_messages (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table message_reactions enable row level security;

drop policy if exists "message_reactions participants select" on message_reactions;
create policy "message_reactions participants select" on message_reactions
  for select using (
    is_admin() or exists (
      select 1 from chat_messages m join chat_rooms r on r.id = m.room_id
      where m.id = message_id and (r.customer_id = auth.uid() or r.driver_id = auth.uid())
    )
  );

drop policy if exists "message_reactions own insert" on message_reactions;
create policy "message_reactions own insert" on message_reactions
  for insert with check (user_id = auth.uid());

drop policy if exists "message_reactions own delete" on message_reactions;
create policy "message_reactions own delete" on message_reactions
  for delete using (user_id = auth.uid());

-- Per-user, per-room settings: mute / archive / pin room / wallpaper
create table if not exists chat_participant_settings (
  room_id uuid not null references chat_rooms (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  muted boolean not null default false,
  archived boolean not null default false,
  pinned_room boolean not null default false,
  wallpaper text,
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table chat_participant_settings enable row level security;

drop policy if exists "chat_participant_settings own all" on chat_participant_settings;
create policy "chat_participant_settings own all" on chat_participant_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Global block list (either party can block the other from messaging)
create table if not exists user_blocks (
  blocker_id uuid not null references profiles (id) on delete cascade,
  blocked_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table user_blocks enable row level security;

drop policy if exists "user_blocks own all" on user_blocks;
create policy "user_blocks own all" on user_blocks
  for all using (blocker_id = auth.uid() or is_admin()) with check (blocker_id = auth.uid());

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_rooms') then
    alter publication supabase_realtime add table chat_rooms;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages') then
    alter publication supabase_realtime add table chat_messages;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'typing_status') then
    alter publication supabase_realtime add table typing_status;
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table message_reactions;
  end if;
end $$;

-- Storage: chat images + voice notes, private to room participants + admin
insert into storage.buckets (id, name, public) values ('chat-images', 'chat-images', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('chat-voice', 'chat-voice', false) on conflict (id) do nothing;

drop policy if exists "chat-images participants read" on storage.objects;
create policy "chat-images participants read" on storage.objects
  for select using (
    bucket_id = 'chat-images' and (
      is_admin() or exists (
        select 1 from chat_rooms r where r.id::text = (storage.foldername(name))[1]
        and (r.customer_id = auth.uid() or r.driver_id = auth.uid())
      )
    )
  );

drop policy if exists "chat-images participants write" on storage.objects;
create policy "chat-images participants write" on storage.objects
  for insert with check (
    bucket_id = 'chat-images' and (
      is_admin() or exists (
        select 1 from chat_rooms r where r.id::text = (storage.foldername(name))[1]
        and (r.customer_id = auth.uid() or r.driver_id = auth.uid())
      )
    )
  );

drop policy if exists "chat-voice participants read" on storage.objects;
create policy "chat-voice participants read" on storage.objects
  for select using (
    bucket_id = 'chat-voice' and (
      is_admin() or exists (
        select 1 from chat_rooms r where r.id::text = (storage.foldername(name))[1]
        and (r.customer_id = auth.uid() or r.driver_id = auth.uid())
      )
    )
  );

drop policy if exists "chat-voice participants write" on storage.objects;
create policy "chat-voice participants write" on storage.objects
  for insert with check (
    bucket_id = 'chat-voice' and (
      is_admin() or exists (
        select 1 from chat_rooms r where r.id::text = (storage.foldername(name))[1]
        and (r.customer_id = auth.uid() or r.driver_id = auth.uid())
      )
    )
  );

-- Automatic system messages when a delivery's status changes.
-- Ensures a chat_rooms row exists for the job, then logs a system message.
create or replace function chat_log_job_status() returns trigger as $$
declare
  v_room_id uuid;
  v_label text;
begin
  if new.driver_id is null then
    return new;
  end if;

  insert into chat_rooms (delivery_id, customer_id, driver_id)
  values (new.id, new.customer_id, new.driver_id)
  on conflict (delivery_id) do update set driver_id = excluded.driver_id, updated_at = now()
  returning id into v_room_id;

  if v_room_id is null then
    select id into v_room_id from chat_rooms where delivery_id = new.id;
  end if;

  if TG_OP = 'UPDATE' and old.status = new.status and old.driver_id = new.driver_id then
    return new;
  end if;

  v_label := case new.status
    when 'offered' then 'Driver accepted the delivery.'
    when 'to_pickup' then 'Driver is heading to pickup.'
    when 'to_dropoff' then 'Package collected — driver is heading to destination.'
    when 'delivered' then 'Delivery completed.'
    when 'cancelled' then 'Delivery cancelled.'
    else null
  end;

  if v_label is not null then
    insert into chat_messages (room_id, sender_type, message, message_type)
    values (v_room_id, 'system', v_label, 'system');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_chat_log_job_status on jobs;
create trigger trg_chat_log_job_status
  after insert or update of status, driver_id on jobs
  for each row execute function chat_log_job_status();

-- Also log arrival events (arrived_at_pickup_at / arrived_at_dropoff_at) which
-- aren't status transitions but still need a system message.
create or replace function chat_log_arrival() returns trigger as $$
declare
  v_room_id uuid;
begin
  select id into v_room_id from chat_rooms where delivery_id = new.id;
  if v_room_id is null then
    return new;
  end if;

  if new.arrived_at_pickup_at is not null and old.arrived_at_pickup_at is null then
    insert into chat_messages (room_id, sender_type, message, message_type)
    values (v_room_id, 'system', 'Driver has arrived at pickup.', 'system');
  end if;

  if new.arrived_at_dropoff_at is not null and old.arrived_at_dropoff_at is null then
    insert into chat_messages (room_id, sender_type, message, message_type)
    values (v_room_id, 'system', 'Driver has arrived at destination.', 'system');
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_chat_log_arrival on jobs;
create trigger trg_chat_log_arrival
  after update of arrived_at_pickup_at, arrived_at_dropoff_at on jobs
  for each row execute function chat_log_arrival();
