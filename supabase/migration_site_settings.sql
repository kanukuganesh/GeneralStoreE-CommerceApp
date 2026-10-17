-- Shared site settings (payment configuration) — run in the SQL Editor.
-- The admin's Razorpay Key ID and UPI settings are stored here so every
-- phone shows the same payment options, not only the admin's device.

create table if not exists public.site_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

-- The Key ID is public information (it ships inside the app); anyone may read.
drop policy if exists "site_settings_select_all" on public.site_settings;
create policy "site_settings_select_all"
  on public.site_settings for select
  using (true);

-- Only the admin can change settings.
drop policy if exists "site_settings_admin_write" on public.site_settings;
create policy "site_settings_admin_write"
  on public.site_settings for all
  using (public.is_admin())
  with check (public.is_admin());
