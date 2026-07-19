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
-- Admin account
-- ---------------------------------------------------------------------
-- Admin signup is not public. Create the admin's auth user first via
-- Supabase Dashboard -> Authentication -> Add user, then run:
--
--   insert into profiles (id, role, full_name, username, email)
--   values ('<the-new-user-uuid>', 'admin', 'Admin Name', 'admin', 'admin@example.com');
