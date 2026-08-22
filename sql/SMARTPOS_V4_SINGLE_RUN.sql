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


-- ============================================================
-- SMART POS V4 CANONICAL STORE / INVENTORY / SALES MODEL
-- Compatibility note: pos_state remains ONLY as a browser-cache
-- compatibility table for the existing full frontend. It is not
-- the authoritative inventory/sales ledger in V4.
-- ============================================================

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  store_code text not null unique,
  name text not null,
  tax_id text,
  phone text,
  address text,
  vat_rate numeric(5,2) not null default 7.00,
  currency text not null default 'THB',
  timezone text not null default 'Asia/Bangkok',
  status text not null default 'active' check (status in ('active','suspended','archived')),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'cashier' check (role in ('owner','manager','cashier','staff')),
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, user_id)
);

create index if not exists idx_store_members_user on public.store_members(user_id, active);
create index if not exists idx_store_members_store on public.store_members(store_id, active);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text not null,
  variant_id text,
  storage_path text not null,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  checksum text,
  is_primary boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(store_id, storage_path)
);

create index if not exists idx_product_images_product on public.product_images(store_id, product_id, is_primary);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text not null,
  variant_id text,
  movement_type text not null check (movement_type in ('OPENING','PURCHASE','SALE','REFUND','ADJUSTMENT','DAMAGE','TRANSFER_IN','TRANSFER_OUT','VOID')),
  qty numeric(14,4) not null,
  unit_cost numeric(14,4) not null default 0,
  reference_type text,
  reference_id text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_store_product on public.stock_movements(store_id, product_id, created_at desc);

create table if not exists public.cost_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text not null,
  variant_id text,
  unit_cost numeric(14,4) not null,
  source_type text,
  source_id text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id text,
  supplier_invoice_no text,
  total numeric(14,2) not null default 0,
  received_at timestamptz not null default now(),
  status text not null default 'POSTED' check (status in ('DRAFT','POSTED','VOID')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text not null,
  variant_id text,
  qty numeric(14,4) not null check (qty > 0),
  unit_cost numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  bill_no text not null,
  customer_id text,
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 7,
  vat_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  payment_status text not null default 'PAID' check (payment_status in ('PAID','PARTIAL','CREDIT','VOID','REFUNDED')),
  sold_at timestamptz not null default now(),
  cashier_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(store_id, bill_no)
);

create index if not exists idx_sales_store_date on public.sales(store_id, sold_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id text not null,
  variant_id text,
  product_name_snapshot text not null,
  sku_snapshot text,
  qty numeric(14,4) not null check (qty > 0),
  unit_price numeric(14,4) not null default 0,
  discount numeric(14,2) not null default 0,
  unit_cost_at_sale numeric(14,4) not null default 0,
  vat_rate_at_sale numeric(5,2) not null default 7,
  vat_amount numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0
);

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  method text not null check (method in ('CASH','TRANSFER','QR','CARD','CREDIT','OTHER')),
  amount numeric(14,2) not null check (amount >= 0),
  paid_at timestamptz not null default now(),
  reference_no text
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  reason text,
  total numeric(14,2) not null default 0,
  refunded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  refund_id uuid not null references public.refunds(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  store_id uuid not null references public.stores(id) on delete cascade,
  qty numeric(14,4) not null check (qty > 0),
  amount numeric(14,2) not null default 0
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cashier_user_id uuid not null references auth.users(id) on delete restrict,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(14,2) not null default 0,
  closing_cash numeric(14,2),
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED'))
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references public.stores(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.current_store_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select store_id from public.store_members
  where user_id = auth.uid() and active = true;
$$;

create or replace function public.current_store_role(p_store_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.store_members
  where store_id = p_store_id and user_id = auth.uid() and active = true
  limit 1;
$$;

grant execute on function public.current_store_ids() to authenticated;
grant execute on function public.current_store_role(uuid) to authenticated;

create or replace function public.create_store_for_current_user(
  p_store_name text,
  p_store_code text default null,
  p_tax_id text default null,
  p_phone text default null,
  p_address text default null
)
returns public.stores
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores;
  v_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_store_name,''))) < 2 then raise exception 'Store name is required'; end if;
  v_code := upper(coalesce(nullif(trim(p_store_code),''), 'STORE-' || substr(replace(auth.uid()::text,'-',''),1,8)));
  insert into public.stores(owner_user_id, store_code, name, tax_id, phone, address)
  values(auth.uid(), v_code, trim(p_store_name), nullif(trim(p_tax_id),''), nullif(trim(p_phone),''), nullif(trim(p_address),''))
  returning * into v_store;
  insert into public.store_members(store_id,user_id,role,display_name)
  values(v_store.id,auth.uid(),'owner',(select display_name from public.profiles where user_id=auth.uid()))
  on conflict (store_id,user_id) do update set role='owner',active=true;
  return v_store;
end;
$$;

grant execute on function public.create_store_for_current_user(text,text,text,text,text) to authenticated;

create or replace function public.add_store_member(
  p_store_id uuid,
  p_user_id uuid,
  p_role text,
  p_display_name text default null
)
returns public.store_members
language plpgsql
security definer
set search_path = public
as $$
declare v public.store_members; v_role text;
begin
  if public.current_store_role(p_store_id) not in ('owner','manager') then raise exception 'Not authorized'; end if;
  v_role := lower(trim(p_role));
  if v_role not in ('manager','cashier','staff') then raise exception 'Invalid role'; end if;
  insert into public.store_members(store_id,user_id,role,display_name)
  values(p_store_id,p_user_id,v_role,p_display_name)
  on conflict(store_id,user_id) do update set role=excluded.role, display_name=excluded.display_name, active=true
  returning * into v;
  return v;
end;
$$;

grant execute on function public.add_store_member(uuid,uuid,text,text) to authenticated;

-- Compatibility: create_pos_account now also creates the V4 store/membership.
create or replace function public.create_pos_account(p_store_name text, p_account_code text default null)
returns public.app_accounts
language plpgsql
security definer
set search_path = public
as $$
declare v public.app_accounts; v_store public.stores; v_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if length(trim(coalesce(p_store_name,''))) < 2 then raise exception 'Store name is required'; end if;
  v_code := upper(coalesce(nullif(trim(p_account_code),''), 'STORE-' || substr(replace(auth.uid()::text,'-',''),1,8)));
  insert into public.app_accounts(user_id,account_code,store_name)
  values(auth.uid(),v_code,trim(p_store_name))
  on conflict(user_id) do update set store_name=excluded.store_name, account_code=coalesce(excluded.account_code,public.app_accounts.account_code), updated_at=now()
  returning * into v;
  select * into v_store from public.stores where owner_user_id=auth.uid() and status='active' order by created_at asc limit 1;
  if v_store.id is null then
    v_store := public.create_store_for_current_user(trim(p_store_name), v_code);
  end if;
  return v;
end;
$$;

grant execute on function public.create_pos_account(text,text) to authenticated;

-- Atomic canonical sale transaction for new V4 callers.
create or replace function public.post_sale_atomic(p_sale jsonb, p_items jsonb, p_payments jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store uuid := (p_sale->>'store_id')::uuid;
  v_sale uuid;
  x jsonb;
  v_stock numeric;
  v_qty numeric;
  v_variant text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if public.current_store_role(v_store) is null then raise exception 'Not a store member'; end if;
  insert into public.sales(store_id,bill_no,customer_id,subtotal,discount,taxable_amount,vat_rate,vat_amount,grand_total,payment_status,cashier_user_id)
  values(v_store,p_sale->>'bill_no',nullif(p_sale->>'customer_id',''),coalesce((p_sale->>'subtotal')::numeric,0),coalesce((p_sale->>'discount')::numeric,0),coalesce((p_sale->>'taxable_amount')::numeric,0),coalesce((p_sale->>'vat_rate')::numeric,7),coalesce((p_sale->>'vat_amount')::numeric,0),coalesce((p_sale->>'grand_total')::numeric,0),coalesce(p_sale->>'payment_status','PAID'),auth.uid())
  returning id into v_sale;
  for x in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_qty := (x->>'qty')::numeric;
    v_variant := nullif(x->>'variant_id','');
    if v_qty <= 0 then raise exception 'Invalid sale quantity'; end if;
    if v_variant is not null then
      select stock into v_stock from public.product_variants where id=v_variant and owner_id=auth.uid() for update;
      if v_stock is null or v_stock < v_qty then raise exception 'Insufficient stock for %', x->>'product_id'; end if;
      update public.product_variants set stock=stock-v_qty, updated_at=now() where id=v_variant;
    end if;
    insert into public.sale_items(store_id,sale_id,product_id,variant_id,product_name_snapshot,sku_snapshot,qty,unit_price,discount,unit_cost_at_sale,vat_rate_at_sale,vat_amount,line_total)
    values(v_store,v_sale,x->>'product_id',v_variant,coalesce(x->>'product_name',x->>'name',''),x->>'sku',v_qty,coalesce((x->>'unit_price')::numeric,0),coalesce((x->>'discount')::numeric,0),coalesce((x->>'unit_cost')::numeric,0),coalesce((x->>'vat_rate')::numeric,7),coalesce((x->>'vat_amount')::numeric,0),coalesce((x->>'line_total')::numeric,0));
    insert into public.stock_movements(store_id,product_id,variant_id,movement_type,qty,unit_cost,reference_type,reference_id,created_by)
    values(v_store,x->>'product_id',v_variant,'SALE',-v_qty,coalesce((x->>'unit_cost')::numeric,0),'SALE',v_sale::text,auth.uid());
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    insert into public.sale_payments(sale_id,store_id,method,amount,reference_no)
    values(v_sale,v_store,coalesce(x->>'method','CASH'),coalesce((x->>'amount')::numeric,0),x->>'reference_no');
  end loop;
  insert into public.audit_logs(store_id,actor_user_id,action,entity_type,entity_id,after_data)
  values(v_store,auth.uid(),'SALE','sales',v_sale::text,p_sale);
  return v_sale;
end;
$$;

grant execute on function public.post_sale_atomic(jsonb,jsonb,jsonb) to authenticated;

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
    'app_accounts','profiles','stores','store_members','pos_state','categories','products',
    'product_variants','customers','suppliers','bills','sales','cash_sessions',
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
    'app_accounts','profiles','stores','store_members','pos_state','categories','products',
    'product_categories','product_variants','product_fractions','product_images','stock_movements','cost_history',
    'customers','suppliers','bills','bill_items','receipts',
    'customer_payment_allocations','purchase_orders',
    'purchase_order_items','receiving_documents','supplier_payments','purchase_receipts','purchase_receipt_items','sales','sale_items','sale_payments','refunds','refund_items','cash_sessions','audit_logs',
    'cash_ledger','shifts','documents','audit_log','audit_logs','error_logs'
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



-- V4 store-membership RLS.
create policy stores_member_select on public.stores for select to authenticated
using (id in (select public.current_store_ids()));
create policy stores_owner_insert on public.stores for insert to authenticated
with check (owner_user_id = (select auth.uid()));
create policy stores_owner_update on public.stores for update to authenticated
using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));

create policy store_members_select on public.store_members for select to authenticated
using (store_id in (select public.current_store_ids()));
create policy store_members_manage on public.store_members for all to authenticated
using (public.current_store_role(store_id) in ('owner','manager'))
with check (public.current_store_role(store_id) in ('owner','manager'));

create policy product_images_member on public.product_images for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy stock_movements_member on public.stock_movements for select to authenticated
using (store_id in (select public.current_store_ids()));
create policy stock_movements_write on public.stock_movements for insert to authenticated
with check (store_id in (select public.current_store_ids()));
create policy cost_history_member on public.cost_history for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy purchase_receipts_member on public.purchase_receipts for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy purchase_receipt_items_member on public.purchase_receipt_items for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy sales_member on public.sales for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy sale_items_member on public.sale_items for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy sale_payments_member on public.sale_payments for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy refunds_member on public.refunds for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy refund_items_member on public.refund_items for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy cash_sessions_member on public.cash_sessions for all to authenticated
using (store_id in (select public.current_store_ids()))
with check (store_id in (select public.current_store_ids()));
create policy audit_logs_member on public.audit_logs for select to authenticated
using (store_id in (select public.current_store_ids()));
create policy audit_logs_insert on public.audit_logs for insert to authenticated
with check (store_id in (select public.current_store_ids()) and actor_user_id = (select auth.uid()));

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

-- Explicit grants for V4 tables.
grant select, insert, update, delete on public.stores, public.store_members, public.product_images, public.stock_movements, public.cost_history, public.purchase_receipts, public.purchase_receipt_items, public.sales, public.sale_items, public.sale_payments, public.refunds, public.refund_items, public.cash_sessions, public.audit_logs to authenticated;

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
