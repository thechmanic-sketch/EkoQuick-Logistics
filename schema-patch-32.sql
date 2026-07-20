-- Indexes on foreign keys / commonly-filtered columns. Postgres does not
-- auto-index foreign key columns (only primary keys and unique constraints),
-- so every one of these was a sequential-scan target under filtering.
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
