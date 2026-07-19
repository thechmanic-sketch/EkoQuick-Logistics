-- Run in Supabase SQL editor: Settings module.

-- ---------------------------------------------------------------------
-- General settings (non-sensitive) — reuses the existing public `settings`
-- key/value table. Safe because this table is readable by anyone (needed
-- so customer/driver pages can read driver_share); never put secrets here.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Staff roles (only meaningful for role='admin' profiles) + permission
-- matrix. staff_role defaults to super_admin so existing admin accounts
-- keep full access after this migration.
-- ---------------------------------------------------------------------
alter table profiles add column if not exists staff_role text not null default 'super_admin'
  check (staff_role in ('super_admin', 'admin', 'dispatcher', 'finance', 'support', 'read_only'));

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
-- Integrations — admin-only, unlike the public `settings` table above,
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
-- server, so there is no real request IP to capture (a client-reported
-- "my IP is X" value could be fabricated by that same client, so it's
-- deliberately not included).
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
