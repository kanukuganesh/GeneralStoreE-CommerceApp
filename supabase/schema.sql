-- ============================================================
-- Greeno Grocery — Supabase schema
-- Paste this whole file into Supabase ▸ SQL Editor ▸ Run.
-- ============================================================

-- Extensions
create extension if not exists citext;

-- ---------- PROFILES ----------
-- One row per user. username is the login handle.
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   citext unique not null,
  name       text not null default '',
  phone      text not null default '',
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile whenever a new auth user signs up.
-- We pass username + name through auth metadata at signup.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username, name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    lower(coalesce(new.raw_user_meta_data ->> 'username', '')) = 'ganesh'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------- PRODUCTS ----------
create table if not exists public.products (
  id        bigint primary key,
  name      text not null,
  unit      text not null default '',
  price     numeric not null default 0,
  old       numeric not null default 0,
  discount  text not null default '',
  image     text not null default '',
  emoji     text not null default '',
  category  text not null default '',
  stock     bigint not null default 0,
  sku       text not null default ''
);

-- ---------- ORDERS ----------
create table if not exists public.orders (
  id        text primary key,
  user_id   uuid references public.profiles (id) on delete set null,
  customer  text not null default '',
  username  citext not null default '',
  items     jsonb not null default '[]'::jsonb,
  subtotal  numeric not null default 0,
  delivery  numeric not null default 0,
  discount  numeric not null default 0,
  total     numeric not null default 0,
  address   text not null default '',
  payment   text not null default '',
  placed_at timestamptz not null default now(),
  status    text not null default 'Placed',
  lat       double precision,
  lng       double precision
);

-- ---------- ADDRESSES ----------
create table if not exists public.addresses (
  id         bigint primary key generated always as identity,
  user_id    uuid references public.profiles (id) on delete cascade,
  label      text not null default 'Home',
  name       text not null default '',
  phone      text not null default '',
  line       text not null default '',
  pincode    text not null default '',
  is_default boolean not null default false,
  lat        double precision,
  lng        double precision,
  house      text not null default '',
  colony     text not null default '',
  city       text not null default '',
  mandal     text not null default '',
  district   text not null default '',
  state      text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- WISHLIST ----------
create table if not exists public.wishlist (
  user_id    uuid references public.profiles (id) on delete cascade,
  product_id bigint references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------- PAYMENTS (transactions) ----------
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
alter publication supabase_realtime add table public.payments;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_admin = true
  );
$$;

alter table public.profiles  enable row level security;
alter table public.products  enable row level security;
alter table public.orders    enable row level security;
alter table public.addresses enable row level security;
alter table public.wishlist  enable row level security;

-- Profiles: read/update own; admin reads all. New users insert handled by trigger.
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Products: everyone reads; only admin writes.
drop policy if exists "products_select_all" on public.products;
create policy "products_select_all"
  on public.products for select
  using (true);

drop policy if exists "products_admin_write" on public.products;
create policy "products_admin_write"
  on public.products for all
  using (public.is_admin())
  with check (public.is_admin());

-- Orders: read/insert own; admin reads/writes all.
drop policy if exists "orders_select_own_or_admin" on public.orders;
create policy "orders_select_own_or_admin"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "orders_insert_own" on public.orders;
create policy "orders_insert_own"
  on public.orders for insert
  with check (auth.uid() = user_id);

drop policy if exists "orders_admin_update" on public.orders;
create policy "orders_admin_update"
  on public.orders for update
  using (public.is_admin())
  with check (public.is_admin());

-- Addresses: full CRUD on own rows.
drop policy if exists "addresses_all_own" on public.addresses;
create policy "addresses_all_own"
  on public.addresses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Wishlist: full CRUD on own rows.
drop policy if exists "wishlist_all_own" on public.wishlist;
create policy "wishlist_all_own"
  on public.wishlist for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- REALTIME (live admin/customer sync)
-- ============================================================
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.orders;
