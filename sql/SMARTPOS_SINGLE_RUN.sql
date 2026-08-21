-- Smart POS v3.1
-- SINGLE-RUN DATABASE INSTALL / MIGRATION
-- Run this entire file once in Supabase SQL Editor.
-- This file is idempotent where practical and includes the required
-- base schema, cost control, store isolation, membership security,
-- stock movements, audit, storage policies, and atomic sale processing.


-- ============================================================
-- BOOTSTRAP: must be first
-- Ensures the store/account root exists before ANY dependent
-- function, policy, index, or foreign key is created.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- END BOOTSTRAP
-- ============================================================

-- ============================================================
-- SOURCE: 001_fresh_install.sql
-- ============================================================
-- ============================================================
-- Smart POS — Fresh Supabase / GitHub Installation
-- Version 2.0
-- Store model: one Supabase Project/Database = one Smart POS store.
-- owner_id identifies the store owner boundary; local POS members share that store data.
-- No Google Apps Script / Google Sheets integration.
-- NEVER put service_role/secret keys or real store data in GitHub.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- 1. ACCOUNT / PROFILE
-- ------------------------------------------------------------

create table if not exists public.app_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_code text unique,
  store_name text not null,
  status text not null default 'active'
    check (status in ('active','suspended','archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name',
             split_part(coalesce(new.email, 'user'), '@', 1))
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.create_pos_account(
  p_store_name text,
  p_account_code text default null
)
returns public.app_accounts
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.app_accounts;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(coalesce(p_store_name, ''))) < 2 then
    raise exception 'Store name is required';
  end if;

  insert into public.app_accounts (
    user_id, account_code, store_name
  )
  values (
    auth.uid(),
    nullif(trim(p_account_code), ''),
    trim(p_store_name)
  )
  on conflict (user_id) do update
    set store_name = excluded.store_name,
        account_code = coalesce(excluded.account_code, public.app_accounts.account_code),
        updated_at = now()
  returning * into v;

  return v;
end;
$$;

grant execute on function public.create_pos_account(text, text)
to authenticated;

-- ------------------------------------------------------------
-- 2. MAIN POS STATE
--    Compatible with the browser app's current full-state sync.
-- ------------------------------------------------------------

create table if not exists public.pos_state (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_pos_state_owner on public.pos_state(owner_id);

-- ------------------------------------------------------------
-- 3. MASTER DATA
-- ------------------------------------------------------------

create table if not exists public.categories (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  icon text,
  color text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category_id text,
  icon text,
  image_url text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_owner_code
  on public.products(owner_id, id);

create table if not exists public.product_categories (
  id bigserial primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  category_id text not null references public.categories(id) on delete cascade,
  unique(owner_id, product_id, category_id)
);

create table if not exists public.product_variants (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null references public.products(id) on delete cascade,
  size_name text,
  barcode text,
  cost numeric(14,4) not null default 0,
  price numeric(14,4) not null default 0,
  stock numeric(14,4) not null default 0,
  min_stock numeric(14,4) not null default 0,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_variants_owner_barcode
  on public.product_variants(owner_id, barcode);

create table if not exists public.product_fractions (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  variant_id text not null references public.product_variants(id) on delete cascade,
  fraction_name text not null,
  fraction_multiplier numeric(14,6) not null default 1,
  fraction_price numeric(14,4) not null default 0,
  payload_json jsonb not null default '{}'::jsonb
);

-- ------------------------------------------------------------
-- 4. CUSTOMERS / SUPPLIERS
-- ------------------------------------------------------------

create table if not exists public.customers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  tax_id text,
  address text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suppliers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  tax_id text,
  address text,
  terms integer not null default 0,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


-- ============================================================
-- COMPATIBILITY v4 (retained for legacy app_accounts): user_id / identity column safety
-- PostgreSQL will not add missing columns when a table already
-- exists. Add the identity columns required by later policies,
-- indexes and functions before those objects are created.
-- ============================================================

-- app_accounts is keyed by the Supabase Auth user in this build.
create table if not exists public.app_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_code text unique,
  store_name text not null default 'My Store',
  status text not null default 'active',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.app_accounts
  add column if not exists user_id uuid,
  add column if not exists account_code text,
  add column if not exists store_name text,
  add column if not exists status text,
  add column if not exists settings jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- If an older app_accounts table uses another primary identity column,
-- do not fabricate user IDs. Existing rows will be migrated only when
-- a safe source column exists.
do $$
begin
  if to_regclass('public.app_accounts') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema='public'
        and table_name='app_accounts'
        and column_name='id'
        and data_type='uuid'
    ) then
      update public.app_accounts
      set user_id = id
      where user_id is null;
    end if;
  end if;
end $$;

-- profiles
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.profiles
  add column if not exists user_id uuid,
  add column if not exists display_name text,
  add column if not exists phone text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- store_members must have user_id because membership/RLS checks use it.
alter table if exists public.store_members
  add column if not exists user_id uuid,
  add column if not exists store_id uuid,
  add column if not exists role text,
  add column if not exists status text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Other tenant tables: add user_id before any legacy policy/function references.
do $$
declare
  t text;
begin
  foreach t in array array[
    'products','product_variants','bills','bill_items','sales','sale_items',
    'payments','stock_movements','purchase_cost_history','cost_history',
    'audit_log','cash_ledger','shifts','customers','suppliers'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I add column if not exists user_id uuid', t);
      execute format('alter table public.%I add column if not exists store_id uuid', t);
    end if;
  end loop;
end $$;

-- Do not create a fake auth user. For an existing single-owner database,
-- app code should assign the authenticated user's UUID to user_id.

-- ------------------------------------------------------------
-- 5. SALES / RECEIPTS / CUSTOMER PAYMENTS
-- ------------------------------------------------------------

create table if not exists public.bills (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id text,
  total numeric(14,2) not null default 0,
  payment_method text,
  status text not null default 'OPEN',
  sold_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bills_owner_date
  on public.bills(owner_id, sold_at desc);

create table if not exists public.bill_items (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bill_id text not null references public.bills(id) on delete cascade,
  product_id text,
  variant_id text,
  name text,
  qty numeric(14,4) not null default 0,
  unit_price numeric(14,4) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  payload_json jsonb not null default '{}'::jsonb
);


-- ============================================================
-- COMPATIBILITY: bills / bill_items for existing databases
-- Must run AFTER the tables exist so UPDATE/INDEX statements are safe.
-- ============================================================
alter table if exists public.bills
  add column if not exists owner_id uuid,
  add column if not exists store_id uuid,
  add column if not exists customer_id text,
  add column if not exists total numeric(14,2) not null default 0,
  add column if not exists payment_method text,
  add column if not exists status text not null default 'OPEN',
  add column if not exists sold_at timestamptz,
  add column if not exists payload_json jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update public.bills
set sold_at = coalesce(sold_at, created_at, now())
where sold_at is null;

alter table public.bills alter column sold_at set default now();

create index if not exists idx_bills_owner_date on public.bills(owner_id, sold_at desc);
create index if not exists idx_bills_store_date on public.bills(store_id, sold_at desc);

alter table if exists public.bill_items
  add column if not exists owner_id uuid,
  add column if not exists store_id uuid,
  add column if not exists bill_id text,
  add column if not exists product_id text,
  add column if not exists variant_id text,
  add column if not exists name text,
  add column if not exists qty numeric(14,4) not null default 0,
  add column if not exists unit_price numeric(14,4) not null default 0,
  add column if not exists unit_cost numeric(14,4) not null default 0,
  add column if not exists line_total numeric(14,2) not null default 0,
  add column if not exists payload_json jsonb not null default '{}'::jsonb;

create table if not exists public.receipts (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  customer_id text,
  total_received numeric(14,2) not null default 0,
  payment_method text not null,
  received_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_payment_allocations (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  receipt_id text not null references public.receipts(id) on delete cascade,
  bill_id text not null references public.bills(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0)
);

-- ------------------------------------------------------------
-- 6. PURCHASE / RECEIVING / SUPPLIER PAYABLES
-- ------------------------------------------------------------

create table if not exists public.purchase_orders (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  supplier_id text,
  ordered_at timestamptz not null default now(),
  due_date date,
  terms integer not null default 0,
  total numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'DRAFT',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_items (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  purchase_order_id text not null references public.purchase_orders(id) on delete cascade,
  product_id text,
  variant_id text,
  qty_ordered numeric(14,4) not null default 0,
  qty_received numeric(14,4) not null default 0,
  actual_cost numeric(14,4) not null default 0,
  payload_json jsonb not null default '{}'::jsonb
);

create table if not exists public.receiving_documents (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  purchase_order_id text,
  supplier_id text,
  supplier_delivery_no text,
  supplier_invoice_no text,
  received_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.supplier_payments (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  supplier_id text,
  purchase_order_id text,
  amount numeric(14,2) not null check (amount > 0),
  payment_method text not null,
  paid_at timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 7. CASH / SHIFTS
-- ------------------------------------------------------------

create table if not exists public.cash_ledger (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  description text,
  income numeric(14,2) not null default 0,
  expense numeric(14,2) not null default 0,
  type text,
  ref_id text,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.shifts (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  start_time timestamptz not null default now(),
  end_time timestamptz,
  cash_on_hand numeric(14,2) not null default 0,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 8. DOCUMENTS / AUDIT / ERROR LOGS
-- ------------------------------------------------------------

create table if not exists public.documents (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text,
  note text,
  file_url text,
  file_storage_path text,
  file_type text,
  time timestamptz not null default now(),
  payload_json jsonb not null default '{}'::jsonb
);


-- ============================================================
-- 8. DOCUMENTS / AUDIT / ERROR LOGS
-- Canonical audit schema. Keep one definition only.
-- ============================================================
create table if not exists public.audit_log (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  store_id uuid,
  ts timestamptz not null default now(),
  action text not null,
  actor text,
  details jsonb not null default '{}'::jsonb,
  device_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.audit_log
  add column if not exists owner_id uuid,
  add column if not exists store_id uuid,
  add column if not exists ts timestamptz,
  add column if not exists action text,
  add column if not exists actor text,
  add column if not exists details jsonb,
  add column if not exists device_id text,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz;

alter table public.audit_log alter column details set default '{}'::jsonb;
alter table public.audit_log alter column ts set default now();
alter table public.audit_log alter column created_at set default now();

update public.audit_log
set created_by = coalesce(created_by, user_id)
where created_by is null
  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='audit_log' and column_name='user_id');

create index if not exists idx_audit_log_store_created on public.audit_log(store_id, ts desc);
create index if not exists idx_audit_log_created_by on public.audit_log(created_by, ts desc);

create table if not exists public.error_logs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  error_type text,
  message text,
  stack_trace text,
  device_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- ------------------------------------------------------------
-- 9. UPDATED-AT TRIGGERS
-- ------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_accounts','profiles','pos_state','categories','products',
    'product_variants','customers','suppliers','bills',
    'purchase_orders'
  ]
  loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    execute format(
      'create trigger trg_%I_updated_at
       before update on public.%I
       for each row execute function public.set_updated_at()',
      t, t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 10. RLS — every public business table is owner-isolated.
-- ------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'app_accounts','profiles','pos_state','categories','products',
    'product_categories','product_variants','product_fractions',
    'customers','suppliers','bills','bill_items','receipts',
    'customer_payment_allocations','purchase_orders',
    'purchase_order_items','receiving_documents','supplier_payments',
    'cash_ledger','shifts','documents','audit_log','error_logs'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- Remove all existing policies from this clean-install schema.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Account owner.
create policy app_accounts_own_select
on public.app_accounts for select to authenticated
using ((select auth.uid()) = user_id);

create policy app_accounts_own_insert
on public.app_accounts for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy app_accounts_own_update
on public.app_accounts for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Own profile.
create policy profiles_own_select
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_own_update
on public.profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- All business tables use the store owner Auth user id in owner_id.
-- owner_id identifies the STORE, not the current cashier/member.
do $$
declare
  t text;
begin
  foreach t in array array[
    'pos_state','categories','products','product_categories',
    'product_variants','product_fractions','customers','suppliers',
    'bills','bill_items','receipts','customer_payment_allocations',
    'purchase_orders','purchase_order_items','receiving_documents',
    'supplier_payments','cash_ledger','shifts','documents'
  ]
  loop
    execute format(
      'create policy %I_select on public.%I
       for select to authenticated
       using ((select auth.uid()) = owner_id)',
      t, t
    );
    execute format(
      'create policy %I_insert on public.%I
       for insert to authenticated
       with check ((select auth.uid()) = owner_id)',
      t, t
    );
    execute format(
      'create policy %I_update on public.%I
       for update to authenticated
       using ((select auth.uid()) = owner_id)
       with check ((select auth.uid()) = owner_id)',
      t, t
    );
    execute format(
      'create policy %I_delete on public.%I
       for delete to authenticated
       using ((select auth.uid()) = owner_id)',
      t, t
    );
  end loop;
end $$;

-- Audit log: append/read only. No DELETE policy.
create policy audit_log_select
on public.audit_log for select to authenticated
using ((select auth.uid()) = owner_id);

create policy audit_log_insert
on public.audit_log for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and (created_by is null or created_by = (select auth.uid()))
);

-- Error logs: read/append only.

-- ============================================================
-- COMPATIBILITY v6 (retained for legacy error_logs): error_logs.created_by safety
-- ============================================================
create table if not exists public.error_logs (
  id text primary key,
  owner_id uuid,
  store_id uuid,
  error_type text,
  message text,
  stack_trace text,
  device_id text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

alter table if exists public.error_logs
  add column if not exists owner_id uuid,
  add column if not exists store_id uuid,
  add column if not exists error_type text,
  add column if not exists message text,
  add column if not exists stack_trace text,
  add column if not exists device_id text,
  add column if not exists created_at timestamptz,
  add column if not exists created_by uuid;

update public.error_logs
set created_by = owner_id
where created_by is null
  and owner_id is not null;

alter table if exists public.error_logs
  alter column created_at set default now();

create policy error_logs_select
on public.error_logs for select to authenticated
using ((select auth.uid()) = owner_id);

create policy error_logs_insert
on public.error_logs for insert to authenticated
with check (
  (select auth.uid()) = owner_id
  and (created_by is null or created_by = (select auth.uid()))
);

-- ------------------------------------------------------------
-- 11. STORAGE
--     Private buckets. Current app stores files under user-id folders.
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', false)
on conflict (id) do update set public = false;

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

drop policy if exists product_images_own_select on storage.objects;
create policy product_images_own_select
on storage.objects for select to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists product_images_own_insert on storage.objects;
create policy product_images_own_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists product_images_own_delete on storage.objects;
create policy product_images_own_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists documents_own_select on storage.objects;
create policy documents_own_select
on storage.objects for select to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists documents_own_insert on storage.objects;
create policy documents_own_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists documents_own_delete on storage.objects;
create policy documents_own_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);


-- ------------------------------------------------------------
-- 12. API GRANTS
--     RLS is the authorization layer; anonymous browser access is denied.
-- ------------------------------------------------------------

revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ============================================================
-- FIRST ACCOUNT SETUP
-- ============================================================
-- 1. Create the owner in Supabase Auth (email + password).
-- 2. Sign in from Smart POS.
-- 3. Create the app account with:
--
--    select * from public.create_pos_account('ชื่อร้าน', 'ACCOUNT-001');
--
-- 4. Then create/upsert the initial pos_state row:
--
--    insert into public.pos_state (id, owner_id, data, updated_by)
--    values ('main', auth.uid(), '{}'::jsonb, auth.uid())
--    on conflict (id) do nothing;
--
-- 5. Use ONLY the publishable/anon key in the browser.
--    NEVER put service_role or sb_secret in index.html, GitHub,
--    browser localStorage, or client-side JavaScript.


-- ============================================================
-- SOURCE: 002_cost_control.sql
-- ============================================================
-- Smart POS PRO — Cost Control / Inventory Intelligence migration
-- Run after 001_fresh_install.sql.
-- Model: historical sale cost is immutable; current remaining stock is revalued to latest received cost.

alter table public.product_variants
  add column if not exists last_cost numeric(14,4) not null default 0,
  add column if not exists current_cost numeric(14,4) not null default 0,
  add column if not exists min_margin_pct numeric(7,3) not null default 20,
  add column if not exists cost_updated_at timestamptz not null default now();

update public.product_variants
set last_cost = case when last_cost = 0 then cost else last_cost end,
    current_cost = case when current_cost = 0 then cost else current_cost end,
    cost_updated_at = coalesce(cost_updated_at, updated_at);

create table if not exists public.stock_movements (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  time timestamptz not null default now(),
  type text not null check (type in ('OPENING','SALE','REFUND','RECEIVE','ADJUST','COUNT','VOID')),
  product_id text,
  variant_id text,
  qty numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0,
  ref_id text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  device_id text,
  payload_json jsonb not null default '{}'::jsonb
);
create index if not exists idx_stock_movements_owner_variant_time on public.stock_movements(owner_id, variant_id, time desc);

create table if not exists public.purchase_cost_history (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  time timestamptz not null default now(),
  product_id text,
  variant_id text,
  supplier_id text,
  qty numeric(14,4) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  ref_id text,
  created_by uuid references auth.users(id) on delete set null
);
create index if not exists idx_purchase_cost_history_owner_variant_time on public.purchase_cost_history(owner_id, variant_id, time desc);

create table if not exists public.cost_history (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  time timestamptz not null default now(),
  product_id text,
  variant_id text,
  old_cost numeric(14,4) not null default 0,
  new_cost numeric(14,4) not null default 0,
  change_pct numeric(12,4),
  ref_id text,
  created_by uuid references auth.users(id) on delete set null
);

alter table public.bill_items add column if not exists cost_at_sale numeric(14,4);
alter table public.bill_items add column if not exists profit_at_sale numeric(14,4);
alter table public.bill_items add column if not exists refunded_qty numeric(14,4) not null default 0;

create table if not exists public.sale_transactions (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  bill_id text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique(owner_id, idempotency_key)
);

create table if not exists public.terminals (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  terminal_code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(owner_id, terminal_code)
);

-- Server-side atomic stock decrement for online checkout.
create or replace function public.decrement_stock_atomic(
  p_variant_id text,
  p_qty numeric
) returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare v_stock numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_qty <= 0 then raise exception 'Quantity must be positive'; end if;
  update public.product_variants
     set stock = stock - p_qty, updated_at = now()
   where id = p_variant_id and owner_id = auth.uid() and stock >= p_qty
   returning stock into v_stock;
  if v_stock is null then raise exception 'Insufficient stock or variant not found'; end if;
  return v_stock;
end;
$$;

-- Atomic latest-cost revaluation for the remaining current stock.
create or replace function public.apply_latest_cost(
  p_variant_id text,
  p_new_cost numeric,
  p_ref_id text default null
) returns public.product_variants
language plpgsql
security invoker
set search_path = public
as $$
declare v public.product_variants;
       old numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_new_cost < 0 then raise exception 'Cost cannot be negative'; end if;
  select cost into old from public.product_variants where id=p_variant_id and owner_id=auth.uid() for update;
  if not found then raise exception 'Variant not found'; end if;
  update public.product_variants
     set cost=p_new_cost, last_cost=p_new_cost, current_cost=p_new_cost, cost_updated_at=now(), updated_at=now()
   where id=p_variant_id and owner_id=auth.uid()
   returning * into v;
  insert into public.cost_history(id, owner_id, variant_id, old_cost, new_cost, change_pct, ref_id, created_by)
  values ('CH-'||gen_random_uuid()::text, auth.uid(), p_variant_id, old, p_new_cost,
          case when old > 0 then ((p_new_cost-old)/old)*100 else null end, p_ref_id, auth.uid());
  return v;
end;
$$;

-- RLS
alter table public.stock_movements enable row level security;
alter table public.purchase_cost_history enable row level security;
alter table public.cost_history enable row level security;
alter table public.sale_transactions enable row level security;
alter table public.terminals enable row level security;

drop policy if exists stock_movements_own on public.stock_movements;
create policy stock_movements_own on public.stock_movements for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists purchase_cost_history_own on public.purchase_cost_history;
create policy purchase_cost_history_own on public.purchase_cost_history for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists cost_history_own on public.cost_history;
create policy cost_history_own on public.cost_history for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists sale_transactions_own on public.sale_transactions;
create policy sale_transactions_own on public.sale_transactions for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
drop policy if exists terminals_own on public.terminals;
create policy terminals_own on public.terminals for all to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);

revoke all on public.stock_movements, public.purchase_cost_history, public.cost_history, public.sale_transactions, public.terminals from anon;
grant select, insert, update, delete on public.stock_movements, public.purchase_cost_history, public.cost_history, public.sale_transactions, public.terminals to authenticated;
grant execute on function public.decrement_stock_atomic(text,numeric) to authenticated;
grant execute on function public.apply_latest_cost(text,numeric,text) to authenticated;

-- ============================================================
-- SOURCE: 003_store_isolation.sql
-- ============================================================
-- Smart POS v2.2: one Supabase project/database = one store.

create unique index if not exists ux_app_accounts_single_store on public.app_accounts ((true));
comment on table public.app_accounts is 'One Supabase project/database represents exactly one Smart POS store.';
comment on column public.pos_state.owner_id is 'Store owner Auth user id; this identifies the store, not the current cashier.';

-- ============================================================
-- SOURCE: 004_store_membership_security.sql
-- ============================================================
-- Smart POS v2.3 — Store membership, server authorization and safer grants
-- One Supabase Project = exactly one store. Members share the same store data.
-- A different store MUST use a different Supabase Project/database.

create extension if not exists pgcrypto;

alter table public.app_accounts
  add column if not exists store_id uuid;

update public.app_accounts
set store_id = coalesce(store_id, gen_random_uuid())
where store_id is null;

alter table public.app_accounts alter column store_id set not null;
create unique index if not exists ux_app_accounts_store_id on public.app_accounts(store_id);

create table if not exists public.store_members (
  store_id uuid not null references public.app_accounts(store_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff' check (role in ('owner','manager','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index if not exists idx_store_members_user on public.store_members(user_id, active);

-- Existing owner becomes the owner member of this store.
insert into public.store_members(store_id, user_id, role)
select store_id, user_id, 'owner' from public.app_accounts
on conflict (store_id, user_id) do update set role='owner', active=true;

create or replace function public.current_store_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select sm.store_id
  from public.store_members sm
  where sm.user_id = auth.uid() and sm.active = true
  limit 1
$$;

create or replace function public.current_store_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sm.role
  from public.store_members sm
  where sm.store_id = public.current_store_id()
    and sm.user_id = auth.uid()
    and sm.active = true
  limit 1
$$;

create or replace function public.get_my_store()
returns table(store_id uuid, store_name text, role text, active boolean)
language sql
stable
security invoker
set search_path = public
as $$
  select sm.store_id, aa.store_name, sm.role, sm.active
  from public.store_members sm
  join public.app_accounts aa on aa.store_id = sm.store_id
  where sm.user_id = auth.uid() and sm.active = true
  limit 1
$$;

-- Owner-only member provisioning. The target Auth user must already exist
-- (created through Supabase Auth signUp/invite flow); this function only grants access.
create or replace function public.add_store_member(p_user_id uuid, p_role text default 'staff')
returns public.store_members
language plpgsql
security definer
set search_path = public
as $$
declare v public.store_members; s uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  s := public.current_store_id();
  if s is null then raise exception 'Store not found'; end if;
  if public.current_store_role() <> 'owner' then raise exception 'Only the store owner can add members'; end if;
  if p_user_id is null then raise exception 'Member user id is required'; end if;
  if p_role not in ('manager','staff') then raise exception 'Invalid member role'; end if;
  insert into public.store_members(store_id,user_id,role,active)
  values(s,p_user_id,p_role,true)
  on conflict(store_id,user_id) do update set role=excluded.role,active=true,updated_at=now()
  returning * into v;
  return v;
end;
$$;

create or replace function public.remove_store_member(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare s uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  s := public.current_store_id();
  if public.current_store_role() <> 'owner' then raise exception 'Only the store owner can remove members'; end if;
  update public.store_members set active=false,updated_at=now()
  where store_id=s and user_id=p_user_id and role <> 'owner';
  return found;
end;
$$;

-- Add store_id to all business tables. Existing owner_id remains as actor/creator metadata.
do $$
declare t text;
begin
  foreach t in array array[
    'pos_state','categories','products','product_categories','product_variants','product_fractions',
    'customers','suppliers','bills','bill_items','receipts','customer_payment_allocations',
    'purchase_orders','purchase_order_items','receiving_documents','supplier_payments',
    'cash_ledger','shifts','documents','audit_log','error_logs','stock_movements',
    'purchase_cost_history','cost_history','sale_transactions','terminals'
  ] loop
    execute format('alter table public.%I add column if not exists store_id uuid',t);
    execute format('update public.%I t set store_id = a.store_id from public.app_accounts a where t.store_id is null and t.owner_id = a.user_id',t);
    execute format('create index if not exists %I on public.%I(store_id)', 'idx_'||t||'_store_id', t);
  end loop;
end $$;

-- Trigger fills store_id for member writes and rejects cross-store writes.
create or replace function public.set_business_store_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s uuid;
begin
  s := public.current_store_id();
  if s is null then raise exception 'No active store membership'; end if;
  if new.store_id is null then new.store_id := s;
  elsif new.store_id <> s then raise exception 'Cross-store write denied'; end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'pos_state','categories','products','product_categories','product_variants','product_fractions',
    'customers','suppliers','bills','bill_items','receipts','customer_payment_allocations',
    'purchase_orders','purchase_order_items','receiving_documents','supplier_payments',
    'cash_ledger','shifts','documents','audit_log','error_logs','stock_movements',
    'purchase_cost_history','cost_history','sale_transactions','terminals'
  ] loop
    execute format('drop trigger if exists trg_%I_store on public.%I',t,t);
    execute format('create trigger trg_%I_store before insert or update on public.%I for each row execute function public.set_business_store_id()',t,t);
  end loop;
end $$;

-- Remove legacy cost-control owner-only policies created by 002.
drop policy if exists stock_movements_own on public.stock_movements;
drop policy if exists purchase_cost_history_own on public.purchase_cost_history;
drop policy if exists cost_history_own on public.cost_history;
drop policy if exists sale_transactions_own on public.sale_transactions;
drop policy if exists terminals_own on public.terminals;

-- Replace owner-only business RLS with store-membership RLS.
do $$
declare t text;
begin
  foreach t in array array[
    'pos_state','categories','products','product_categories','product_variants','product_fractions',
    'customers','suppliers','bills','bill_items','receipts','customer_payment_allocations',
    'purchase_orders','purchase_order_items','receiving_documents','supplier_payments',
    'cash_ledger','shifts','documents','stock_movements','purchase_cost_history',
    'cost_history','sale_transactions','terminals'
  ] loop
    execute format('drop policy if exists %I_select on public.%I',t,t);
    execute format('drop policy if exists %I_insert on public.%I',t,t);
    execute format('drop policy if exists %I_update on public.%I',t,t);
    execute format('drop policy if exists %I_delete on public.%I',t,t);
    execute format('create policy %I_store_select on public.%I for select to authenticated using (store_id = public.current_store_id())',t,t);
    execute format('create policy %I_store_insert on public.%I for insert to authenticated with check (store_id = public.current_store_id())',t,t);
    execute format('create policy %I_store_update on public.%I for update to authenticated using (store_id = public.current_store_id()) with check (store_id = public.current_store_id())',t,t);
    execute format('create policy %I_store_delete on public.%I for delete to authenticated using (store_id = public.current_store_id())',t,t);
  end loop;
end $$;

-- Audit/error logs: members can read/append within their store; created_by is always the Auth actor.
drop policy if exists audit_log_select on public.audit_log;
drop policy if exists audit_log_insert on public.audit_log;
create policy audit_log_store_select on public.audit_log for select to authenticated using (store_id = public.current_store_id());
create policy audit_log_store_insert on public.audit_log for insert to authenticated with check (store_id = public.current_store_id() and (created_by is null or created_by = auth.uid()));

drop policy if exists error_logs_select on public.error_logs;
drop policy if exists error_logs_insert on public.error_logs;
create policy error_logs_store_select on public.error_logs for select to authenticated using (store_id = public.current_store_id());
create policy error_logs_store_insert on public.error_logs for insert to authenticated with check (store_id = public.current_store_id() and (created_by is null or created_by = auth.uid()));

alter table public.store_members enable row level security;
drop policy if exists store_members_select on public.store_members;
create policy store_members_select on public.store_members for select to authenticated using (store_id = public.current_store_id());

-- App account is store metadata: owner can update, members can read their store.
drop policy if exists app_accounts_own_select on public.app_accounts;
drop policy if exists app_accounts_own_insert on public.app_accounts;
drop policy if exists app_accounts_own_update on public.app_accounts;
create policy app_accounts_store_select on public.app_accounts for select to authenticated using (store_id = public.current_store_id());
create policy app_accounts_owner_update on public.app_accounts for update to authenticated using (store_id = public.current_store_id() and public.current_store_role()='owner') with check (store_id = public.current_store_id());

-- Keep store_id available to the API; clients cannot assign a foreign store due to trigger/RLS.
revoke all on public.store_members from anon;
grant select on public.store_members to authenticated;
grant execute on function public.current_store_id(), public.current_store_role(), public.get_my_store(), public.add_store_member(uuid,text), public.remove_store_member(uuid) to authenticated;


create or replace function public.create_pos_account(
  p_store_name text,
  p_account_code text default null
)
returns public.app_accounts
language plpgsql
security definer
set search_path = public
as $$
declare v public.app_accounts;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_store_name,''))) < 2 then raise exception 'Store name is required'; end if;
  insert into public.app_accounts(user_id,account_code,store_name,store_id)
  values(auth.uid(),nullif(trim(p_account_code),''),trim(p_store_name),gen_random_uuid())
  on conflict(user_id) do update set store_name=excluded.store_name, account_code=coalesce(excluded.account_code,public.app_accounts.account_code), updated_at=now()
  returning * into v;
  insert into public.store_members(store_id,user_id,role,active)
  values(v.store_id,auth.uid(),'owner',true)
  on conflict(store_id,user_id) do update set role='owner',active=true,updated_at=now();
  return v;
end;
$$;

drop policy if exists app_accounts_own_insert on public.app_accounts;
create policy app_accounts_owner_insert on public.app_accounts for insert to authenticated with check ((select auth.uid())=user_id);
revoke all on public.app_accounts from anon;
revoke all on public.app_accounts from authenticated;
grant select, insert, update on public.app_accounts to authenticated;
grant execute on function public.create_pos_account(text,text) to authenticated;

-- Existing tables were previously granted broad CRUD. Narrow them now; RLS controls rows.
revoke all on public.audit_log, public.error_logs, public.store_members from authenticated;
grant select, insert on public.audit_log, public.error_logs to authenticated;
grant select on public.store_members to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'pos_state','categories','products','product_categories','product_variants','product_fractions',
    'customers','suppliers','bills','bill_items','receipts','customer_payment_allocations',
    'purchase_orders','purchase_order_items','receiving_documents','supplier_payments',
    'cash_ledger','shifts','documents','stock_movements','purchase_cost_history',
    'cost_history','sale_transactions','terminals'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated',t);
  end loop;
end $$;

-- Store identity can now be read by the owner/member without exposing another store.


-- Storage is private and store-scoped. New files use <store_id>/...; legacy owner folders remain readable by their owner.
drop policy if exists product_images_own_select on storage.objects;
drop policy if exists product_images_own_insert on storage.objects;
drop policy if exists product_images_own_delete on storage.objects;
create policy product_images_store_select on storage.objects for select to authenticated
using (bucket_id='product-images' and ((storage.foldername(name))[1] = public.current_store_id()::text or (storage.foldername(name))[1] = auth.uid()::text));
create policy product_images_store_insert on storage.objects for insert to authenticated
with check (bucket_id='product-images' and (storage.foldername(name))[1] = public.current_store_id()::text);
create policy product_images_store_delete on storage.objects for delete to authenticated
using (bucket_id='product-images' and ((storage.foldername(name))[1] = public.current_store_id()::text or (storage.foldername(name))[1] = auth.uid()::text));

drop policy if exists documents_own_select on storage.objects;
drop policy if exists documents_own_insert on storage.objects;
drop policy if exists documents_own_delete on storage.objects;
create policy documents_store_select on storage.objects for select to authenticated
using (bucket_id='documents' and ((storage.foldername(name))[1] = public.current_store_id()::text or (storage.foldername(name))[1] = auth.uid()::text));
create policy documents_store_insert on storage.objects for insert to authenticated
with check (bucket_id='documents' and (storage.foldername(name))[1] = public.current_store_id()::text);
create policy documents_store_delete on storage.objects for delete to authenticated
using (bucket_id='documents' and ((storage.foldername(name))[1] = public.current_store_id()::text or (storage.foldername(name))[1] = auth.uid()::text));


-- Server-side checkout transaction. This is the authoritative online path:
-- stock lock + price guard + bill + bill items + receipt + cash ledger + stock movement + idempotency.
create or replace function public.process_sale_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  s uuid := public.current_store_id();
  uid uuid := auth.uid();
  idem text := p_payload->>'idempotency_key';
  bill_id text := p_payload->>'bill_id';
  method text := coalesce(p_payload->>'payment_method','CASH');
  customer_id text := coalesce(p_payload->>'customer_id','GENERAL');
  total numeric := 0;
  total_cost numeric := 0;
  received numeric := coalesce((p_payload->>'received')::numeric,0);
  change_amt numeric := coalesce((p_payload->>'change')::numeric,0);
  item jsonb;
  v public.product_variants;
  line_total numeric;
  line_cost numeric;
  cost_at_sale numeric;
  qty numeric;
  multiplier numeric;
  price numeric;
  min_price numeric;
  result jsonb;
  items_out jsonb := '[]'::jsonb;
begin
  if uid is null or s is null then raise exception 'Authentication/store membership required'; end if;
  if idem is null or length(idem) < 10 then raise exception 'Idempotency key required'; end if;
  if bill_id is null or length(bill_id) < 3 then raise exception 'Bill id required'; end if;

  select b.payload_json || jsonb_build_object('idempotent_replay',true) into result
  from public.bills b join public.sale_transactions st on st.bill_id=b.id
  where st.store_id=s and st.idempotency_key=idem limit 1;
  if result is not null then return result; end if;

  for item in select * from jsonb_array_elements(coalesce(p_payload->'items','[]'::jsonb)) loop
    qty := coalesce((item->>'qty')::numeric,0);
    multiplier := coalesce((item->>'multiplier')::numeric,1);
    price := round(coalesce((item->>'price')::numeric,0),2);
    if qty <= 0 or multiplier <= 0 then raise exception 'Invalid quantity'; end if;

    select * into v from public.product_variants where id=(item->>'variant_id') and store_id=s for update;
    if not found then raise exception 'Variant not found: %', item->>'variant_id'; end if;
    if v.stock < qty*multiplier then raise exception 'Insufficient stock for variant %', v.id; end if;

    cost_at_sale := round(coalesce(v.current_cost,v.last_cost,v.cost,0) * multiplier,2);
    min_price := round(coalesce(v.current_cost,v.last_cost,v.cost,0) * (1 + coalesce(v.min_margin_pct,20)/100),2);
    if price > 0 and price < min_price and public.current_store_role() not in ('owner','manager') then
      raise exception 'Selling price below protected minimum for variant %', v.id;
    end if;

    line_total := round(qty*price,2);
    line_cost := round(qty*cost_at_sale,2);
    total := total + line_total;
    total_cost := total_cost + line_cost;

    update public.product_variants set stock=stock-(qty*multiplier), updated_at=now() where id=v.id and store_id=s;
    insert into public.bill_items(id,owner_id,store_id,bill_id,product_id,variant_id,name,qty,unit_price,unit_cost,line_total,payload_json)
    values('BI-'||gen_random_uuid()::text,uid,s,bill_id,item->>'product_id',v.id,coalesce(item->>'name',''),qty,price,cost_at_sale,line_total,jsonb_build_object('cost_at_sale',cost_at_sale,'profit_at_sale',round(line_total-line_cost,2),'multiplier',multiplier));
    insert into public.stock_movements(id,owner_id,store_id,type,product_id,variant_id,qty,unit_cost,ref_id,created_by)
    values('SM-'||gen_random_uuid()::text,uid,s,'SALE',item->>'product_id',v.id,-(qty*multiplier),cost_at_sale,bill_id,uid);
    items_out := items_out || jsonb_build_array(jsonb_build_object('productId',item->>'product_id','variantId',v.id,'qty',qty,'multiplier',multiplier,'price',price,'name',coalesce(item->>'name',''),'costAtSale',cost_at_sale,'profitAtSale',round(line_total-line_cost,2),'fractionId',item->>'fractionId'));
  end loop;

  if total <= 0 then raise exception 'Sale total must be positive'; end if;
  if method='CASH' and received < total then raise exception 'Insufficient cash received'; end if;
  if method='CREDIT' and customer_id='GENERAL' then raise exception 'Customer required for credit sale'; end if;

  insert into public.bills(id,owner_id,store_id,customer_id,total,payment_method,status,sold_at,payload_json)
  values(bill_id,uid,s,customer_id,total,method,'PAID',now(),jsonb_build_object('idempotency_key',idem,'total_cost',total_cost,'profit_at_sale',round(total-total_cost,2),'received',received,'change',change_amt,'items',items_out,'actor_user_id',uid));

  insert into public.sale_transactions(id,owner_id,store_id,bill_id,idempotency_key,created_at)
  values('ST-'||gen_random_uuid()::text,uid,s,bill_id,idem,now());

  insert into public.receipts(id,owner_id,store_id,customer_id,total_received,payment_method,payload_json)
  values('RC-'||gen_random_uuid()::text,uid,s,customer_id,case when method='CASH' then received else total end,method,jsonb_build_object('bill_id',bill_id,'change',change_amt));

  if method <> 'CREDIT' then
    insert into public.cash_ledger(id,owner_id,store_id,date,description,income,expense,type,ref_id,payload_json)
    values('TX-'||gen_random_uuid()::text,uid,s,current_date,'รับเงินขายหน้าร้าน บิลเลขที่ '||bill_id,total,0,'income-sales',bill_id,jsonb_build_object('payment_method',method));
  end if;

  insert into public.audit_log(id,owner_id,store_id,ts,action,actor,details,created_by)
  values('AL-'||gen_random_uuid()::text,uid,s,now(),'SALE',coalesce(p_payload->>'actor_name',''),jsonb_build_object('bill_id',bill_id,'total',total,'payment_method',method,'item_count',jsonb_array_length(items_out)),uid);

  result := jsonb_build_object('bill_id',bill_id,'idempotency_key',idem,'total',round(total,2),'total_cost',round(total_cost,2),'profit_at_sale',round(total-total_cost,2),'received',received,'change',change_amt,'payment_method',method,'customer_id',customer_id,'items',items_out,'server_time',now());
  update public.bills set payload_json=payload_json || result where id=bill_id and store_id=s;
  return result;
end;
$$;

grant execute on function public.process_sale_atomic(jsonb) to authenticated;

-- ============================================================
-- Final compatibility / safety checks
-- ============================================================

-- Ensure RLS is enabled on the core tenant tables if they exist.
do $$
declare
  t text;
begin
  foreach t in array array[
    'store_members',
    'products',
    'product_variants',
    'sales',
    'sale_items',
    'payments',
    'stock_movements',
    'purchase_cost_history',
    'cost_history',
    'audit_log',
    'cash_ledger',
    'shifts'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
    end if;
  end loop;
end $$;


-- ============================================================
-- FINAL SANITY CHECKS
-- ============================================================
do $$
begin
  if to_regclass('public.app_accounts') is null then
    raise exception 'SmartPOS install incomplete: public.app_accounts was not created';
  end if;

  if to_regclass('public.products') is null then
    raise exception 'SmartPOS install incomplete: public.products was not created';
  end if;

  if to_regclass('public.product_variants') is null then
    raise exception 'SmartPOS install incomplete: public.product_variants was not created';
  end if;

  if to_regclass('public.store_members') is null then
    raise exception 'SmartPOS install incomplete: public.store_members was not created';
  end if;
end $$;


-- ============================================================
-- FINAL SANITY CHECK v4
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='app_accounts'
      and column_name='user_id'
  ) then
    raise exception 'SmartPOS install incomplete: public.app_accounts.user_id is missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='profiles'
      and column_name='user_id'
  ) then
    raise exception 'SmartPOS install incomplete: public.profiles.user_id is missing';
  end if;
end $$;


-- ============================================================
-- FINAL SANITY CHECK: critical schema
-- ============================================================
do $$
begin
  if to_regclass('public.bills') is null then raise exception 'SmartPOS install incomplete: public.bills is missing'; end if;
  if to_regclass('public.bill_items') is null then raise exception 'SmartPOS install incomplete: public.bill_items is missing'; end if;
  if to_regclass('public.audit_log') is null then raise exception 'SmartPOS install incomplete: public.audit_log is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='audit_log' and column_name='owner_id') then raise exception 'SmartPOS install incomplete: public.audit_log.owner_id is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='audit_log' and column_name='store_id') then raise exception 'SmartPOS install incomplete: public.audit_log.store_id is missing'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='audit_log' and column_name='created_by') then raise exception 'SmartPOS install incomplete: public.audit_log.created_by is missing'; end if;
end $$;

-- ============================================================
-- FINAL SANITY CHECK v5
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='audit_log'
      and column_name='created_by'
  ) then
    raise exception 'SmartPOS install incomplete: public.audit_log.created_by is missing';
  end if;
end $$;


-- ============================================================
-- FINAL SANITY CHECK v6
-- ============================================================
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='error_logs'
      and column_name='created_by'
  ) then
    raise exception 'SmartPOS install incomplete: public.error_logs.created_by is missing';
  end if;
end $$;
