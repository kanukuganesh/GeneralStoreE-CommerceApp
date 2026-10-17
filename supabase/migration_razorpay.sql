-- ============================================================
-- Razorpay (online payments) migration — run once in the
-- Supabase SQL Editor. Safe to re-run (idempotent).
-- ============================================================

-- Orders: track payment state separately from fulfilment status.
alter table public.orders
  add column if not exists payment_status      text not null default 'unpaid',
  add column if not exists razorpay_order_id   text,
  add column if not exists razorpay_payment_id text;

create index if not exists orders_razorpay_order_id_idx
  on public.orders (razorpay_order_id);

-- Orders placed before the gateway existed are already settled one way or
-- another (COD/manual UPI) — don't label them unpaid. New rows default to
-- 'unpaid' until verify/webhook marks them paid.
update public.orders set payment_status = 'paid' where payment_status = 'unpaid';

-- Payments/transactions ledger: the transaction id is the primary key.
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

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
  ) then
    alter publication supabase_realtime add table public.payments;
  end if;
end $$;

-- Make sure the admin can see who paid with which transaction id.
grant select on public.payments to authenticated;
grant insert, update on public.orders to authenticated;
