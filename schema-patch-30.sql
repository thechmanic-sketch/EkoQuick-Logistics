insert into settings (key, value) values ('chat_read_only_hours', '48') on conflict (key) do nothing;
insert into settings (key, value) values ('chat_flagged_keywords', '') on conflict (key) do nothing;

alter table chat_rooms add column if not exists muted_by_admin_user_id uuid references profiles (id) on delete set null;
