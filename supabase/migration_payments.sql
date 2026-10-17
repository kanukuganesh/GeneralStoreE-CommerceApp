-- ============================================================
-- Migration: add the PAYMENTS (transactions) table
-- Run this in the Supabase SQL Editor for the EXISTING database.
-- (schema.sql is only for a brand-new database.)
-- ============================================================

create table if not exists public.payments (
  id           text primary key,
  order_id     text,
  customer     text not null default '',
  username     citext not null default '',
  amount       numeric not null default 0,
  method       text not null default 'UPI',
  upi_app      text,
  merchant_vpa text,
  payer_vpa    text,
  status       text not null default 'pending',
  note         text,
  created_at   timestamptz not null default now()
);

alter table public.payments enable row level security;

drop policy if exists "payments_admin_all" on public.payments;
create policy "payments_admin_all"
  on public.payments for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "payments_insert_own" on public.payments;
create policy "payments_insert_own"
  on public.payments for insert
  with check (auth.uid() is not null);

-- Live admin/customer sync for payments
alter publication supabase_realtime add table public.payments;
