-- Run in Supabase SQL editor: All Jobs module additions.
alter table jobs add column if not exists assigned_at timestamptz;
alter table jobs add column if not exists cancellation_reason text;
alter table jobs add column if not exists collection_code_resend_count int not null default 0;
alter table jobs add column if not exists collection_code_last_sent_at timestamptz;
alter table jobs add column if not exists delivery_code_resend_count int not null default 0;
alter table jobs add column if not exists delivery_code_last_sent_at timestamptz;
