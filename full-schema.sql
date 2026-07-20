-- Ekoquick — full database setup.
-- Run this once in the Supabase SQL editor on a fresh project.
-- (If you already ran the old schema.sql on an existing project, you don't
-- need this — schema.sql only carries the incremental changes on top of it.)

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('customer', 'driver', 'admin')),
  full_name text not null,
  username text unique,
  email text,
  phone text,
  vehicle_class text,
  vehicle_make text,
  vehicle_model text,
  vehicle_year text,
  vehicle_color text,
  registration_number text,
  address text,
  last_lat double precision,
  last_lng double precision,
  last_seen_at timestamptz,
  account_status text not null default 'active'
    check (account_status in ('active', 'paused', 'banned')),
  avatar_url text,
  license_url text,
  id_doc_url text,
  vehicle_reg_url text,
  insurance_url text,
  license_expiry date,
  insurance_expiry date,
  documents_verified_by text,
  documents_verified_at timestamptz,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'approved', 'rejected')),
  customer_type text not null default 'individual'
    check (customer_type in ('individual', 'business')),
  staff_role text not null default 'super_admin'
    check (staff_role in ('super_admin', 'admin', 'dispatcher', 'finance', 'support', 'read_only')),
  emergency_contact_name text,
  emergency_contact_phone text,
  alternate_contact_name text,
  alternate_contact_phone text,
  default_vehicle_class text,
  preferred_delivery_time text,
  default_payment_method text check (default_payment_method in ('cash', 'card', 'eft')),
  language text not null default 'en',
  timezone text not null default 'Africa/Johannesburg',
  date_format text not null default 'DD/MM/YYYY',
  theme_preference text not null default 'dark' check (theme_preference in ('dark', 'light', 'system')),
  notif_driver_assigned boolean not null default true,
  notif_driver_near_pickup boolean not null default true,
  notif_parcel_picked_up boolean not null default true,
  notif_driver_near_destination boolean not null default true,
  notif_delivery_completed boolean not null default true,
  notif_promotions boolean not null default true,
  notif_support_replies boolean not null default true,
  is_online boolean not null default false,
  bank_name text,
  bank_account_holder text,
  bank_account_number text,
  bank_branch_code text,
  police_clearance_url text,
  police_clearance_expiry date,
  documents_rejected_reason text,
  vehicle_photo_url text,
  vehicle_vin text,
  license_disc_url text,
  license_disc_expiry date,
  roadworthy_url text,
  roadworthy_expiry date,
  dnotif_new_job boolean not null default true,
  dnotif_job_cancelled boolean not null default true,
  dnotif_payment_received boolean not null default true,
  dnotif_weekly_summary boolean not null default true,
  dnotif_support_reply boolean not null default true,
  dnotif_promotion boolean not null default true,
  dnotif_maintenance_reminder boolean not null default true,
  dnotif_document_expiring boolean not null default true,
  dnotif_account_status boolean not null default true,
  referral_code text unique,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

drop policy if exists "profiles select own or admin" on profiles;
create policy "profiles select own or admin" on profiles
  for select using (id = auth.uid() or is_admin());

drop policy if exists "profiles select driver names" on profiles;
create policy "profiles select driver names" on profiles
  for select using (role = 'driver');

drop policy if exists "profiles insert own" on profiles;
create policy "profiles insert own" on profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles update own or admin" on profiles;
create policy "profiles update own or admin" on profiles
  for update using (id = auth.uid() or is_admin());

-- Looks up a user's email by username so the client can log in with
-- "username" while Supabase Auth itself only accepts email + password.
create or replace function get_email_by_username(uname text)
returns text
language sql
security definer
stable
as $$
  select email from profiles where username = uname limit 1;
$$;

grant execute on function get_email_by_username(text) to anon, authenticated;

-- Auto-create a profiles row whenever a new auth user signs up, reading
-- the role/full_name/username/phone that the client passed as signUp()
-- metadata. Runs as security definer so it isn't blocked by RLS even
-- when the client has no active session yet (e.g. email confirmation
-- pending) — this is what actually lets signup work.
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- jobs
-- ---------------------------------------------------------------------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  driver_id uuid references profiles (id) on delete set null,
  pickup text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  dropoff text not null,
  dropoff_lat double precision,
  dropoff_lng double precision,
  vehicle text not null,
  distance numeric,
  duration numeric,
  quote numeric not null,
  customer_phone text,
  sender_name text,
  sender_email text,
  pickup_contact_name text,
  pickup_contact_phone text,
  pickup_notes text,
  receiver_name text,
  receiver_phone text,
  receiver_email text,
  dropoff_notes text,
  package_type text
    check (package_type in ('documents', 'parcel', 'electronics', 'food', 'clothing', 'furniture', 'other')),
  package_description text,
  package_quantity int,
  package_weight_kg numeric,
  package_dimensions text,
  fragile boolean not null default false,
  keep_upright boolean not null default false,
  handle_with_care boolean not null default false,
  delivery_type text not null default 'standard'
    check (delivery_type in ('standard', 'express')),
  scheduled_at timestamptz,
  collection_code text,
  collection_code_resend_count int not null default 0,
  collection_code_last_sent_at timestamptz,
  delivery_code text,
  delivery_code_resend_count int not null default 0,
  delivery_code_last_sent_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'offered', 'to_pickup', 'to_dropoff', 'delivered', 'cancelled')),
  driver_lat double precision,
  driver_lng double precision,
  rating int2 check (rating between 1 and 5),
  rating_comment text,
  review_hidden boolean not null default false,
  review_reply text,
  review_reply_at timestamptz,
  rating_professionalism int2 check (rating_professionalism between 1 and 5),
  rating_communication int2 check (rating_communication between 1 and 5),
  rating_speed int2 check (rating_speed between 1 and 5),
  rating_parcel_condition int2 check (rating_parcel_condition between 1 and 5),
  review_image_url text,
  review_edited_at timestamptz,
  assigned_at timestamptz,
  to_pickup_at timestamptz,
  to_dropoff_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  refunded boolean not null default false,
  refund_amount numeric,
  refund_reason text,
  refunded_at timestamptz,
  refunded_by text,
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'card', 'eft')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid', 'failed', 'refunded')),
  gateway_provider text,
  gateway_reference text,
  eft_proof_url text,
  payment_verified_by text,
  payment_verified_at timestamptz,
  payout_id uuid,
  arrived_at_pickup_at timestamptz,
  arrived_at_dropoff_at timestamptz,
  delivery_photo_url text,
  delivery_signature_url text,
  delivery_photo_lat double precision,
  delivery_photo_lng double precision,
  created_at timestamptz not null default now()
);

alter table jobs enable row level security;

drop policy if exists "jobs select own or driver or admin" on jobs;
create policy "jobs select own or driver or admin" on jobs
  for select using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "jobs insert own" on jobs;
create policy "jobs insert own" on jobs
  for insert with check (customer_id = auth.uid());

drop policy if exists "jobs update own or driver or admin" on jobs;
create policy "jobs update own or driver or admin" on jobs
  for update using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

-- Enable realtime updates on jobs (used for live tracking + dashboard refresh)
alter publication supabase_realtime add table jobs;

-- ---------------------------------------------------------------------
-- saved_addresses — customer address book for faster booking
-- ---------------------------------------------------------------------
create table if not exists saved_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  label text not null,
  address_type text not null default 'other'
    check (address_type in ('home', 'work', 'business', 'warehouse', 'family', 'other')),
  street text not null,
  suburb text,
  city text,
  province text,
  postal_code text,
  lat double precision,
  lng double precision,
  contact_person text,
  contact_phone text,
  contact_email text,
  notes text,
  is_default_pickup boolean not null default false,
  is_default_dropoff boolean not null default false,
  created_at timestamptz not null default now()
);

alter table saved_addresses enable row level security;

drop policy if exists "saved_addresses owner all" on saved_addresses;
create policy "saved_addresses owner all" on saved_addresses
  for all using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- ---------------------------------------------------------------------
-- complaints — a separate investigation workflow from a simple star rating
-- ---------------------------------------------------------------------
create table if not exists complaints (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references profiles (id) on delete set null,
  driver_id uuid references profiles (id) on delete set null,
  job_id uuid references jobs (id) on delete set null,
  category text not null check (category in (
    'late_delivery', 'rude_behaviour', 'dangerous_driving', 'damaged_package',
    'missing_package', 'wrong_delivery', 'fraud', 'poor_communication',
    'vehicle_hygiene', 'other'
  )),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'dismissed')),
  assigned_staff text,
  description text not null,
  created_at timestamptz not null default now(),
  assigned_at timestamptz,
  investigation_started_at timestamptz,
  driver_contacted_at timestamptz,
  customer_contacted_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz
);

alter table complaints enable row level security;

drop policy if exists "complaints admin all" on complaints;
create policy "complaints admin all" on complaints
  for all using (is_admin());

create table if not exists complaint_notes (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints (id) on delete cascade,
  author text,
  note text not null,
  created_at timestamptz not null default now()
);

alter table complaint_notes enable row level security;

drop policy if exists "complaint_notes admin all" on complaint_notes;
create policy "complaint_notes admin all" on complaint_notes
  for all using (is_admin());

alter publication supabase_realtime add table complaints;
alter publication supabase_realtime add table complaint_notes;

-- ---------------------------------------------------------------------
-- Storage: profile photos (public) + driver documents (private)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('driver-docs', 'driver-docs', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('complaint-evidence', 'complaint-evidence', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('review-photos', 'review-photos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('delivery-proofs', 'delivery-proofs', true) on conflict (id) do nothing;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner write" on storage.objects;
create policy "driver-docs owner write" on storage.objects
  for insert with check (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner update" on storage.objects;
create policy "driver-docs owner update" on storage.objects
  for update using (bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "driver-docs owner or admin read" on storage.objects;
create policy "driver-docs owner or admin read" on storage.objects
  for select using (bucket_id = 'driver-docs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

drop policy if exists "complaint-evidence admin all" on storage.objects;
create policy "complaint-evidence admin all" on storage.objects
  for all using (bucket_id = 'complaint-evidence' and is_admin());

drop policy if exists "payment-proofs owner write" on storage.objects;
create policy "payment-proofs owner write" on storage.objects
  for insert with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "payment-proofs owner or admin read" on storage.objects;
create policy "payment-proofs owner or admin read" on storage.objects
  for select using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

drop policy if exists "review-photos public read" on storage.objects;
create policy "review-photos public read" on storage.objects
  for select using (bucket_id = 'review-photos');

drop policy if exists "review-photos owner write" on storage.objects;
create policy "review-photos owner write" on storage.objects
  for insert with check (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "review-photos owner update" on storage.objects;
create policy "review-photos owner update" on storage.objects
  for update using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists complaint_attachments (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references complaints (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text,
  uploaded_by text,
  created_at timestamptz not null default now()
);

alter table complaint_attachments enable row level security;

drop policy if exists "complaint_attachments admin all" on complaint_attachments;
create policy "complaint_attachments admin all" on complaint_attachments
  for all using (is_admin());

alter publication supabase_realtime add table complaint_attachments;

-- ---------------------------------------------------------------------
-- support_tickets / support_ticket_messages — customer help center
-- ---------------------------------------------------------------------
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references profiles (id) on delete cascade,
  driver_id uuid references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  category text not null check (category in (
    'delivery_issue', 'driver_complaint', 'payment_issue', 'technical_problem', 'missing_parcel', 'damaged_parcel', 'other',
    'customer_issue', 'vehicle_breakdown', 'navigation_problem', 'account_issue', 'accident_report', 'safety_concern'
  )),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'waiting_customer', 'waiting_driver', 'resolved', 'closed')),
  incident_type text,
  incident_at timestamptz,
  incident_lat double precision,
  incident_lng double precision,
  witness_info text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint support_tickets_reporter_check check (customer_id is not null or driver_id is not null)
);

alter table support_tickets enable row level security;

drop policy if exists "support_tickets select own" on support_tickets;
create policy "support_tickets select own" on support_tickets
  for select using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "support_tickets insert own" on support_tickets;
create policy "support_tickets insert own" on support_tickets
  for insert with check (customer_id = auth.uid() or driver_id = auth.uid());

drop policy if exists "support_tickets owner or admin update" on support_tickets;
create policy "support_tickets owner or admin update" on support_tickets
  for update using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets (id) on delete cascade,
  sender_type text not null check (sender_type in ('customer', 'driver', 'staff')),
  sender_name text not null,
  message text not null,
  attachment_url text,
  created_at timestamptz not null default now()
);

alter table support_ticket_messages enable row level security;

drop policy if exists "support_ticket_messages select own ticket or admin" on support_ticket_messages;
create policy "support_ticket_messages select own ticket or admin" on support_ticket_messages
  for select using (
    is_admin() or exists (select 1 from support_tickets t where t.id = ticket_id and (t.customer_id = auth.uid() or t.driver_id = auth.uid()))
  );

drop policy if exists "support_ticket_messages insert own ticket or admin" on support_ticket_messages;
create policy "support_ticket_messages insert own ticket or admin" on support_ticket_messages
  for insert with check (
    is_admin() or exists (select 1 from support_tickets t where t.id = ticket_id and (t.customer_id = auth.uid() or t.driver_id = auth.uid()))
  );

alter publication supabase_realtime add table support_tickets;
alter publication supabase_realtime add table support_ticket_messages;

insert into storage.buckets (id, name, public) values ('support-attachments', 'support-attachments', false) on conflict (id) do nothing;

drop policy if exists "support-attachments owner write" on storage.objects;
create policy "support-attachments owner write" on storage.objects
  for insert with check (bucket_id = 'support-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "support-attachments owner or admin read" on storage.objects;
create policy "support-attachments owner or admin read" on storage.objects
  for select using (bucket_id = 'support-attachments' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()));

-- ---------------------------------------------------------------------
-- dispatch_log — records every driver assignment/reassignment for audit
-- ---------------------------------------------------------------------
create table if not exists dispatch_log (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  action text not null check (action in ('assign', 'reassign')),
  previous_driver_id uuid references profiles (id) on delete set null,
  new_driver_id uuid references profiles (id) on delete set null,
  admin_name text,
  created_at timestamptz not null default now()
);

alter table dispatch_log enable row level security;

drop policy if exists "dispatch_log admin all" on dispatch_log;
create policy "dispatch_log admin all" on dispatch_log
  for all using (is_admin());

alter publication supabase_realtime add table dispatch_log;

-- ---------------------------------------------------------------------
-- customer_notes — internal admin-only notes on a customer account
-- ---------------------------------------------------------------------
create table if not exists customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles (id) on delete cascade,
  author text,
  note text not null,
  created_at timestamptz not null default now()
);

alter table customer_notes enable row level security;

drop policy if exists "customer_notes admin all" on customer_notes;
create policy "customer_notes admin all" on customer_notes
  for all using (is_admin());

alter publication supabase_realtime add table customer_notes;

-- ---------------------------------------------------------------------
-- driver_payouts — weekly (or any period) allocation of driver earnings,
-- so a delivery is never paid out twice.
-- ---------------------------------------------------------------------
create table if not exists driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  total_amount numeric not null,
  job_count int not null default 0,
  status text not null default 'paid' check (status in ('pending', 'paid')),
  paid_by text,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table driver_payouts enable row level security;

drop policy if exists "driver_payouts admin all" on driver_payouts;
create policy "driver_payouts admin all" on driver_payouts
  for all using (is_admin());

drop policy if exists "driver_payouts driver read own" on driver_payouts;
create policy "driver_payouts driver read own" on driver_payouts
  for select using (driver_id = auth.uid());

alter table jobs add constraint jobs_payout_id_fkey foreign key (payout_id) references driver_payouts (id) on delete set null;

alter publication supabase_realtime add table driver_payouts;

create table if not exists withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  amount numeric not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  notes text
);

alter table withdrawal_requests enable row level security;

drop policy if exists "withdrawal_requests driver select own" on withdrawal_requests;
create policy "withdrawal_requests driver select own" on withdrawal_requests
  for select using (driver_id = auth.uid() or is_admin());

drop policy if exists "withdrawal_requests driver insert own" on withdrawal_requests;
create policy "withdrawal_requests driver insert own" on withdrawal_requests
  for insert with check (driver_id = auth.uid());

drop policy if exists "withdrawal_requests admin update" on withdrawal_requests;
create policy "withdrawal_requests admin update" on withdrawal_requests
  for update using (is_admin());

alter publication supabase_realtime add table withdrawal_requests;

-- ---------------------------------------------------------------------
-- Platform settings (e.g. commission rate) — editable without a code deploy
-- ---------------------------------------------------------------------
create table if not exists settings (
  key text primary key,
  value text not null
);
insert into settings (key, value) values ('driver_share', '0.85') on conflict (key) do nothing;
insert into settings (key, value) values ('min_withdrawal_amount', '100') on conflict (key) do nothing;
insert into settings (key, value) values ('chat_read_only_hours', '48') on conflict (key) do nothing;
insert into settings (key, value) values ('chat_flagged_keywords', '') on conflict (key) do nothing;
insert into settings (key, value) values
  ('company_name', 'Ekoquick'),
  ('company_logo_url', ''),
  ('company_reg_number', ''),
  ('company_vat_number', ''),
  ('company_email', ''),
  ('company_phone', ''),
  ('company_address', ''),
  ('company_website', ''),
  ('min_delivery_fee', '0'),
  ('max_delivery_radius_km', '0'),
  ('waiting_fee', '0'),
  ('cancellation_fee', '0'),
  ('driver_registration_enabled', 'true'),
  ('driver_manual_approval', 'true'),
  ('driver_max_active_jobs', '1'),
  ('driver_min_rating', '0'),
  ('driver_max_radius_km', '0'),
  ('customer_registration_enabled', 'true'),
  ('customer_phone_verification', 'false'),
  ('customer_email_verification', 'false'),
  ('customer_max_active_orders', '0'),
  ('notify_sms_enabled', 'false'),
  ('notify_email_enabled', 'false'),
  ('notify_push_enabled', 'false'),
  ('notify_whatsapp_enabled', 'true'),
  ('notify_event_job_assigned', 'true'),
  ('notify_event_pickup', 'true'),
  ('notify_event_delivered', 'true'),
  ('notify_event_cancelled', 'true'),
  ('timezone', 'Africa/Johannesburg'),
  ('currency', 'ZAR'),
  ('date_format', 'DD/MM/YYYY'),
  ('distance_unit', 'km')
on conflict (key) do nothing;

alter table settings enable row level security;

drop policy if exists "settings public read" on settings;
create policy "settings public read" on settings for select using (true);

drop policy if exists "settings admin write" on settings;
create policy "settings admin write" on settings for update using (is_admin());

-- ---------------------------------------------------------------------
-- Role-based permissions (Security tab) — staff_role lives on profiles above.
-- ---------------------------------------------------------------------
create table if not exists role_permissions (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('super_admin', 'admin', 'dispatcher', 'finance', 'support', 'read_only')),
  module text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  can_export boolean not null default false,
  unique (role, module)
);

alter table role_permissions enable row level security;

drop policy if exists "role_permissions admin all" on role_permissions;
create policy "role_permissions admin all" on role_permissions
  for all using (is_admin());

-- ---------------------------------------------------------------------
-- Integrations — admin-only (unlike the public settings table above)
-- since these can hold real API keys/credentials.
-- ---------------------------------------------------------------------
create table if not exists integration_settings (
  key text primary key,
  value text
);

alter table integration_settings enable row level security;

drop policy if exists "integration_settings admin all" on integration_settings;
create policy "integration_settings admin all" on integration_settings
  for all using (is_admin());

insert into integration_settings (key, value) values
  ('google_maps_api_key', null),
  ('sms_provider', null),
  ('sms_api_key', null),
  ('smtp_host', null),
  ('smtp_port', null),
  ('smtp_username', null),
  ('smtp_password', null),
  ('payment_gateway_provider', null),
  ('payment_gateway_api_key', null)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Audit log — no IP address column: this is a static site with no backend
-- server, so there is no real request IP to capture.
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_name text,
  action text not null,
  module text not null,
  created_at timestamptz not null default now()
);

alter table audit_log enable row level security;

drop policy if exists "audit_log admin all" on audit_log;
create policy "audit_log admin all" on audit_log
  for all using (is_admin());

alter publication supabase_realtime add table audit_log;
alter publication supabase_realtime add table role_permissions;

-- ---------------------------------------------------------------------
-- commission_rules — vehicle-class/driver/campaign overrides on top of
-- the default driver_share setting above.
-- ---------------------------------------------------------------------
create table if not exists commission_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null check (rule_type in ('vehicle_class', 'driver', 'campaign')),
  vehicle_class text,
  driver_id uuid references profiles (id) on delete cascade,
  start_date date,
  end_date date,
  driver_share numeric not null check (driver_share >= 0 and driver_share <= 1),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);

alter table commission_rules enable row level security;

drop policy if exists "commission_rules admin all" on commission_rules;
create policy "commission_rules admin all" on commission_rules
  for all using (is_admin());

drop policy if exists "commission_rules public read active" on commission_rules;
create policy "commission_rules public read active" on commission_rules
  for select using (active = true);

create table if not exists commission_history (
  id uuid primary key default gen_random_uuid(),
  changed_by text,
  scope text not null,
  previous_value text,
  new_value text,
  reason text,
  created_at timestamptz not null default now()
);

alter table commission_history enable row level security;

drop policy if exists "commission_history admin all" on commission_history;
create policy "commission_history admin all" on commission_history
  for all using (is_admin());

alter publication supabase_realtime add table commission_rules;
alter publication supabase_realtime add table commission_history;

create table if not exists referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references profiles (id) on delete cascade,
  referred_id uuid references profiles (id) on delete set null,
  referred_role text not null check (referred_role in ('driver', 'customer')),
  reward_amount numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'rejected')),
  created_at timestamptz not null default now()
);

alter table referrals enable row level security;

drop policy if exists "referrals referrer select own" on referrals;
create policy "referrals referrer select own" on referrals
  for select using (referrer_id = auth.uid() or is_admin());

drop policy if exists "referrals insert own" on referrals;
create policy "referrals insert own" on referrals
  for insert with check (true);

drop policy if exists "referrals admin update" on referrals;
create policy "referrals admin update" on referrals
  for update using (is_admin());

create table if not exists driver_expenses (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  category text not null check (category in ('fuel', 'repairs', 'parking', 'tolls', 'maintenance', 'other')),
  amount numeric not null,
  expense_date date not null default current_date,
  notes text,
  created_at timestamptz not null default now()
);

alter table driver_expenses enable row level security;

drop policy if exists "driver_expenses owner all" on driver_expenses;
create policy "driver_expenses owner all" on driver_expenses
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

create table if not exists driver_shifts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references profiles (id) on delete cascade,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  break_start_at timestamptz,
  total_break_minutes int not null default 0,
  created_at timestamptz not null default now()
);

alter table driver_shifts enable row level security;

drop policy if exists "driver_shifts owner all" on driver_shifts;
create policy "driver_shifts owner all" on driver_shifts
  for all using (driver_id = auth.uid()) with check (driver_id = auth.uid());

alter publication supabase_realtime add table driver_shifts;

-- ---------------------------------------------------------------------
-- In-app chat: rooms, messages, typing, reactions, per-user settings
-- ---------------------------------------------------------------------
create table if not exists chat_rooms (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references jobs (id) on delete cascade,
  customer_id uuid not null references profiles (id) on delete cascade,
  driver_id uuid references profiles (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'closed')),
  muted_by_admin_user_id uuid references profiles (id) on delete set null,
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

alter publication supabase_realtime add table chat_rooms;
alter publication supabase_realtime add table chat_messages;
alter publication supabase_realtime add table typing_status;
alter publication supabase_realtime add table message_reactions;

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

alter publication supabase_realtime add table notifications;

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

alter publication supabase_realtime add table driver_admin_chats;
alter publication supabase_realtime add table driver_admin_messages;

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

-- ---------------------------------------------------------------------
-- Admin account
-- ---------------------------------------------------------------------
-- Admin signup is not public. Create the admin's auth user first via
-- Supabase Dashboard -> Authentication -> Add user, then run:
--
--   insert into profiles (id, role, full_name, username, email)
--   values ('<the-new-user-uuid>', 'admin', 'Admin Name', 'admin', 'admin@example.com');

-- ---------------------------------------------------------------------
-- Indexes on foreign keys / commonly-filtered columns. Postgres does not
-- auto-index foreign key columns (only primary keys and unique
-- constraints), so every one of these was a sequential-scan target.
-- ---------------------------------------------------------------------
create index if not exists idx_jobs_customer_id on jobs (customer_id);
create index if not exists idx_jobs_driver_id on jobs (driver_id);
create index if not exists idx_jobs_status on jobs (status);
create index if not exists idx_jobs_created_at on jobs (created_at);
create index if not exists idx_jobs_driver_status on jobs (driver_id, status);

create index if not exists idx_chat_rooms_customer_id on chat_rooms (customer_id);
create index if not exists idx_chat_rooms_driver_id on chat_rooms (driver_id);

create index if not exists idx_chat_messages_room_id on chat_messages (room_id);
create index if not exists idx_chat_messages_sender_id on chat_messages (sender_id);
create index if not exists idx_chat_messages_created_at on chat_messages (created_at);
create index if not exists idx_chat_messages_room_read on chat_messages (room_id, read_at);

create index if not exists idx_message_reactions_message_id on message_reactions (message_id);

create index if not exists idx_notifications_user_id on notifications (user_id);
create index if not exists idx_notifications_user_read on notifications (user_id, is_read);
create index if not exists idx_notifications_user_type on notifications (user_type);

create index if not exists idx_driver_payouts_driver_id on driver_payouts (driver_id);
create index if not exists idx_withdrawal_requests_driver_id on withdrawal_requests (driver_id);
create index if not exists idx_driver_expenses_driver_id on driver_expenses (driver_id);
create index if not exists idx_driver_shifts_driver_id on driver_shifts (driver_id);

create index if not exists idx_support_tickets_customer_id on support_tickets (customer_id);
create index if not exists idx_support_tickets_driver_id on support_tickets (driver_id);
create index if not exists idx_support_ticket_messages_ticket_id on support_ticket_messages (ticket_id);

create index if not exists idx_driver_admin_chats_driver_id on driver_admin_chats (driver_id);
create index if not exists idx_driver_admin_messages_chat_id on driver_admin_messages (chat_id);

create index if not exists idx_complaints_customer_id on complaints (customer_id);
create index if not exists idx_complaints_driver_id on complaints (driver_id);
create index if not exists idx_complaints_job_id on complaints (job_id);

create index if not exists idx_saved_addresses_customer_id on saved_addresses (customer_id);
create index if not exists idx_referrals_referrer_id on referrals (referrer_id);
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

-- Public contact form submissions (contact.html). Anonymous visitors can
-- insert; only admins can read. Without this the contact form would have
-- nowhere real to send its data.
create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'resolved')),
  created_at timestamptz not null default now()
);

alter table contact_messages enable row level security;

drop policy if exists "contact_messages anyone can insert" on contact_messages;
create policy "contact_messages anyone can insert" on contact_messages
  for insert with check (true);

drop policy if exists "contact_messages admin read" on contact_messages;
create policy "contact_messages admin read" on contact_messages
  for select using (is_admin());

drop policy if exists "contact_messages admin update" on contact_messages;
create policy "contact_messages admin update" on contact_messages
  for update using (is_admin());

create index if not exists idx_contact_messages_status on contact_messages (status);

-- Enterprise Pricing Engine — single source of truth for every delivery quote.
-- All pricing lives in these tables, editable from Admin > Pricing Engine.
-- Every job stores a frozen snapshot (jobs.pricing_breakdown) of the pricing
-- rules used at booking time, so future pricing changes never alter
-- historical jobs' recorded fares/commissions.

create table if not exists pricing_vehicles (
  id uuid primary key default gen_random_uuid(),
  vehicle_id text unique not null,
  label text not null,
  icon text not null default '',
  base_fare numeric not null,
  price_per_km numeric not null,
  minimum_fare numeric not null default 0,
  max_weight_kg numeric,
  max_volume_m3 numeric,
  waiting_charge_per_min numeric not null default 0,
  extra_stop_charge numeric not null default 0,
  priority_multiplier numeric not null default 1,
  driver_commission_pct numeric not null default 85,
  platform_commission_pct numeric not null default 15,
  fuel_type text not null default 'petrol' check (fuel_type in ('petrol', 'diesel', 'electric')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pricing_distance_bands (
  id uuid primary key default gen_random_uuid(),
  min_km numeric not null,
  max_km numeric,
  rate_multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_weight_bands (
  id uuid primary key default gen_random_uuid(),
  min_kg numeric not null,
  max_kg numeric,
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_parcel_categories (
  id uuid primary key default gen_random_uuid(),
  category text unique not null,
  handling_fee numeric not null default 0,
  insurance_pct numeric not null default 0,
  requires_signature boolean not null default false,
  requires_otp boolean not null default true,
  requires_photo boolean not null default false,
  sort_order int not null default 0
);

create table if not exists pricing_traffic_multipliers (
  id uuid primary key default gen_random_uuid(),
  level text unique not null check (level in ('light', 'moderate', 'heavy', 'severe')),
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_route_difficulty (
  id uuid primary key default gen_random_uuid(),
  route_type text unique not null check (route_type in ('highway', 'urban', 'residential', 'industrial', 'rural', 'gravel', 'mountain')),
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_priority_levels (
  id uuid primary key default gen_random_uuid(),
  level text unique not null check (level in ('normal', 'scheduled', 'express', 'immediate')),
  multiplier numeric not null default 1,
  sort_order int not null default 0
);

create table if not exists pricing_corporate_discounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references profiles (id) on delete cascade,
  label text not null,
  min_monthly_volume int not null default 0,
  min_monthly_spend numeric not null default 0,
  discount_pct numeric not null default 0,
  custom_rate_per_km numeric,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists pricing_promotions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  discount_type text not null check (discount_type in ('percentage', 'fixed', 'free_delivery')),
  discount_value numeric not null default 0,
  max_uses int,
  uses_count int not null default 0,
  expires_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Fix a real pre-existing bug: "Request a Pickup" sets package_type =
-- 'store_pickup', but the CHECK constraint below never allowed that value,
-- so every pickup-mode booking would fail at insert time.
alter table jobs drop constraint if exists jobs_package_type_check;
alter table jobs add constraint jobs_package_type_check
  check (package_type in ('documents', 'parcel', 'electronics', 'food', 'clothing', 'furniture', 'other', 'store_pickup'));

-- Freeze the exact pricing rules used for each job, so future admin edits
-- to the tables above never retroactively change a historical job's fare,
-- driver earning, or commission.
alter table jobs add column if not exists pricing_breakdown jsonb;

-- Seed with the values already live in config.js's VEHICLES array, so
-- switching the engine on doesn't silently change today's prices.
insert into pricing_vehicles (vehicle_id, label, icon, base_fare, price_per_km, minimum_fare, driver_commission_pct, platform_commission_pct, sort_order)
values
  ('bike', 'Bike', '🏍️', 25, 5.00, 25, 85, 15, 1),
  ('smallcar', 'Small Car', '🚗', 35, 7.00, 35, 85, 15, 2),
  ('bakkie', 'Bakkie', '🛻', 80, 12.00, 80, 85, 15, 3),
  ('truck12', '1–2 Ton Truck', '🚚', 150, 18.00, 150, 85, 15, 4),
  ('truck7', '7 Ton Truck', '🚛', 250, 25.00, 250, 85, 15, 5)
on conflict (vehicle_id) do nothing;

insert into pricing_distance_bands (min_km, max_km, rate_multiplier, sort_order)
select * from (values
  (0::numeric, 5::numeric, 1::numeric, 1),
  (5, 20, 1, 2),
  (20, 50, 1, 3),
  (50, 100, 1, 4),
  (100, null, 1, 5)
) as v(min_km, max_km, rate_multiplier, sort_order)
where not exists (select 1 from pricing_distance_bands);

insert into pricing_weight_bands (min_kg, max_kg, multiplier, sort_order)
select * from (values
  (0::numeric, 5::numeric, 1::numeric, 1),
  (5, 20, 1, 2),
  (20, 50, 1.1, 3),
  (50, 100, 1.2, 4),
  (100, 250, 1.35, 5),
  (250, 500, 1.5, 6),
  (500, 1000, 1.75, 7),
  (1000, 2000, 2, 8),
  (2000, 7000, 2.5, 9)
) as v(min_kg, max_kg, multiplier, sort_order)
where not exists (select 1 from pricing_weight_bands);

-- Keyed to the exact package_type values the booking wizard actually
-- produces (new-delivery.html #packageType), not a separate fictional list —
-- otherwise every real booking would fail to match a category and silently
-- get a R0 handling fee.
insert into pricing_parcel_categories (category, handling_fee, insurance_pct, requires_signature, requires_otp, requires_photo, sort_order) values
  ('documents', 0, 0, false, true, false, 1),
  ('parcel', 0, 0, false, true, false, 2),
  ('food', 0, 0, false, true, false, 3),
  ('clothing', 5, 0, false, true, false, 4),
  ('electronics', 15, 2, true, true, true, 5),
  ('furniture', 20, 1, true, true, true, 6),
  ('other', 5, 0, false, true, false, 7),
  ('store_pickup', 5, 1, false, true, false, 8)
on conflict (category) do nothing;

insert into pricing_traffic_multipliers (level, multiplier, sort_order) values
  ('light', 1, 1),
  ('moderate', 1.1, 2),
  ('heavy', 1.25, 3),
  ('severe', 1.5, 4)
on conflict (level) do nothing;

insert into pricing_route_difficulty (route_type, multiplier, sort_order) values
  ('highway', 1, 1),
  ('urban', 1.05, 2),
  ('residential', 1.1, 3),
  ('industrial', 1.1, 4),
  ('rural', 1.15, 5),
  ('gravel', 1.3, 6),
  ('mountain', 1.4, 7)
on conflict (route_type) do nothing;

insert into pricing_priority_levels (level, multiplier, sort_order) values
  ('normal', 1, 1),
  ('scheduled', 1, 2),
  ('express', 1.5, 3),
  ('immediate', 1.75, 4)
on conflict (level) do nothing;

insert into settings (key, value) values
  ('pricing_waiting_free_minutes', '10'),
  ('pricing_waiting_charge_per_min', '2'),
  ('pricing_waiting_max_charge', '100'),
  ('pricing_extra_stop_price', '20'),
  ('pricing_extra_stop_max', '5'),
  ('pricing_fuel_petrol_price', '23.50'),
  ('pricing_fuel_diesel_price', '21.50'),
  ('pricing_fuel_base_petrol_price', '23.50'),
  ('pricing_fuel_base_diesel_price', '21.50'),
  ('pricing_fuel_adjustment_sensitivity', '0.5'),
  ('pricing_vat_enabled', 'false'),
  ('pricing_vat_pct', '15'),
  ('pricing_google_routes_api_key', '')
on conflict (key) do nothing;

alter table pricing_vehicles enable row level security;
alter table pricing_distance_bands enable row level security;
alter table pricing_weight_bands enable row level security;
alter table pricing_parcel_categories enable row level security;
alter table pricing_traffic_multipliers enable row level security;
alter table pricing_route_difficulty enable row level security;
alter table pricing_priority_levels enable row level security;
alter table pricing_corporate_discounts enable row level security;
alter table pricing_promotions enable row level security;

drop policy if exists "pricing_vehicles public read" on pricing_vehicles;
create policy "pricing_vehicles public read" on pricing_vehicles for select using (true);
drop policy if exists "pricing_vehicles admin write" on pricing_vehicles;
create policy "pricing_vehicles admin write" on pricing_vehicles for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_distance_bands public read" on pricing_distance_bands;
create policy "pricing_distance_bands public read" on pricing_distance_bands for select using (true);
drop policy if exists "pricing_distance_bands admin write" on pricing_distance_bands;
create policy "pricing_distance_bands admin write" on pricing_distance_bands for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_weight_bands public read" on pricing_weight_bands;
create policy "pricing_weight_bands public read" on pricing_weight_bands for select using (true);
drop policy if exists "pricing_weight_bands admin write" on pricing_weight_bands;
create policy "pricing_weight_bands admin write" on pricing_weight_bands for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_parcel_categories public read" on pricing_parcel_categories;
create policy "pricing_parcel_categories public read" on pricing_parcel_categories for select using (true);
drop policy if exists "pricing_parcel_categories admin write" on pricing_parcel_categories;
create policy "pricing_parcel_categories admin write" on pricing_parcel_categories for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_traffic_multipliers public read" on pricing_traffic_multipliers;
create policy "pricing_traffic_multipliers public read" on pricing_traffic_multipliers for select using (true);
drop policy if exists "pricing_traffic_multipliers admin write" on pricing_traffic_multipliers;
create policy "pricing_traffic_multipliers admin write" on pricing_traffic_multipliers for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_route_difficulty public read" on pricing_route_difficulty;
create policy "pricing_route_difficulty public read" on pricing_route_difficulty for select using (true);
drop policy if exists "pricing_route_difficulty admin write" on pricing_route_difficulty;
create policy "pricing_route_difficulty admin write" on pricing_route_difficulty for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_priority_levels public read" on pricing_priority_levels;
create policy "pricing_priority_levels public read" on pricing_priority_levels for select using (true);
drop policy if exists "pricing_priority_levels admin write" on pricing_priority_levels;
create policy "pricing_priority_levels admin write" on pricing_priority_levels for all using (is_admin()) with check (is_admin());

drop policy if exists "pricing_corporate_discounts admin all" on pricing_corporate_discounts;
create policy "pricing_corporate_discounts admin all" on pricing_corporate_discounts for all using (is_admin()) with check (is_admin());
drop policy if exists "pricing_corporate_discounts self read" on pricing_corporate_discounts;
create policy "pricing_corporate_discounts self read" on pricing_corporate_discounts for select using (customer_id = auth.uid());

drop policy if exists "pricing_promotions public read active" on pricing_promotions;
create policy "pricing_promotions public read active" on pricing_promotions for select using (active = true);
drop policy if exists "pricing_promotions admin write" on pricing_promotions;
create policy "pricing_promotions admin write" on pricing_promotions for all using (is_admin()) with check (is_admin());

create index if not exists idx_pricing_corporate_discounts_customer on pricing_corporate_discounts (customer_id);
create index if not exists idx_pricing_promotions_code on pricing_promotions (code);

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

