-- Ekoquick schema updates for username-based login + ratings
-- Run this in the Supabase SQL editor.

alter table profiles add column if not exists username text unique;
alter table profiles add column if not exists email text;

alter table jobs add column if not exists rating int2 check (rating between 1 and 5);
alter table jobs add column if not exists rating_comment text;

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

-- Customers can update their own job (needed so they can submit a
-- rating after delivery; drivers/admins already had update rights).
drop policy if exists "jobs update own or driver or admin" on jobs;
create policy "jobs update own or driver or admin" on jobs
  for update using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());
