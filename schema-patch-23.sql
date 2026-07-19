alter table profiles add column if not exists emergency_contact_name text;
alter table profiles add column if not exists emergency_contact_phone text;
alter table profiles add column if not exists alternate_contact_name text;
alter table profiles add column if not exists alternate_contact_phone text;
alter table profiles add column if not exists default_vehicle_class text;
alter table profiles add column if not exists preferred_delivery_time text;

alter table profiles add column if not exists default_payment_method text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_default_payment_method_check') then
    alter table profiles add constraint profiles_default_payment_method_check check (default_payment_method in ('cash', 'card', 'eft'));
  end if;
end $$;

alter table profiles add column if not exists language text not null default 'en';
alter table profiles add column if not exists timezone text not null default 'Africa/Johannesburg';
alter table profiles add column if not exists date_format text not null default 'DD/MM/YYYY';

alter table profiles add column if not exists theme_preference text not null default 'dark';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_theme_preference_check') then
    alter table profiles add constraint profiles_theme_preference_check check (theme_preference in ('dark', 'light', 'system'));
  end if;
end $$;

alter table profiles add column if not exists notif_driver_assigned boolean not null default true;
alter table profiles add column if not exists notif_driver_near_pickup boolean not null default true;
alter table profiles add column if not exists notif_parcel_picked_up boolean not null default true;
alter table profiles add column if not exists notif_driver_near_destination boolean not null default true;
alter table profiles add column if not exists notif_delivery_completed boolean not null default true;
alter table profiles add column if not exists notif_promotions boolean not null default true;
alter table profiles add column if not exists notif_support_replies boolean not null default true;
