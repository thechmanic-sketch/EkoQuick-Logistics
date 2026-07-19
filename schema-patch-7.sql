-- Run in Supabase SQL editor: adds a cancelled_at timestamp so a future
-- "Cancel order" action (and the dashboard's activity feed) can show an
-- accurate cancellation time instead of guessing.
alter table jobs add column if not exists cancelled_at timestamptz;
