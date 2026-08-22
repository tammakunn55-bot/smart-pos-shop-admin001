-- ============================================================
-- Smart POS — Fresh Supabase / GitHub Installation
-- Version 2.0
-- Tenant model: one Smart POS account = one Supabase Auth user.
-- Every business row is isolated by owner_id + RLS.
-- No Google Apps Script / Google Sheets integration.
-- NEVER put service_role/secret keys or real store data in GitHub.
-- ============================================================

begin;

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

create table if not exists public.audit_log (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  ts timestamptz not null default now(),
  action text not null,
  actor text,
  details jsonb not null default '{}'::jsonb,
  device_id text,
  created_by uuid references auth.users(id) on delete set null
);

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

-- All business tables use owner_id.
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

commit;

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
