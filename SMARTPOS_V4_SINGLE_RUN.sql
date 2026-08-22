-- SMART POS V4 - SINGLE RUN
-- Canonical schema for Supabase/PostgreSQL
-- Fresh-project install. Does NOT use pos_state as source of truth.
-- Browser: Supabase Auth + RLS. No service_role key in client.

create extension if not exists pgcrypto;

-- ============================================================
-- 1) CORE: profiles / stores / members
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  tax_id text,
  phone text,
  email text,
  address text,
  vat_enabled boolean not null default true,
  vat_rate numeric(5,2) not null default 7.00,
  currency text not null default 'THB',
  timezone text not null default 'Asia/Bangkok',
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.store_members (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'cashier' check (role in ('owner','manager','cashier','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index if not exists idx_store_members_user on public.store_members(user_id, active);

-- ============================================================
-- 2) MASTER DATA
-- ============================================================
create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  parent_id uuid references public.categories(id) on delete set null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null,
  brand text,
  description text,
  group_name text,
  primary_image_path text,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_categories (
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  primary key(product_id, category_id)
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null,
  barcode text,
  unit text not null default 'ชิ้น',
  cost numeric(14,4) not null default 0 check(cost >= 0),
  selling_price numeric(14,4) not null default 0 check(selling_price >= 0),
  stock numeric(14,4) not null default 0 check(stock >= 0),
  min_stock numeric(14,4) not null default 0 check(min_stock >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, sku)
);
create unique index if not exists ux_product_variant_barcode_store on public.product_variants(store_id, barcode) where barcode is not null and barcode <> '';
create index if not exists idx_variants_product on public.product_variants(product_id);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  variant_id uuid references public.product_variants(id) on delete set null,
  storage_path text not null,
  original_filename text,
  is_primary boolean not null default false,
  version bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, storage_path)
);
create index if not exists idx_product_images_product on public.product_images(product_id, is_primary desc, created_at desc);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text,
  name text not null,
  phone text,
  email text,
  tax_id text,
  address text,
  credit_limit numeric(14,2) not null default 0,
  credit_days integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_customers_code_store on public.customers(store_id, code) where code is not null and code <> '';

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  code text,
  name text not null,
  phone text,
  email text,
  tax_id text,
  address text,
  credit_terms integer not null default 0,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ux_suppliers_code_store on public.suppliers(store_id, code) where code is not null and code <> '';

-- ============================================================
-- 3) INVENTORY / COST
-- ============================================================
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  movement_type text not null check (movement_type in ('opening','purchase','sale','sale_void','refund','adjustment','transfer_in','transfer_out')),
  qty numeric(14,4) not null check(qty <> 0),
  unit_cost numeric(14,4) not null default 0,
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_stock_movements_variant_time on public.stock_movements(store_id, variant_id, created_at desc);

create table if not exists public.cost_history (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  old_cost numeric(14,4) not null default 0,
  new_cost numeric(14,4) not null default 0,
  qty_received numeric(14,4),
  reference_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 4) PURCHASE / RECEIVING
-- ============================================================
create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  order_no text not null,
  status text not null default 'draft' check(status in ('draft','ordered','partial','received','cancelled')),
  ordered_at timestamptz,
  expected_at timestamptz,
  supplier_invoice_no text,
  notes text,
  total numeric(14,2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, order_no)
);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  ordered_qty numeric(14,4) not null check(ordered_qty > 0),
  received_qty numeric(14,4) not null default 0 check(received_qty >= 0),
  unit_cost numeric(14,4) not null default 0 check(unit_cost >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.receiving_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  receiving_no text not null,
  supplier_delivery_no text,
  supplier_invoice_no text,
  status text not null default 'posted' check(status in ('draft','posted','void')),
  received_at timestamptz not null default now(),
  total numeric(14,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(store_id, receiving_no)
);

create table if not exists public.receiving_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  receiving_id uuid not null references public.receiving_documents(id) on delete cascade,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  received_qty numeric(14,4) not null check(received_qty > 0),
  unit_cost numeric(14,4) not null default 0 check(unit_cost >= 0),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 5) SALES / PAYMENTS / REFUNDS
-- ============================================================
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  invoice_no text not null,
  customer_id uuid references public.customers(id) on delete set null,
  cashier_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'completed' check(status in ('draft','completed','void','refunded','partial_refund')),
  subtotal numeric(14,2) not null default 0,
  discount numeric(14,2) not null default 0,
  taxable_amount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  paid_total numeric(14,2) not null default 0,
  change_amount numeric(14,2) not null default 0,
  payment_status text not null default 'paid' check(payment_status in ('unpaid','partial','paid','credit')),
  note text,
  idempotency_key text,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(store_id, invoice_no)
);
create unique index if not exists ux_sales_idempotency on public.sales(store_id, idempotency_key) where idempotency_key is not null;
create index if not exists idx_sales_store_date on public.sales(store_id, sold_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  qty numeric(14,4) not null check(qty > 0),
  unit_price numeric(14,4) not null default 0,
  discount numeric(14,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  vat_amount numeric(14,2) not null default 0,
  unit_cost_at_sale numeric(14,4) not null default 0,
  profit_at_sale numeric(14,2) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  method text not null check(method in ('cash','transfer','promptpay','card','credit','other')),
  amount numeric(14,2) not null check(amount >= 0),
  reference_no text,
  paid_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  refund_no text not null,
  status text not null default 'completed' check(status in ('completed','void')),
  total numeric(14,2) not null default 0,
  reason text,
  refunded_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(store_id, refund_no)
);

create table if not exists public.refund_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  refund_id uuid not null references public.refunds(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  variant_id uuid not null references public.product_variants(id) on delete restrict,
  qty numeric(14,4) not null check(qty > 0),
  unit_price numeric(14,4) not null default 0,
  unit_cost_at_sale numeric(14,4) not null default 0,
  line_total numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 6) CASH / SHIFT / AUDIT
-- ============================================================
create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  cashier_id uuid not null references auth.users(id) on delete restrict,
  opening_cash numeric(14,2) not null default 0,
  closing_cash numeric(14,2),
  expected_cash numeric(14,2),
  difference numeric(14,2),
  status text not null default 'open' check(status in ('open','closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_store_time on public.audit_logs(store_id, created_at desc);

create table if not exists public.error_logs (
  id bigint generated always as identity primary key,
  store_id uuid references public.stores(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  message text not null,
  stack text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 7) UPDATED_AT TRIGGER
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','stores','store_members','categories','products','product_variants','product_images','customers','suppliers','purchase_orders','receiving_documents','sales'] LOOP
    EXECUTE format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
    EXECUTE format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  END LOOP;
END $$;

-- ============================================================
-- 8) AUTH -> PROFILE
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, display_name, phone)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.phone)
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ============================================================
-- 9) STORE HELPERS
-- ============================================================
create or replace function public.current_store_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select sm.store_id
  from public.store_members sm
  where sm.user_id = auth.uid() and sm.active = true
  order by case sm.role when 'owner' then 1 when 'manager' then 2 else 3 end, sm.created_at
  limit 1
$$;

create or replace function public.current_store_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select sm.role
  from public.store_members sm
  where sm.user_id = auth.uid() and sm.active = true
  order by case sm.role when 'owner' then 1 when 'manager' then 2 else 3 end, sm.created_at
  limit 1
$$;

create or replace function public.is_store_role(p_roles text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.current_store_role() = any(p_roles), false)
$$;

create or replace function public.create_store(p_name text, p_code text default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_store uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.stores(name, code, created_by) values(trim(p_name), nullif(trim(p_code),''), auth.uid()) returning id into v_store;
  insert into public.store_members(store_id,user_id,role) values(v_store,auth.uid(),'owner');
  return v_store;
end $$;

create or replace function public.add_store_member(p_user_id uuid, p_role text default 'cashier')
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_store uuid;
begin
  v_store := public.current_store_id();
  if v_store is null or public.current_store_role() not in ('owner','manager') then raise exception 'Not authorized'; end if;
  if p_role not in ('manager','cashier','staff') then raise exception 'Invalid role'; end if;
  insert into public.store_members(store_id,user_id,role,active) values(v_store,p_user_id,p_role,true)
  on conflict(store_id,user_id) do update set role=excluded.role, active=true, updated_at=now();
end $$;

create or replace function public.remove_store_member(p_user_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if public.current_store_role() <> 'owner' then raise exception 'Only owner can remove members'; end if;
  update public.store_members set active=false, updated_at=now()
  where store_id=public.current_store_id() and user_id=p_user_id and role <> 'owner';
end $$;

-- ============================================================
-- 10) ATOMIC SALE
-- ============================================================
create or replace function public.process_sale_atomic(
  p_invoice_no text,
  p_customer_id uuid,
  p_items jsonb,
  p_subtotal numeric,
  p_discount numeric,
  p_taxable numeric,
  p_vat_rate numeric,
  p_vat_amount numeric,
  p_grand_total numeric,
  p_paid_total numeric,
  p_change_amount numeric,
  p_payment_method text default 'cash',
  p_idempotency_key text default null
)
returns uuid
language plpgsql security definer
set search_path=public
as $$
declare
  v_store uuid := public.current_store_id();
  v_sale uuid;
  x jsonb;
  v_variant public.product_variants%rowtype;
  v_qty numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_line_total numeric;
  v_vat numeric;
  v_cost numeric;
  v_name text;
  v_sku text;
  v_profit numeric;
begin
  if v_store is null then raise exception 'Store session not found'; end if;
  if not public.is_store_role(array['owner','manager','cashier']) then raise exception 'Not authorized'; end if;

  if p_idempotency_key is not null then
    select id into v_sale from public.sales where store_id=v_store and idempotency_key=p_idempotency_key;
    if v_sale is not null then return v_sale; end if;
  end if;

  insert into public.sales(store_id,invoice_no,customer_id,cashier_id,subtotal,discount,taxable_amount,vat_rate,vat_amount,grand_total,paid_total,change_amount,payment_status,idempotency_key)
  values(v_store,p_invoice_no,p_customer_id,auth.uid(),p_subtotal,p_discount,p_taxable,p_vat_rate,p_vat_amount,p_grand_total,p_paid_total,p_change_amount,
    case when p_paid_total >= p_grand_total then 'paid' when p_paid_total > 0 then 'partial' else 'unpaid' end,p_idempotency_key)
  returning id into v_sale;

  for x in select * from jsonb_array_elements(p_items) loop
    select * into v_variant from public.product_variants where id=(x->>'variant_id')::uuid and store_id=v_store and active=true for update;
    if not found then raise exception 'Product variant not found: %', x->>'variant_id'; end if;
    v_qty := (x->>'qty')::numeric;
    if v_qty <= 0 then raise exception 'Invalid quantity'; end if;
    if v_variant.stock < v_qty then raise exception 'Insufficient stock for SKU %', v_variant.sku; end if;
    v_unit_price := coalesce((x->>'unit_price')::numeric,v_variant.selling_price);
    v_discount := coalesce((x->>'discount')::numeric,0);
    v_line_total := round((v_qty*v_unit_price)-v_discount,2);
    v_vat := coalesce((x->>'vat_amount')::numeric,0);
    select p.name into v_name from public.products p where p.id=v_variant.product_id;
    v_sku := v_variant.sku;
    v_cost := v_variant.cost;
    v_profit := round(v_line_total-(v_qty*v_cost),2);

    insert into public.sale_items(store_id,sale_id,variant_id,product_name_snapshot,sku_snapshot,qty,unit_price,discount,vat_rate,vat_amount,unit_cost_at_sale,profit_at_sale,line_total)
    values(v_store,v_sale,v_variant.id,v_name,v_sku,v_qty,v_unit_price,v_discount,p_vat_rate,v_vat,v_cost,v_profit,v_line_total);

    update public.product_variants set stock=stock-v_qty, updated_at=now() where id=v_variant.id;
    insert into public.stock_movements(store_id,variant_id,movement_type,qty,unit_cost,reference_type,reference_id,created_by)
    values(v_store,v_variant.id,'sale',-v_qty,v_cost,'sale',v_sale,auth.uid());
  end loop;

  insert into public.payments(store_id,sale_id,customer_id,method,amount,created_by)
  values(v_store,v_sale,p_customer_id,p_payment_method,p_paid_total,auth.uid());

  insert into public.audit_logs(store_id,actor_id,action,entity_type,entity_id,metadata)
  values(v_store,auth.uid(),'SALE_COMPLETED','sale',v_sale::text,jsonb_build_object('invoice_no',p_invoice_no,'total',p_grand_total));

  return v_sale;
end $$;

-- ============================================================
-- 11) RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles','stores','store_members','categories','products','product_categories','product_variants','product_images','customers','suppliers','stock_movements','cost_history','purchase_orders','purchase_order_items','receiving_documents','receiving_items','sales','sale_items','payments','refunds','refund_items','cash_sessions','audit_logs','error_logs'] LOOP
    EXECUTE format('alter table public.%I enable row level security',t);
  END LOOP;
END $$;

-- Drop only policies owned by this canonical schema names; avoids OR-combining with legacy policies.
DO $$
DECLARE r record;
BEGIN
  FOR r IN select schemaname,tablename,policyname from pg_policies where schemaname='public' LOOP
    execute format('drop policy if exists %I on public.%I',r.policyname,r.tablename);
  END LOOP;
END $$;

create policy profiles_self on public.profiles for all to authenticated
using(id=auth.uid()) with check(id=auth.uid());

create policy stores_member_select on public.stores for select to authenticated
using(id=public.current_store_id());
create policy stores_owner_update on public.stores for update to authenticated
using(id=public.current_store_id() and public.current_store_role()='owner')
with check(id=public.current_store_id());

create policy members_select on public.store_members for select to authenticated
using(store_id=public.current_store_id());
create policy members_manage on public.store_members for all to authenticated
using(store_id=public.current_store_id() and public.current_store_role() in ('owner','manager'))
with check(store_id=public.current_store_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','products','product_categories','product_variants','product_images','customers','suppliers','stock_movements','cost_history','purchase_orders','purchase_order_items','receiving_documents','receiving_items','sales','sale_items','payments','refunds','refund_items','cash_sessions'] LOOP
    EXECUTE format('create policy %I_store_select on public.%I for select to authenticated using(store_id=public.current_store_id())',t,t);
    EXECUTE format('create policy %I_store_insert on public.%I for insert to authenticated with check(store_id=public.current_store_id())',t,t);
    EXECUTE format('create policy %I_store_update on public.%I for update to authenticated using(store_id=public.current_store_id()) with check(store_id=public.current_store_id())',t,t);
    EXECUTE format('create policy %I_store_delete on public.%I for delete to authenticated using(store_id=public.current_store_id())',t,t);
  END LOOP;
END $$;

create policy audit_select on public.audit_logs for select to authenticated using(store_id=public.current_store_id());
create policy audit_insert on public.audit_logs for insert to authenticated with check(store_id=public.current_store_id() and (actor_id is null or actor_id=auth.uid()));
create policy error_select on public.error_logs for select to authenticated using(store_id=public.current_store_id());
create policy error_insert on public.error_logs for insert to authenticated with check(store_id=public.current_store_id() and (user_id is null or user_id=auth.uid()));

-- ============================================================
-- 12) STORAGE
-- ============================================================
insert into storage.buckets(id,name,public) values('product-images','product-images',false)
on conflict(id) do update set public=false;

create policy product_images_select on storage.objects for select to authenticated
using(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);
create policy product_images_insert on storage.objects for insert to authenticated
with check(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);
create policy product_images_update on storage.objects for update to authenticated
using(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text)
with check(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);
create policy product_images_delete on storage.objects for delete to authenticated
using(bucket_id='product-images' and (storage.foldername(name))[1]=public.current_store_id()::text);

-- ============================================================
-- 13) GRANTS
-- ============================================================
grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.current_store_id(), public.current_store_role(), public.is_store_role(text[]), public.create_store(text,text), public.add_store_member(uuid,text), public.remove_store_member(uuid), public.process_sale_atomic(text,uuid,jsonb,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text) to authenticated;

-- ============================================================
-- 14) COMMENTS / IMPORTANT RULES
-- ============================================================
comment on table public.stores is 'One store/tenant. Data isolation is by store_id + RLS.';
comment on table public.store_members is 'Auth users assigned to a store. Owner/manager/cashier/staff roles.';
comment on table public.product_variants is 'Sellable SKU/barcode/unit and current stock/cost/price.';
comment on table public.stock_movements is 'Immutable inventory ledger. Stock changes must create a movement.';
comment on table public.sale_items is 'Historical sales snapshot. unit_cost_at_sale never changes when current cost changes.';
comment on table public.product_images is 'Metadata for files in Supabase Storage. Storage path is not a permanent signed URL.';
comment on table public.audit_logs is 'Who did what, to which entity, and when.';

-- NOTE: legacy public.pos_state is intentionally NOT created here.
-- Existing legacy projects should be migrated after backup; do not run this fresh schema blindly over live data.
