-- Broaden support_tickets to also serve drivers (dispatch/incident reports),
-- not just customers.
alter table support_tickets alter column customer_id drop not null;
alter table support_tickets add column if not exists driver_id uuid references profiles (id) on delete cascade;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'support_tickets_reporter_check') then
    alter table support_tickets add constraint support_tickets_reporter_check check (customer_id is not null or driver_id is not null);
  end if;
end $$;

alter table support_tickets add column if not exists incident_type text;
alter table support_tickets add column if not exists incident_at timestamptz;
alter table support_tickets add column if not exists incident_lat double precision;
alter table support_tickets add column if not exists incident_lng double precision;
alter table support_tickets add column if not exists witness_info text;

alter table support_tickets drop constraint if exists support_tickets_category_check;
alter table support_tickets add constraint support_tickets_category_check check (category in (
  'delivery_issue', 'driver_complaint', 'payment_issue', 'technical_problem', 'missing_parcel', 'damaged_parcel', 'other',
  'customer_issue', 'vehicle_breakdown', 'navigation_problem', 'account_issue', 'accident_report', 'safety_concern'
));

alter table support_tickets drop constraint if exists support_tickets_status_check;
alter table support_tickets add constraint support_tickets_status_check check (status in (
  'open', 'in_progress', 'waiting_customer', 'waiting_driver', 'resolved', 'closed'
));

drop policy if exists "support_tickets customer select own" on support_tickets;
drop policy if exists "support_tickets select own" on support_tickets;
create policy "support_tickets select own" on support_tickets
  for select using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

drop policy if exists "support_tickets customer insert own" on support_tickets;
drop policy if exists "support_tickets insert own" on support_tickets;
create policy "support_tickets insert own" on support_tickets
  for insert with check (customer_id = auth.uid() or driver_id = auth.uid());

drop policy if exists "support_tickets customer or admin update" on support_tickets;
drop policy if exists "support_tickets owner or admin update" on support_tickets;
create policy "support_tickets owner or admin update" on support_tickets
  for update using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

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
