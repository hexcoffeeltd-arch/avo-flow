-- AVO FLOW install — generated 2026-09-25. Run once on an empty database (safe to re-run to update functions).
begin;

-- ==== sql/01_tables.sql ====
-- =====================================================================
-- AVO FLOW — ระบบจัดการสต็อกอะโวคาโด
-- 01_tables.sql : โครงสร้างตาราง (schema "avo")
-- ตารางทั้งหมดอยู่ใน schema avo ซึ่ง "ไม่" เปิดให้หน้าเว็บเข้าถึงตรง ๆ
-- หน้าเว็บเรียกได้เฉพาะฟังก์ชัน public.api_* (ดู 02_functions.sql)
-- =====================================================================

create schema if not exists avo;

-- ---------- ข้อมูลหลัก ----------
create table if not exists avo.sites (
  id          bigint generated always as identity primary key,
  code        text not null unique,
  name        text not null,
  kind        text not null check (kind in ('warehouse','branch')),
  active      boolean not null default true,
  sort        int not null default 0,
  updated_by  bigint,
  updated_at  timestamptz not null default now()
);

create table if not exists avo.users (
  id           bigint generated always as identity primary key,
  auth_sub     text not null unique,           -- รหัสผู้ใช้จากระบบล็อกอิน (JWT sub)
  email        text,
  display_name text,
  role         text not null default 'pending'
               check (role in ('pending','admin','executive','warehouse','branch','sales')),
  site_id      bigint references avo.sites(id),
  is_manager   boolean not null default false,  -- ผู้จัดการ: อนุมัติตีออก/ตัดทิ้ง/ปรับยอด
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_by   bigint,
  updated_at   timestamptz not null default now()
);

create table if not exists avo.varieties (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  active boolean not null default true,
  sort int not null default 0,
  updated_by bigint, updated_at timestamptz not null default now()
);

create table if not exists avo.sizes (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  min_g int, max_g int,
  active boolean not null default true,
  sort int not null default 0,
  updated_by bigint, updated_at timestamptz not null default now()
);

-- ราคาขายมาตรฐาน (customer_id null) และราคาเฉพาะลูกค้า
create table if not exists avo.prices (
  id bigint generated always as identity primary key,
  customer_id bigint,
  variety_id bigint not null references avo.varieties(id),
  size_id    bigint not null references avo.sizes(id),
  product    text not null default 'fresh' check (product in ('fresh','frozen')),
  sell_price numeric(12,2) not null check (sell_price >= 0),
  updated_by bigint, updated_at timestamptz not null default now()
);
create unique index if not exists prices_uq on avo.prices (coalesce(customer_id,0), variety_id, size_id, product);

create table if not exists avo.settings (
  key text primary key,
  value jsonb not null,
  updated_by bigint, updated_at timestamptz not null default now()
);

create table if not exists avo.suppliers (
  id bigint generated always as identity primary key,
  code text unique,
  name text not null,
  contact text, phone text, province text,
  varieties text,                 -- สายพันธุ์ที่สวนปลูก (ข้อความ)
  buy_price numeric(12,2),        -- ราคาซื้ออ้างอิง/กก.
  note text,
  active boolean not null default true,
  updated_by bigint, updated_at timestamptz not null default now()
);

create table if not exists avo.customers (
  id bigint generated always as identity primary key,
  code text unique,
  name text not null,
  ctype text not null default 'company' check (ctype in ('company','person')),
  channel text not null default 'wholesale'
          check (channel in ('wholesale','retail','dc','online','tiktok','other')),
  address text, phone text, tax_id text, note text,
  active boolean not null default true,
  updated_by bigint, updated_at timestamptz not null default now()
);
alter table avo.prices drop constraint if exists prices_customer_fk;
alter table avo.prices add constraint prices_customer_fk foreign key (customer_id) references avo.customers(id);

-- ---------- เลขเอกสาร ----------
create table if not exists avo.doc_counters (
  prefix text not null,
  period text not null,
  last   int  not null default 0,
  primary key (prefix, period)
);

-- แนบรูป/หลักฐาน (เก็บเป็นรูปย่อ data URL)
create table if not exists avo.attachments (
  id bigint generated always as identity primary key,
  token uuid not null default gen_random_uuid() unique,   -- อ้างอิงแบบเดาไม่ได้
  mime text not null default 'image/jpeg',
  data text not null,
  created_by bigint,
  created_at timestamptz not null default now()
);

alter table avo.attachments add column if not exists token uuid not null default gen_random_uuid();
create unique index if not exists attachments_token_uq on avo.attachments(token);

-- ---------- รับเข้า / Lot ----------
create table if not exists avo.receipts (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  supplier_id bigint not null references avo.suppliers(id),
  site_id bigint not null references avo.sites(id),
  received_at timestamptz not null default now(),
  status text not null default 'draft'
         check (status in ('draft','pending_check','confirmed','cancelled','reversed')),
  note text,
  evidence text,
  created_by bigint references avo.users(id),
  created_at timestamptz not null default now(),
  checked_by bigint references avo.users(id),
  checked_at timestamptz,
  cancel_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists avo.lots (
  id bigint generated always as identity primary key,
  code text not null unique,
  product text not null default 'fresh' check (product in ('fresh','frozen')),
  variety_id bigint references avo.varieties(id),
  size_id bigint references avo.sizes(id),
  supplier_id bigint references avo.suppliers(id),
  receipt_id bigint references avo.receipts(id),
  parent_lot_id bigint references avo.lots(id),
  received_at timestamptz not null default now(),
  unit_cost numeric(14,4) not null default 0,     -- ต้นทุน/กก.
  status text not null default 'draft' check (status in ('draft','active','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists avo.receipt_lines (
  id bigint generated always as identity primary key,
  receipt_id bigint not null references avo.receipts(id) on delete cascade,
  line_no int not null,
  lot_id bigint not null references avo.lots(id),
  variety_id bigint not null references avo.varieties(id),
  size_id bigint not null references avo.sizes(id),
  ripeness text not null check (ripeness in ('raw','breaking','ripe','overripe')),
  baskets int not null default 0 check (baskets >= 0),
  gross_kg numeric(12,2) not null check (gross_kg > 0),
  tare_kg  numeric(12,2) not null default 0 check (tare_kg >= 0),
  net_kg   numeric(12,2) generated always as (gross_kg - tare_kg) stored,
  rejected_kg numeric(12,2) not null default 0 check (rejected_kg >= 0),
  accepted_kg numeric(12,2),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  note text,
  check (gross_kg > tare_kg)
);

-- ---------- ยอดคงเหลือ (สรุปจากสมุดเคลื่อนไหว) ----------
-- zone: main=คลัง, front=หน้าร้าน, back=หลังร้าน, frozen=แช่แข็ง, transit=ระหว่างทาง (เก็บที่สถานที่ต้นทาง)
create table if not exists avo.balances (
  site_id bigint not null references avo.sites(id),
  zone text not null check (zone in ('main','front','back','frozen','transit')),
  lot_id bigint not null references avo.lots(id),
  ripeness text not null check (ripeness in ('raw','breaking','ripe','overripe','na')),
  kg numeric(12,2) not null default 0 check (kg >= 0),
  baskets int not null default 0 check (baskets >= 0),
  bags int not null default 0 check (bags >= 0),
  updated_at timestamptz not null default now(),
  primary key (site_id, zone, lot_id, ripeness)
);

-- ---------- สมุดเคลื่อนไหวสต็อก (append-only) ----------
create table if not exists avo.movements (
  id bigint generated always as identity primary key,
  mtype text not null,
  doc_type text not null,
  doc_id bigint,
  doc_no text,
  lot_id bigint not null references avo.lots(id),
  site_id bigint not null references avo.sites(id),
  zone text not null,
  ripeness text not null,
  d_kg numeric(12,2) not null default 0,
  d_baskets int not null default 0,
  d_bags int not null default 0,
  before_kg numeric(12,2) not null, after_kg numeric(12,2) not null,
  before_baskets int not null, after_baskets int not null,
  before_bags int not null, after_bags int not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  actor_id bigint references avo.users(id),
  approver_id bigint references avo.users(id),
  counterparty text,
  reason text,
  evidence text
);
create index if not exists movements_lot_idx on avo.movements(lot_id, id);
create index if not exists movements_doc_idx on avo.movements(doc_type, doc_id);
create index if not exists movements_time_idx on avo.movements(occurred_at);

-- ---------- ตีออก / โอน ----------
create table if not exists avo.dispatches (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  kind text not null check (kind in ('transfer','sale')),
  from_site_id bigint not null references avo.sites(id),
  from_zone text not null default 'main' check (from_zone in ('main','front','back','frozen')),
  to_site_id bigint references avo.sites(id),
  to_zone text check (to_zone in ('main','front','back','frozen')),
  customer_id bigint references avo.customers(id),
  status text not null default 'draft'
         check (status in ('draft','shipped','received','partial','closed','cancelled')),
  carrier text, vehicle text, packer text, note text,
  created_by bigint references avo.users(id),
  created_at timestamptz not null default now(),
  shipped_by bigint references avo.users(id),
  shipped_at timestamptz,
  receiver_name text,
  received_by bigint references avo.users(id),
  received_at timestamptz,
  receive_note text,
  evidence text,
  check ((kind = 'transfer' and to_site_id is not null) or (kind = 'sale' and customer_id is not null))
);

create table if not exists avo.dispatch_lines (
  id bigint generated always as identity primary key,
  dispatch_id bigint not null references avo.dispatches(id) on delete cascade,
  line_no int not null,
  lot_id bigint not null references avo.lots(id),
  ripeness text not null,
  kg numeric(12,2) not null check (kg > 0),
  baskets int not null default 0 check (baskets >= 0),
  bags int not null default 0 check (bags >= 0),
  received_kg numeric(12,2),
  received_baskets int,
  received_bags int,
  billed_kg numeric(12,2) not null default 0 check (billed_kg >= 0),
  check (received_kg is null or (received_kg >= 0 and received_kg <= kg)),
  check (billed_kg <= coalesce(received_kg, 0))
);

-- งานตรวจสอบส่วนต่าง (รับไม่ครบ/น้ำหนักต่าง)
create table if not exists avo.cases (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  dispatch_id bigint not null references avo.dispatches(id),
  dispatch_line_id bigint not null references avo.dispatch_lines(id),
  lot_id bigint not null references avo.lots(id),
  ripeness text not null,
  kg numeric(12,2) not null,
  baskets int not null default 0,
  bags int not null default 0,
  status text not null default 'open' check (status in ('open','resolved')),
  outcome text check (outcome in ('loss','return','late_delivery')),
  note text,
  resolve_note text,
  evidence text,
  created_at timestamptz not null default now(),
  resolved_by bigint references avo.users(id),
  resolved_at timestamptz
);

-- ---------- งานสาขา ----------
create table if not exists avo.internal_transfers (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  site_id bigint not null references avo.sites(id),
  from_zone text not null, to_zone text not null,
  lot_id bigint not null references avo.lots(id),
  ripeness text not null,
  kg numeric(12,2) not null, baskets int not null default 0, bags int not null default 0,
  note text,
  created_by bigint references avo.users(id),
  created_at timestamptz not null default now()
);

create table if not exists avo.freezes (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  site_id bigint not null references avo.sites(id),
  from_zone text not null,
  source_lot_id bigint not null references avo.lots(id),
  ripeness text not null,
  input_kg numeric(12,2) not null check (input_kg > 0),
  input_baskets int not null default 0,
  output_kg numeric(12,2) not null check (output_kg > 0),
  bags int not null check (bags > 0),
  loss_kg numeric(12,2) generated always as (input_kg - output_kg) stored,
  output_lot_id bigint not null references avo.lots(id),
  note text,
  created_by bigint references avo.users(id),
  created_at timestamptz not null default now(),
  check (output_kg <= input_kg)
);

create table if not exists avo.adjustments (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  kind text not null check (kind in ('retail_sale','internal_use','waste','count_adjust')),
  site_id bigint not null references avo.sites(id),
  zone text not null,
  lot_id bigint not null references avo.lots(id),
  ripeness text not null,
  kg numeric(12,2) not null,           -- ติดลบ = ลดสต็อก (count_adjust เป็นได้ทั้ง + และ -)
  baskets int not null default 0,
  bags int not null default 0,
  amount numeric(12,2),                -- ยอดเงินขายหน้าร้าน (ถ้ามี)
  reason text,
  evidence text,
  status text not null default 'pending' check (status in ('pending','applied','rejected')),
  requested_by bigint references avo.users(id),
  requested_at timestamptz not null default now(),
  decided_by bigint references avo.users(id),
  decided_at timestamptz,
  decision_note text
);

create table if not exists avo.ripeness_checks (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  lot_id bigint not null references avo.lots(id),
  site_id bigint not null references avo.sites(id),
  zone text not null,
  from_ripeness text not null,
  to_ripeness text not null,
  kg numeric(12,2) not null, baskets int not null default 0,
  note text, evidence text,
  checked_by bigint references avo.users(id),
  checked_at timestamptz not null default now()
);

-- ---------- ขาย ----------
create table if not exists avo.quotes (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  customer_id bigint not null references avo.customers(id),
  doc_date date not null,
  valid_until date,
  status text not null default 'draft' check (status in ('draft','sent','accepted','cancelled')),
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  note text,
  created_by bigint references avo.users(id),
  created_at timestamptz not null default now()
);
create table if not exists avo.quote_lines (
  id bigint generated always as identity primary key,
  quote_id bigint not null references avo.quotes(id) on delete cascade,
  line_no int not null,
  variety_id bigint not null references avo.varieties(id),
  size_id bigint not null references avo.sizes(id),
  kg numeric(12,2) not null check (kg > 0),
  price numeric(12,2) not null check (price >= 0),
  amount numeric(14,2) not null
);

create table if not exists avo.invoices (
  id bigint generated always as identity primary key,
  doc_no text not null unique,
  title text not null default 'ใบส่งของ / ใบแจ้งหนี้',
  customer_id bigint not null references avo.customers(id),
  doc_date date not null,
  status text not null default 'issued' check (status in ('issued','cancelled')),
  discount numeric(12,2) not null default 0,
  shipping numeric(12,2) not null default 0,
  vat_rate numeric(5,2) not null default 0,
  subtotal numeric(14,2) not null default 0,
  vat numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  note text,
  created_by bigint references avo.users(id),
  created_at timestamptz not null default now(),
  cancel_reason text,
  cancelled_by bigint references avo.users(id),
  cancelled_at timestamptz
);
create table if not exists avo.invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references avo.invoices(id) on delete cascade,
  line_no int not null,
  dispatch_line_id bigint not null references avo.dispatch_lines(id),
  lot_id bigint not null references avo.lots(id),
  kg numeric(12,2) not null check (kg > 0),
  price numeric(12,2) not null check (price >= 0),
  list_price numeric(12,2),
  amount numeric(14,2) not null,
  cost numeric(14,2) not null default 0
);

-- ---------- ประวัติการแก้ไขข้อมูล ----------
create table if not exists avo.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_id bigint,
  action text not null,
  entity text not null,
  entity_id text,
  data jsonb
);

-- ==== sql/02_core.sql ====
-- =====================================================================
-- 02_core.sql : ฟังก์ชันแกนกลาง (ภายใน schema avo — หน้าเว็บเรียกตรงไม่ได้)
-- =====================================================================

-- ผู้ใช้ปัจจุบัน: อ่านจาก JWT ที่ Data API (Neon / Supabase / PostgREST) ส่งมา
-- ในโหมดทดสอบใช้ app.demo_claims แทน (ตั้งจากฝั่งเซิร์ฟเวอร์เท่านั้น)
create or replace function avo.claims() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    nullif(current_setting('app.demo_claims', true), '')::jsonb,
    '{}'::jsonb)
$$;

-- Neon Data API มีฟังก์ชัน auth.user_id() (อ่าน sub จาก JWT) — ใช้เมื่อไม่มี request.jwt.claims
create or replace function avo.uid() returns text
language plpgsql stable as $$
declare s text := avo.claims()->>'sub';
begin
  if s is null and to_regprocedure('auth.user_id()') is not null then
    execute 'select auth.user_id()::text' into s;
  end if;
  return s;
end $$;

create or replace function avo.fail(msg text) returns void
language plpgsql as $$ begin raise exception using message = msg, errcode = 'P0001'; end $$;

-- ตัวเลขแบบไม่มีทศนิยมเกิน (150.00 → 150)
create or replace function avo.n(x numeric) returns text
language sql immutable as $$ select coalesce(trim_scale(x)::text, '-') $$;

create or replace function avo.rip_label(r text) returns text
language sql immutable as $$
  select case r when 'raw' then 'ดิบ' when 'breaking' then 'ห่าม' when 'ripe' then 'สุก'
                when 'overripe' then 'สุกมาก' when 'na' then 'แช่แข็ง' else r end
$$;

create or replace function avo.rip_rank(r text) returns int
language sql immutable as $$
  select case r when 'overripe' then 4 when 'ripe' then 3 when 'breaking' then 2 when 'raw' then 1 else 0 end
$$;

create or replace function avo.zone_label(z text) returns text
language sql immutable as $$
  select case z when 'main' then 'คลัง' when 'front' then 'หน้าร้าน' when 'back' then 'หลังร้าน'
                when 'frozen' then 'แช่แข็ง' when 'transit' then 'ระหว่างทาง' else z end
$$;

create or replace function avo.setting(k text) returns jsonb
language sql stable as $$ select value from avo.settings where key = k $$;

create or replace function avo.threshold(k text, dflt numeric) returns numeric
language sql stable as $$
  select coalesce((avo.setting('thresholds')->>k)::numeric, dflt)
$$;

-- ผู้ใช้ที่ล็อกอินและได้รับสิทธิ์แล้ว
create or replace function avo.cur() returns avo.users
language plpgsql stable as $$
declare u avo.users;
begin
  if avo.uid() is null then perform avo.fail('กรุณาเข้าสู่ระบบ'); end if;
  select * into u from avo.users where auth_sub = avo.uid();
  if not found then perform avo.fail('ยังไม่พบบัญชีผู้ใช้ กรุณาโหลดหน้าใหม่'); end if;
  if not u.active then perform avo.fail('บัญชีนี้ถูกปิดการใช้งาน'); end if;
  if u.role = 'pending' then perform avo.fail('บัญชีรอผู้ดูแลระบบกำหนดสิทธิ์'); end if;
  return u;
end $$;

create or replace function avo.need(u avo.users, roles text[]) returns void
language plpgsql as $$
begin
  if u.role = 'admin' then return; end if;
  if not (u.role = any(roles)) then
    perform avo.fail('ไม่มีสิทธิ์ทำรายการนี้ (บทบาท: ' || u.role || ')');
  end if;
end $$;

-- มองเห็น/ทำงานกับสถานที่นี้ได้หรือไม่
create or replace function avo.can_see_site(u avo.users, p_site bigint) returns boolean
language sql stable as $$
  select case
    when u.role in ('admin','executive','sales','warehouse') then true
    when u.role = 'branch' then u.site_id = p_site
    else false end
$$;

create or replace function avo.can_act_site(u avo.users, p_site bigint) returns boolean
language sql stable as $$
  select case
    when u.role = 'admin' then true
    when u.role = 'warehouse' then (u.site_id is null and exists(select 1 from avo.sites s where s.id = p_site and s.kind='warehouse'))
                                   or u.site_id = p_site
    when u.role = 'branch' then u.site_id = p_site
    else false end
$$;

create or replace function avo.need_site(u avo.users, p_site bigint) returns void
language plpgsql as $$
begin
  if not avo.can_act_site(u, p_site) then
    perform avo.fail('ไม่มีสิทธิ์ทำรายการของสถานที่นี้');
  end if;
end $$;

create or replace function avo.is_approver(u avo.users, p_site bigint) returns boolean
language sql stable as $$
  select u.role in ('admin','executive') or (u.is_manager and avo.can_act_site(u, p_site))
$$;

-- จุดจัดเก็บที่ใช้ได้ตามประเภทสถานที่ (ห้ามทำรายการตรงกับ "ระหว่างทาง")
create or replace function avo.check_zone(p_site bigint, p_zone text) returns void
language plpgsql stable as $$
declare k text := (select kind from avo.sites where id = p_site);
begin
  if k is null then perform avo.fail('ไม่พบสถานที่'); end if;
  if (k = 'warehouse' and p_zone not in ('main','frozen')) or (k = 'branch' and p_zone not in ('front','back','frozen')) then
    perform avo.fail('จุดจัดเก็บ "' || avo.zone_label(p_zone) || '" ใช้กับสถานที่นี้ไม่ได้');
  end if;
end $$;

-- กันการใช้สต็อกที่ถูกจองไว้ในใบตีออกร่าง (ล็อกแถวก่อนตรวจ)
create or replace function avo.need_free(p_site bigint, p_zone text, p_lot bigint, p_rip text, p_kg numeric) returns void
language plpgsql as $$
declare have numeric; res numeric;
begin
  if coalesce(p_kg,0) <= 0 then return; end if;
  select kg into have from avo.balances where site_id = p_site and zone = p_zone and lot_id = p_lot and ripeness = p_rip for update;
  res := avo.reserved(p_site, p_zone, p_lot, p_rip);
  if coalesce(have,0) - res < p_kg then
    perform avo.fail(format('สต็อกว่างไม่พอ: คงเหลือ %s กก. ถูกจองในใบตีออกร่าง %s กก. ใช้ได้ %s กก.', avo.n(coalesce(have,0)), avo.n(res), avo.n(greatest(coalesce(have,0) - res, 0))));
  end if;
end $$;

-- เลขเอกสาร: PREFIX-YYMM-NNN (ปี ค.ศ. 2 หลัก + เดือน ตามเวลาไทย)
create or replace function avo.next_no(p_prefix text) returns text
language plpgsql as $$
declare per text := to_char(now() at time zone 'Asia/Bangkok', 'YYMM'); n int;
begin
  insert into avo.doc_counters(prefix, period, last) values (p_prefix, per, 1)
  on conflict (prefix, period) do update set last = avo.doc_counters.last + 1
  returning last into n;
  return p_prefix || '-' || per || '-' || lpad(n::text, 3, '0');
end $$;

create or replace function avo.audit(p_actor bigint, p_action text, p_entity text, p_id text, p_data jsonb)
returns void language sql as $$
  insert into avo.audit_log(actor_id, action, entity, entity_id, data) values (p_actor, p_action, p_entity, p_id, p_data)
$$;

create or replace function avo.jnum(p jsonb, k text) returns numeric
language sql immutable as $$ select nullif(p->>k, '')::numeric $$;
create or replace function avo.jint(p jsonb, k text) returns int
language sql immutable as $$ select nullif(p->>k, '')::numeric::int $$;
create or replace function avo.jid(p jsonb, k text) returns bigint
language sql immutable as $$ select nullif(p->>k, '')::bigint $$;
create or replace function avo.jtxt(p jsonb, k text) returns text
language sql immutable as $$ select nullif(btrim(p->>k), '') $$;

-- ---------------------------------------------------------------------
-- avo.move : จุดเดียวที่เปลี่ยนยอดคงเหลือ + เขียนสมุดเคลื่อนไหว
-- ล็อกแถวยอดคงเหลือ (FOR UPDATE) จึงกันการจ่ายเกินเมื่อหลายคนทำพร้อมกัน
-- ตะกร้า: ถ้าลดเกินที่มีจะตัดเหลือ 0 (ตะกร้าเป็นหน่วยประกอบ) และถ้า กก. หมด ตะกร้าจะเป็น 0
-- คืนค่า jsonb {id, d_baskets, d_bags} ที่ใช้จริง
-- ---------------------------------------------------------------------
create or replace function avo.move(
  p_site bigint, p_zone text, p_lot bigint, p_rip text,
  p_dkg numeric, p_dbask int, p_dbag int,
  p_mtype text, p_doc_type text, p_doc_id bigint, p_doc_no text,
  p_actor bigint, p_reason text default null, p_evidence text default null,
  p_approver bigint default null, p_counterparty text default null,
  p_occurred timestamptz default null)
returns jsonb language plpgsql as $$
declare b avo.balances; nk numeric; nb int; ng int; mid bigint; lcode text;
begin
  p_dkg := round(coalesce(p_dkg, 0), 2); p_dbask := coalesce(p_dbask, 0); p_dbag := coalesce(p_dbag, 0);
  if p_dkg = 0 and p_dbask = 0 and p_dbag = 0 then
    return jsonb_build_object('id', null, 'd_baskets', 0, 'd_bags', 0);
  end if;
  insert into avo.balances(site_id, zone, lot_id, ripeness) values (p_site, p_zone, p_lot, p_rip)
  on conflict do nothing;
  select * into b from avo.balances
   where site_id = p_site and zone = p_zone and lot_id = p_lot and ripeness = p_rip for update;

  nk := b.kg + p_dkg;
  if nk < 0 then
    select code into lcode from avo.lots where id = p_lot;
    perform avo.fail(format('สต็อกไม่พอ: %s (%s · %s) คงเหลือ %s กก. แต่ต้องการ %s กก.',
      lcode, avo.zone_label(p_zone), avo.rip_label(p_rip), avo.n(b.kg), avo.n(-p_dkg)));
  end if;
  nb := b.baskets + p_dbask;
  if nb < 0 or (nk = 0 and p_dkg < 0) then nb := 0; end if;
  ng := b.bags + p_dbag;
  if ng < 0 then
    select code into lcode from avo.lots where id = p_lot;
    perform avo.fail(format('จำนวนถุงไม่พอ: %s คงเหลือ %s ถุง แต่ต้องการ %s ถุง', lcode, b.bags, -p_dbag));
  end if;
  if nk = 0 and p_dkg < 0 then ng := 0; end if;

  update avo.balances set kg = nk, baskets = nb, bags = ng, updated_at = now()
   where site_id = p_site and zone = p_zone and lot_id = p_lot and ripeness = p_rip;

  insert into avo.movements(mtype, doc_type, doc_id, doc_no, lot_id, site_id, zone, ripeness,
     d_kg, d_baskets, d_bags, before_kg, after_kg, before_baskets, after_baskets, before_bags, after_bags,
     occurred_at, actor_id, approver_id, counterparty, reason, evidence)
  values (p_mtype, p_doc_type, p_doc_id, p_doc_no, p_lot, p_site, p_zone, p_rip,
     p_dkg, nb - b.baskets, ng - b.bags, b.kg, nk, b.baskets, nb, b.bags, ng,
     coalesce(p_occurred, now()), p_actor, p_approver, p_counterparty, p_reason, p_evidence)
  returning id into mid;

  return jsonb_build_object('id', mid, 'd_baskets', nb - b.baskets, 'd_bags', ng - b.bags);
end $$;

-- ข้อมูลหลักสำหรับหน้าเว็บ
create or replace function avo.master_json() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'varieties', coalesce((select jsonb_agg(to_jsonb(v) order by v.sort, v.name) from avo.varieties v), '[]'),
    'sizes',     coalesce((select jsonb_agg(to_jsonb(s) order by s.sort, s.name) from avo.sizes s), '[]'),
    'sites',     coalesce((select jsonb_agg(to_jsonb(s) order by s.kind desc, s.sort, s.name) from avo.sites s), '[]'),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'name',x.name,'active',x.active,'buy_price',x.buy_price) order by x.name) from avo.suppliers x), '[]'),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'channel',c.channel,'active',c.active) order by c.name) from avo.customers c), '[]'),
    'settings',  coalesce((select jsonb_object_agg(key, value) from avo.settings), '{}')
  )
$$;

-- ข้อมูล Lot แบบย่อ (ใช้ซ้ำในหลายฟังก์ชัน)
create or replace function avo.lot_json(p_lot bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', l.id, 'code', l.code, 'product', l.product,
    'variety', v.name, 'variety_id', l.variety_id, 'size', s.name, 'size_id', l.size_id,
    'supplier', sp.name, 'supplier_id', l.supplier_id, 'received_at', l.received_at,
    'unit_cost', l.unit_cost, 'status', l.status, 'parent_lot_id', l.parent_lot_id)
  from avo.lots l
  left join avo.varieties v on v.id = l.variety_id
  left join avo.sizes s on s.id = l.size_id
  left join avo.suppliers sp on sp.id = l.supplier_id
  where l.id = p_lot
$$;

-- ==== sql/03_api_master.sql ====
-- =====================================================================
-- 03_api_master.sql : ผู้ใช้ ข้อมูลหลัก ตั้งค่า สวน ลูกค้า ราคา ไฟล์แนบ
-- ทุกฟังก์ชัน public.api_* รับพารามิเตอร์เดียว p jsonb และคืน jsonb
-- =====================================================================

-- ---------- ผู้ใช้ปัจจุบัน (สร้างบัญชีอัตโนมัติเมื่อล็อกอินครั้งแรก) ----------
create or replace function public.api_me(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare sub text := avo.uid(); c jsonb := avo.claims(); u avo.users;
begin
  if sub is null then perform avo.fail('กรุณาเข้าสู่ระบบ'); end if;
  select * into u from avo.users where auth_sub = sub;
  if not found then
    perform pg_advisory_xact_lock(424242);           -- กันผู้ใช้คนแรกสองคนพร้อมกัน
    insert into avo.users(auth_sub, email, display_name, role)
    values (sub, coalesce(c->>'email', nullif(p->>'email','')),
            coalesce(nullif(p->>'name',''), nullif(c->>'name',''), split_part(coalesce(c->>'email', nullif(p->>'email',''), 'ผู้ใช้ใหม่'),'@',1)),
            case when not exists (select 1 from avo.users where role = 'admin') then 'admin' else 'pending' end)
    on conflict (auth_sub) do nothing;
    select * into u from avo.users where auth_sub = sub;
    perform avo.audit(u.id, 'signup', 'user', u.id::text, jsonb_build_object('role', u.role, 'email', u.email));
  end if;
  return jsonb_build_object(
    'user', to_jsonb(u) - 'auth_sub' || jsonb_build_object('site', (select to_jsonb(s) from avo.sites s where s.id = u.site_id)),
    'master', case when u.role = 'pending' or not u.active then '{}'::jsonb else avo.master_json() end);
end $$;

-- ---------- ผู้ใช้งานและสิทธิ์ (Admin) ----------
create or replace function public.api_users(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['admin']);
  return coalesce((select jsonb_agg(to_jsonb(x) - 'auth_sub' || jsonb_build_object('site_name', s.name) order by x.active desc, x.role = 'pending' desc, x.display_name)
                   from avo.users x left join avo.sites s on s.id = x.site_id), '[]');
end $$;

create or replace function public.api_user_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); t avo.users; v_role text := avo.jtxt(p,'role');
begin
  perform avo.need(u, array['admin']);
  select * into t from avo.users where id = avo.jid(p,'id') for update;
  if not found then perform avo.fail('ไม่พบผู้ใช้'); end if;
  if v_role is not null and v_role not in ('pending','admin','executive','warehouse','branch','sales') then
    perform avo.fail('บทบาทไม่ถูกต้อง'); end if;
  if t.id = u.id and (coalesce(v_role, t.role) <> 'admin' or coalesce((p->>'active')::boolean, true) = false) then
    perform avo.fail('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้'); end if;
  if coalesce(v_role, t.role) = 'branch' and coalesce(avo.jid(p,'site_id'), case when p ? 'site_id' then null else t.site_id end) is null then
    perform avo.fail('ผู้ใช้ฝ่ายสาขาต้องระบุสาขา'); end if;
  update avo.users set
    role = coalesce(v_role, role),
    display_name = coalesce(avo.jtxt(p,'display_name'), display_name),
    site_id = case when p ? 'site_id' then avo.jid(p,'site_id') else site_id end,
    is_manager = coalesce((p->>'is_manager')::boolean, is_manager),
    active = coalesce((p->>'active')::boolean, active),
    updated_by = u.id, updated_at = now()
  where id = t.id returning * into t;
  perform avo.audit(u.id, 'update', 'user', t.id::text, p);
  return to_jsonb(t) - 'auth_sub';
end $$;

-- ---------- ข้อมูลหลัก: สายพันธุ์ ไซส์ สาขา/คลัง ----------
create or replace function public.api_master_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); ent text := p->>'entity'; r jsonb := coalesce(p->'row','{}'); rid bigint := avo.jid(r,'id'); res jsonb;
begin
  if ent in ('variety','size') then
    if not (u.role = 'admin' or (u.role = 'warehouse' and u.is_manager)) then
      perform avo.fail('เฉพาะ Admin หรือผู้จัดการคลังที่แก้ไขสายพันธุ์/ไซส์ได้'); end if;
  else
    perform avo.need(u, array['admin']);
  end if;
  if avo.jtxt(r,'code') is null or avo.jtxt(r,'name') is null then perform avo.fail('กรุณากรอกรหัสและชื่อ'); end if;
  if ent = 'variety' then
    if rid is null then
      insert into avo.varieties(code, name, sort, active, updated_by) values (upper(avo.jtxt(r,'code')), avo.jtxt(r,'name'), coalesce(avo.jint(r,'sort'),0), coalesce((r->>'active')::boolean,true), u.id) returning to_jsonb(varieties.*) into res;
    else
      update avo.varieties set code = upper(avo.jtxt(r,'code')), name = avo.jtxt(r,'name'), sort = coalesce(avo.jint(r,'sort'),sort), active = coalesce((r->>'active')::boolean,active), updated_by = u.id, updated_at = now() where id = rid returning to_jsonb(varieties.*) into res;
    end if;
  elsif ent = 'size' then
    if rid is null then
      insert into avo.sizes(code, name, min_g, max_g, sort, active, updated_by) values (upper(avo.jtxt(r,'code')), avo.jtxt(r,'name'), avo.jint(r,'min_g'), avo.jint(r,'max_g'), coalesce(avo.jint(r,'sort'),0), coalesce((r->>'active')::boolean,true), u.id) returning to_jsonb(sizes.*) into res;
    else
      update avo.sizes set code = upper(avo.jtxt(r,'code')), name = avo.jtxt(r,'name'), min_g = avo.jint(r,'min_g'), max_g = avo.jint(r,'max_g'), sort = coalesce(avo.jint(r,'sort'),sort), active = coalesce((r->>'active')::boolean,active), updated_by = u.id, updated_at = now() where id = rid returning to_jsonb(sizes.*) into res;
    end if;
  elsif ent = 'site' then
    if coalesce(r->>'kind','') not in ('warehouse','branch') then perform avo.fail('ประเภทสถานที่ต้องเป็น คลัง หรือ สาขา'); end if;
    if rid is null then
      insert into avo.sites(code, name, kind, sort, active, updated_by) values (upper(avo.jtxt(r,'code')), avo.jtxt(r,'name'), r->>'kind', coalesce(avo.jint(r,'sort'),0), coalesce((r->>'active')::boolean,true), u.id) returning to_jsonb(sites.*) into res;
    else
      update avo.sites set code = upper(avo.jtxt(r,'code')), name = avo.jtxt(r,'name'), kind = r->>'kind', sort = coalesce(avo.jint(r,'sort'),sort), active = coalesce((r->>'active')::boolean,active), updated_by = u.id, updated_at = now() where id = rid returning to_jsonb(sites.*) into res;
    end if;
  else
    perform avo.fail('ประเภทข้อมูลไม่ถูกต้อง');
  end if;
  if res is null then perform avo.fail('ไม่พบข้อมูลที่ต้องการแก้ไข'); end if;
  perform avo.audit(u.id, case when rid is null then 'create' else 'update' end, ent, res->>'id', r);
  return res;
exception when unique_violation then
  perform avo.fail('รหัสนี้ถูกใช้แล้ว'); return null;
end $$;

create or replace function public.api_settings_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); k text := p->>'key';
begin
  perform avo.need(u, array['admin']);
  if k not in ('thresholds','company','options') then perform avo.fail('หมวดการตั้งค่าไม่ถูกต้อง'); end if;
  insert into avo.settings(key, value, updated_by) values (k, coalesce(p->'value','{}'), u.id)
  on conflict (key) do update set value = excluded.value, updated_by = u.id, updated_at = now();
  perform avo.audit(u.id, 'update', 'settings', k, p->'value');
  return avo.master_json();
end $$;

create or replace function public.api_audit(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['admin','executive']);
  return coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'actor', x.display_name, 'action', a.action,
            'entity', a.entity, 'entity_id', a.entity_id, 'data', a.data) order by a.id desc)
     from (select * from avo.audit_log order by id desc limit coalesce(avo.jint(p,'limit'), 200)) a
     left join avo.users x on x.id = a.actor_id), '[]');
end $$;

-- ---------- ไฟล์แนบ (รูปหลักฐาน) ----------
create or replace function public.api_attachment_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); d text := p->>'data'; nid bigint;
begin
  if d is null or d not like 'data:image/%' then perform avo.fail('ไฟล์แนบต้องเป็นรูปภาพ'); end if;
  if length(d) > 1500000 then perform avo.fail('รูปมีขนาดใหญ่เกินไป'); end if;
  insert into avo.attachments(mime, data, created_by) values (split_part(split_part(d, ';', 1), ':', 2), d, u.id) returning id into nid;
  return jsonb_build_object('ref', 'att:' || (select token from avo.attachments where id = nid));
end $$;

create or replace function public.api_attachment_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); r text := p->>'ref';
begin
  if r is null or r !~ '^att:[0-9a-f-]{36}$' then return jsonb_build_object('data', null); end if;
  return jsonb_build_object('data', (select data from avo.attachments where token = substr(r, 5)::uuid));
end $$;

-- ---------- สวน / Supplier ----------
create or replace function public.api_supplier_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); rid bigint := avo.jid(p,'id'); res avo.suppliers;
begin
  perform avo.need(u, array['warehouse','executive']);
  if avo.jtxt(p,'name') is null then perform avo.fail('กรุณากรอกชื่อสวน'); end if;
  if rid is null then
    insert into avo.suppliers(code, name, contact, phone, province, varieties, buy_price, note, active, updated_by)
    values (coalesce(upper(avo.jtxt(p,'code')), 'F' || lpad(((select count(*) from avo.suppliers) + 1)::text, 3, '0')),
            avo.jtxt(p,'name'), avo.jtxt(p,'contact'), avo.jtxt(p,'phone'), avo.jtxt(p,'province'),
            avo.jtxt(p,'varieties'), avo.jnum(p,'buy_price'), avo.jtxt(p,'note'), coalesce((p->>'active')::boolean, true), u.id)
    returning * into res;
  else
    update avo.suppliers set code = coalesce(upper(avo.jtxt(p,'code')), code), name = avo.jtxt(p,'name'),
      contact = avo.jtxt(p,'contact'), phone = avo.jtxt(p,'phone'), province = avo.jtxt(p,'province'),
      varieties = avo.jtxt(p,'varieties'), buy_price = avo.jnum(p,'buy_price'), note = avo.jtxt(p,'note'),
      active = coalesce((p->>'active')::boolean, active), updated_by = u.id, updated_at = now()
    where id = rid returning * into res;
    if not found then perform avo.fail('ไม่พบสวน'); end if;
  end if;
  perform avo.audit(u.id, case when rid is null then 'create' else 'update' end, 'supplier', res.id::text, p);
  return to_jsonb(res);
exception when unique_violation then perform avo.fail('รหัสสวนนี้ถูกใช้แล้ว'); return null;
end $$;

create or replace function public.api_suppliers(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['warehouse','sales','executive']);
  return coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'receipts', (select count(*) from avo.receipts r where r.supplier_id = s.id and r.status = 'confirmed'),
      'received_kg', (select coalesce(sum(rl.accepted_kg),0) from avo.receipt_lines rl join avo.receipts r on r.id = rl.receipt_id where r.supplier_id = s.id and r.status = 'confirmed'),
      'last_received', (select max(r.received_at) from avo.receipts r where r.supplier_id = s.id and r.status = 'confirmed'))
    order by s.active desc, s.name) from avo.suppliers s), '[]');
end $$;

create or replace function public.api_supplier_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); sid bigint := avo.jid(p,'id'); recv numeric; waste numeric;
begin
  perform avo.need(u, array['warehouse','sales','executive']);
  select coalesce(sum(rl.accepted_kg),0) into recv from avo.receipt_lines rl join avo.receipts r on r.id = rl.receipt_id
   where r.supplier_id = sid and r.status = 'confirmed';
  select coalesce(sum(-m.d_kg),0) into waste from avo.movements m join avo.lots l on l.id = m.lot_id
   where coalesce((select pl.supplier_id from avo.lots pl where pl.id = l.parent_lot_id), l.supplier_id) = sid
     and m.mtype in ('WASTE','CASE_LOSS');
  return (select to_jsonb(s) || jsonb_build_object(
    'received_kg', recv, 'waste_kg', waste,
    'waste_rate', case when recv > 0 then round(waste * 100 / recv, 2) else 0 end,
    'rejected_kg', (select coalesce(sum(rl.rejected_kg),0) from avo.receipt_lines rl join avo.receipts r on r.id = rl.receipt_id where r.supplier_id = sid and r.status = 'confirmed'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('receipt_id', r.id, 'doc_no', r.doc_no, 'received_at', r.received_at, 'status', r.status,
         'lot', l.code, 'variety', v.name, 'size', z.name, 'baskets', rl.baskets, 'net_kg', rl.net_kg, 'accepted_kg', rl.accepted_kg,
         'rejected_kg', rl.rejected_kg, 'unit_cost', rl.unit_cost) order by r.received_at desc, rl.line_no)
       from avo.receipts r join avo.receipt_lines rl on rl.receipt_id = r.id join avo.lots l on l.id = rl.lot_id
       join avo.varieties v on v.id = rl.variety_id join avo.sizes z on z.id = rl.size_id
       where r.supplier_id = sid), '[]'))
    from avo.suppliers s where s.id = sid);
end $$;

-- ---------- ลูกค้า ----------
create or replace function public.api_customer_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); rid bigint := avo.jid(p,'id'); res avo.customers;
begin
  perform avo.need(u, array['sales','executive']);
  if avo.jtxt(p,'name') is null then perform avo.fail('กรุณากรอกชื่อลูกค้า'); end if;
  if coalesce(p->>'channel','wholesale') not in ('wholesale','retail','dc','online','tiktok','other') then perform avo.fail('ช่องทางขายไม่ถูกต้อง'); end if;
  if rid is null then
    insert into avo.customers(code, name, ctype, channel, address, phone, tax_id, note, active, updated_by)
    values (coalesce(upper(avo.jtxt(p,'code')), 'C' || lpad(((select count(*) from avo.customers) + 1)::text, 3, '0')),
            avo.jtxt(p,'name'), coalesce(avo.jtxt(p,'ctype'),'company'), coalesce(avo.jtxt(p,'channel'),'wholesale'),
            avo.jtxt(p,'address'), avo.jtxt(p,'phone'), avo.jtxt(p,'tax_id'), avo.jtxt(p,'note'), coalesce((p->>'active')::boolean,true), u.id)
    returning * into res;
  else
    update avo.customers set code = coalesce(upper(avo.jtxt(p,'code')), code), name = avo.jtxt(p,'name'),
      ctype = coalesce(avo.jtxt(p,'ctype'), ctype), channel = coalesce(avo.jtxt(p,'channel'), channel),
      address = avo.jtxt(p,'address'), phone = avo.jtxt(p,'phone'), tax_id = avo.jtxt(p,'tax_id'), note = avo.jtxt(p,'note'),
      active = coalesce((p->>'active')::boolean, active), updated_by = u.id, updated_at = now()
    where id = rid returning * into res;
    if not found then perform avo.fail('ไม่พบลูกค้า'); end if;
  end if;
  perform avo.audit(u.id, case when rid is null then 'create' else 'update' end, 'customer', res.id::text, p);
  return to_jsonb(res);
exception when unique_violation then perform avo.fail('รหัสลูกค้านี้ถูกใช้แล้ว'); return null;
end $$;

create or replace function public.api_customers(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['warehouse','sales','executive']);
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'invoices', (select count(*) from avo.invoices i where i.customer_id = c.id and i.status = 'issued'),
      'sales_total', (select coalesce(sum(i.total),0) from avo.invoices i where i.customer_id = c.id and i.status = 'issued'),
      'last_sale', (select max(i.doc_date) from avo.invoices i where i.customer_id = c.id and i.status = 'issued'))
    order by c.active desc, c.name) from avo.customers c), '[]');
end $$;

create or replace function public.api_customer_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); cid bigint := avo.jid(p,'id');
begin
  perform avo.need(u, array['warehouse','sales','executive']);
  return (select to_jsonb(c) || jsonb_build_object(
    'prices', coalesce((select jsonb_agg(jsonb_build_object('variety', v.name, 'size', z.name, 'product', pr.product, 'sell_price', pr.sell_price))
        from avo.prices pr join avo.varieties v on v.id = pr.variety_id join avo.sizes z on z.id = pr.size_id where pr.customer_id = cid), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('invoice_id', i.id, 'doc_no', i.doc_no, 'doc_date', i.doc_date, 'status', i.status,
        'variety', v.name, 'size', z.name, 'lot', l.code, 'kg', il.kg, 'price', il.price, 'amount', il.amount) order by i.doc_date desc, i.id desc, il.line_no)
       from avo.invoices i join avo.invoice_lines il on il.invoice_id = i.id join avo.lots l on l.id = il.lot_id
       left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
       where i.customer_id = cid), '[]'),
    'favorites', coalesce((select jsonb_agg(x order by (x->>'kg')::numeric desc) from (
        select jsonb_build_object('variety', v.name, 'size', z.name, 'kg', sum(il.kg)) x
        from avo.invoices i join avo.invoice_lines il on il.invoice_id = i.id join avo.lots l on l.id = il.lot_id
        left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
        where i.customer_id = cid and i.status = 'issued' group by v.name, z.name) q), '[]'))
    from avo.customers c where c.id = cid);
end $$;

-- ---------- ราคาขาย ----------
create or replace function avo.price_for(p_customer bigint, p_variety bigint, p_size bigint, p_product text) returns numeric
language sql stable as $$
  select coalesce(
    (select sell_price from avo.prices where customer_id = p_customer and variety_id = p_variety and size_id = p_size and product = coalesce(p_product,'fresh')),
    (select sell_price from avo.prices where customer_id is null and variety_id = p_variety and size_id = p_size and product = coalesce(p_product,'fresh')))
$$;

-- ฝ่ายขายต้องใช้ราคาตามที่ตั้งไว้ ผู้บริหาร/Admin เท่านั้นที่แก้ราคาหน้าบิลได้
create or replace function avo.check_price(u avo.users, p_customer bigint, p_variety bigint, p_size bigint, p_product text, p_price numeric) returns numeric
language plpgsql stable as $$
declare lp numeric := avo.price_for(p_customer, p_variety, p_size, p_product);
begin
  if p_price is null or p_price < 0 then perform avo.fail('ราคาไม่ถูกต้อง'); end if;
  if u.role in ('admin','executive') then return lp; end if;
  if lp is null then perform avo.fail('ยังไม่ได้ตั้งราคาขายของสินค้านี้ ให้ผู้บริหารตั้งราคาในหน้าตั้งค่าก่อน'); end if;
  if p_price <> lp then perform avo.fail(format('ฝ่ายขายแก้ราคาไม่ได้ (ราคาที่ตั้งไว้ %s บาท/กก.)', avo.n(lp))); end if;
  return lp;
end $$;

create or replace function public.api_prices(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['warehouse','sales','executive']);
  return coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'customer_id', pr.customer_id, 'customer', c.name,
      'variety_id', pr.variety_id, 'variety', v.name, 'size_id', pr.size_id, 'size', z.name, 'product', pr.product,
      'sell_price', pr.sell_price, 'updated_at', pr.updated_at) order by c.name nulls first, v.sort, z.sort, pr.product)
    from avo.prices pr join avo.varieties v on v.id = pr.variety_id join avo.sizes z on z.id = pr.size_id
    left join avo.customers c on c.id = pr.customer_id), '[]');
end $$;

create or replace function public.api_price_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); cid bigint := avo.jid(p,'customer_id'); vid bigint := avo.jid(p,'variety_id');
  zid bigint := avo.jid(p,'size_id'); prod text := coalesce(avo.jtxt(p,'product'),'fresh'); pr numeric := avo.jnum(p,'sell_price');
begin
  perform avo.need(u, array['executive']);
  if vid is null or zid is null then perform avo.fail('กรุณาเลือกสายพันธุ์และไซส์'); end if;
  delete from avo.prices where coalesce(customer_id,0) = coalesce(cid,0) and variety_id = vid and size_id = zid and product = prod;
  if pr is not null then
    if pr < 0 then perform avo.fail('ราคาต้องไม่ติดลบ'); end if;
    insert into avo.prices(customer_id, variety_id, size_id, product, sell_price, updated_by) values (cid, vid, zid, prod, pr, u.id);
  end if;
  perform avo.audit(u.id, 'update', 'price', coalesce(cid::text,'std') || ':' || vid || ':' || zid || ':' || prod, p);
  return public.api_prices('{}');
end $$;

create or replace function public.api_price_lookup(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); l avo.lots;
begin
  if p ? 'lot_id' then
    select * into l from avo.lots where id = avo.jid(p,'lot_id');
    return jsonb_build_object('price', avo.price_for(avo.jid(p,'customer_id'), l.variety_id, l.size_id, l.product));
  end if;
  return jsonb_build_object('price', avo.price_for(avo.jid(p,'customer_id'), avo.jid(p,'variety_id'), avo.jid(p,'size_id'), coalesce(avo.jtxt(p,'product'),'fresh')));
end $$;

-- ==== sql/04_api_stock.sql ====
-- =====================================================================
-- 04_api_stock.sql : รับเข้า สต็อก ความสุก ตีออก/โอน รับปลายทาง ส่วนต่าง งานสาขา ปรับยอด
-- =====================================================================

-- ---------- ใบรับเข้า ----------
create or replace function avo.receipt_json(p_id bigint) returns jsonb
language sql stable as $$
  select to_jsonb(r) || jsonb_build_object(
    'supplier', s.name, 'site', st.name,
    'created_by_name', (select display_name from avo.users where id = r.created_by),
    'checked_by_name', (select display_name from avo.users where id = r.checked_by),
    'total_net', (select coalesce(sum(net_kg),0) from avo.receipt_lines where receipt_id = r.id),
    'total_accepted', (select coalesce(sum(accepted_kg),0) from avo.receipt_lines where receipt_id = r.id),
    'total_baskets', (select coalesce(sum(baskets),0) from avo.receipt_lines where receipt_id = r.id),
    'lines', coalesce((select jsonb_agg(to_jsonb(rl) || jsonb_build_object('lot_code', l.code, 'variety', v.name, 'size', z.name)
        order by rl.line_no) from avo.receipt_lines rl join avo.lots l on l.id = rl.lot_id
        join avo.varieties v on v.id = rl.variety_id join avo.sizes z on z.id = rl.size_id where rl.receipt_id = r.id), '[]'))
  from avo.receipts r join avo.suppliers s on s.id = r.supplier_id join avo.sites st on st.id = r.site_id
  where r.id = p_id
$$;

create or replace function public.api_receipt_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); r avo.receipts; rid bigint := avo.jid(p,'id'); ln jsonb; i int := 0;
  v_site bigint; v_sup bigint := avo.jid(p,'supplier_id'); v_lot bigint; v_line bigint; v_status text; keep bigint[] := '{}';
  v_var bigint; v_size bigint; v_rip text; v_gross numeric; v_tare numeric;
begin
  perform avo.need(u, array['warehouse']);
  v_site := coalesce(avo.jid(p,'site_id'), u.site_id,
            (select id from avo.sites where kind = 'warehouse' and active order by sort, id limit 1));
  if v_site is null then perform avo.fail('ยังไม่ได้ตั้งค่าคลังสินค้า (ตั้งค่า → สาขา/คลัง)'); end if;
  if (select kind from avo.sites where id = v_site) <> 'warehouse' then perform avo.fail('รับเข้าจากสวนได้เฉพาะที่คลัง'); end if;
  perform avo.need_site(u, v_site);
  if v_sup is null or not exists (select 1 from avo.suppliers where id = v_sup) then perform avo.fail('กรุณาเลือกสวน / แหล่งที่มา'); end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then perform avo.fail('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ'); end if;
  v_status := case when coalesce((p->>'submit')::boolean, false) then 'pending_check' else 'draft' end;

  if rid is null then
    insert into avo.receipts(doc_no, supplier_id, site_id, received_at, status, note, evidence, created_by)
    values (avo.next_no('IN'), v_sup, v_site, coalesce((p->>'received_at')::timestamptz, now()), v_status,
            avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id)
    returning * into r;
  else
    if not avo.can_act_site(u, (select site_id from avo.receipts where id = rid)) then perform avo.fail('ไม่มีสิทธิ์แก้ไขใบรับเข้าของคลังอื่น'); end if;
    update avo.receipts set supplier_id = v_sup, site_id = v_site,
      received_at = coalesce((p->>'received_at')::timestamptz, received_at), status = v_status,
      note = avo.jtxt(p,'note'), evidence = coalesce(avo.jtxt(p,'evidence'), evidence), updated_at = now()
    where id = rid and status in ('draft','pending_check') returning * into r;
    if not found then perform avo.fail('แก้ไขได้เฉพาะใบรับเข้าที่ยังไม่ยืนยัน'); end if;
  end if;

  for ln in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    v_var := avo.jid(ln,'variety_id'); v_size := avo.jid(ln,'size_id'); v_rip := coalesce(ln->>'ripeness','raw');
    v_gross := avo.jnum(ln,'gross_kg'); v_tare := coalesce(avo.jnum(ln,'tare_kg'), 0);
    if v_var is null or v_size is null then perform avo.fail(format('รายการที่ %s: กรุณาเลือกสายพันธุ์และไซส์', i)); end if;
    if v_rip not in ('raw','breaking','ripe','overripe') then perform avo.fail(format('รายการที่ %s: สถานะความสุกไม่ถูกต้อง', i)); end if;
    if v_gross is null or v_gross <= 0 then perform avo.fail(format('รายการที่ %s: กรุณากรอกน้ำหนักรวม (ชั่งจริง)', i)); end if;
    if v_tare < 0 or v_tare >= v_gross then perform avo.fail(format('รายการที่ %s: น้ำหนักตะกร้าต้องน้อยกว่าน้ำหนักรวม', i)); end if;
    if coalesce(avo.jint(ln,'baskets'),0) < 0 then perform avo.fail(format('รายการที่ %s: จำนวนตะกร้าไม่ถูกต้อง', i)); end if;

    v_line := avo.jid(ln,'id');
    if v_line is not null and exists (select 1 from avo.receipt_lines where id = v_line and receipt_id = r.id) then
      select lot_id into v_lot from avo.receipt_lines where id = v_line;
      update avo.lots set variety_id = v_var, size_id = v_size, supplier_id = v_sup, received_at = r.received_at,
             unit_cost = coalesce(avo.jnum(ln,'unit_cost'),0) where id = v_lot;
      update avo.receipt_lines set line_no = i, variety_id = v_var, size_id = v_size, ripeness = v_rip,
             baskets = coalesce(avo.jint(ln,'baskets'),0), gross_kg = v_gross, tare_kg = v_tare,
             unit_cost = coalesce(avo.jnum(ln,'unit_cost'),0), note = avo.jtxt(ln,'note')
       where id = v_line;
    else
      insert into avo.lots(code, product, variety_id, size_id, supplier_id, receipt_id, received_at, unit_cost, status)
      values (avo.next_no('LOT'), 'fresh', v_var, v_size, v_sup, r.id, r.received_at, coalesce(avo.jnum(ln,'unit_cost'),0), 'draft')
      returning id into v_lot;
      insert into avo.receipt_lines(receipt_id, line_no, lot_id, variety_id, size_id, ripeness, baskets, gross_kg, tare_kg, unit_cost, note)
      values (r.id, i, v_lot, v_var, v_size, v_rip, coalesce(avo.jint(ln,'baskets'),0), v_gross, v_tare,
              coalesce(avo.jnum(ln,'unit_cost'),0), avo.jtxt(ln,'note'))
      returning id into v_line;
    end if;
    keep := keep || v_line;
  end loop;

  -- ลบบรรทัดที่ถูกเอาออก (และ Lot ร่างของบรรทัดนั้น)
  with d as (delete from avo.receipt_lines where receipt_id = r.id and not (id = any(keep)) returning lot_id)
  delete from avo.lots where id in (select lot_id from d);

  perform avo.audit(u.id, case when rid is null then 'create' else 'update' end, 'receipt', r.id::text, jsonb_build_object('status', v_status));
  return avo.receipt_json(r.id);
end $$;

-- ยืนยันตรวจรับ: สต็อกเพิ่มตามน้ำหนักที่ตรวจรับจริงเท่านั้น
create or replace function public.api_receipt_confirm(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); r avo.receipts; rl avo.receipt_lines; ln jsonb; rej numeric; sname text;
begin
  perform avo.need(u, array['warehouse']);
  select * into r from avo.receipts where id = avo.jid(p,'id') for update;
  if not found then perform avo.fail('ไม่พบใบรับเข้า'); end if;
  if r.status not in ('draft','pending_check') then perform avo.fail('ใบรับเข้านี้ยืนยันหรือยกเลิกไปแล้ว'); end if;
  perform avo.need_site(u, r.site_id);
  select name into sname from avo.suppliers where id = r.supplier_id;

  for rl in select * from avo.receipt_lines where receipt_id = r.id order by line_no loop
    select x into ln from jsonb_array_elements(coalesce(p->'lines','[]')) x where (x->>'id')::bigint = rl.id;
    rej := coalesce(avo.jnum(ln,'rejected_kg'), rl.rejected_kg, 0);
    if rej < 0 or rej > rl.net_kg then perform avo.fail(format('บรรทัด %s: น้ำหนักคัดออกต้องอยู่ระหว่าง 0 ถึง %s กก.', rl.line_no, avo.n(rl.net_kg))); end if;
    update avo.receipt_lines set rejected_kg = rej, accepted_kg = net_kg - rej,
           note = coalesce(avo.jtxt(ln,'note'), note) where id = rl.id returning * into rl;
    update avo.lots set status = 'active' where id = rl.lot_id;
    perform avo.move(r.site_id, 'main', rl.lot_id, rl.ripeness, rl.accepted_kg, rl.baskets, 0,
                     'RECEIVE', 'RECEIPT', r.id, r.doc_no, u.id, avo.jtxt(p,'note'), coalesce(avo.jtxt(p,'evidence'), r.evidence),
                     u.id, sname, r.received_at);
  end loop;

  update avo.receipts set status = 'confirmed', checked_by = u.id, checked_at = now(),
         evidence = coalesce(avo.jtxt(p,'evidence'), evidence), updated_at = now() where id = r.id;
  perform avo.audit(u.id, 'confirm', 'receipt', r.id::text, p);
  return avo.receipt_json(r.id);
end $$;

create or replace function public.api_receipt_cancel(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); r avo.receipts;
begin
  perform avo.need(u, array['warehouse']);
  select * into r from avo.receipts where id = avo.jid(p,'id') for update;
  if not found or r.status not in ('draft','pending_check') then perform avo.fail('ยกเลิกได้เฉพาะใบรับเข้าที่ยังไม่ยืนยัน'); end if;
  perform avo.need_site(u, r.site_id);
  update avo.receipts set status = 'cancelled', cancel_reason = avo.jtxt(p,'reason'), updated_at = now() where id = r.id;
  update avo.lots set status = 'cancelled' where receipt_id = r.id;
  perform avo.audit(u.id, 'cancel', 'receipt', r.id::text, p);
  return avo.receipt_json(r.id);
end $$;

-- กลับรายการรับเข้าที่ยืนยันแล้ว (ทำได้เมื่อ Lot ยังไม่ถูกเคลื่อนไหว) ต้องมีเหตุผล
create or replace function public.api_receipt_reverse(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); r avo.receipts; rl avo.receipt_lines; bad text;
begin
  select * into r from avo.receipts where id = avo.jid(p,'id') for update;
  if not found or r.status <> 'confirmed' then perform avo.fail('กลับรายการได้เฉพาะใบรับเข้าที่ยืนยันแล้ว'); end if;
  if not avo.is_approver(u, r.site_id) then perform avo.fail('ต้องเป็นผู้จัดการคลัง ผู้บริหาร หรือ Admin'); end if;
  if avo.jtxt(p,'reason') is null then perform avo.fail('กรุณาระบุเหตุผลการกลับรายการ'); end if;
  select string_agg(l.code, ', ') into bad from avo.receipt_lines x join avo.lots l on l.id = x.lot_id
   where x.receipt_id = r.id and exists (select 1 from avo.movements m where m.lot_id = x.lot_id and m.mtype <> 'RECEIVE');
  if bad is not null then
    perform avo.fail('Lot ' || bad || ' ถูกเคลื่อนไหวแล้ว กลับรายการทั้งใบไม่ได้ ให้ใช้การปรับยอดที่อ้างอิงรายการเดิมแทน'); end if;
  for rl in select * from avo.receipt_lines where receipt_id = r.id loop
    perform avo.need_free(r.site_id, 'main', rl.lot_id, rl.ripeness, rl.accepted_kg);
    perform avo.move(r.site_id, 'main', rl.lot_id, rl.ripeness, -rl.accepted_kg, -rl.baskets, 0,
                     'RECEIVE_REVERSE', 'RECEIPT', r.id, r.doc_no, u.id, avo.jtxt(p,'reason'), avo.jtxt(p,'evidence'), u.id);
    update avo.lots set status = 'cancelled' where id = rl.lot_id;
  end loop;
  update avo.receipts set status = 'reversed', cancel_reason = avo.jtxt(p,'reason'), updated_at = now() where id = r.id;
  perform avo.audit(u.id, 'reverse', 'receipt', r.id::text, p);
  return avo.receipt_json(r.id);
end $$;

create or replace function public.api_receipts(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q text := lower(avo.jtxt(p,'q'));
begin
  return coalesce((select jsonb_agg(avo.receipt_json(r.id) - 'lines' || jsonb_build_object(
       'lots', (select string_agg(l.code, ', ' order by rl.line_no) from avo.receipt_lines rl join avo.lots l on l.id = rl.lot_id where rl.receipt_id = r.id))
     order by r.received_at desc, r.id desc)
    from avo.receipts r join avo.suppliers s on s.id = r.supplier_id
    where avo.can_see_site(u, r.site_id)
      and (avo.jtxt(p,'status') is null or r.status = p->>'status')
      and (avo.jtxt(p,'from') is null or (r.received_at at time zone 'Asia/Bangkok')::date >= (p->>'from')::date)
      and (avo.jtxt(p,'to') is null or (r.received_at at time zone 'Asia/Bangkok')::date <= (p->>'to')::date)
      and (q is null or lower(r.doc_no) like '%'||q||'%' or lower(s.name) like '%'||q||'%'
           or exists (select 1 from avo.receipt_lines rl join avo.lots l on l.id = rl.lot_id where rl.receipt_id = r.id and lower(l.code) like '%'||q||'%'))), '[]');
end $$;

create or replace function public.api_receipt_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  if not avo.can_see_site(u, (select site_id from avo.receipts where id = avo.jid(p,'id'))) then perform avo.fail('ไม่มีสิทธิ์ดูเอกสารนี้'); end if;
  return avo.receipt_json(avo.jid(p,'id'));
end $$;

-- ---------- สต็อก ----------
-- ยอดจองเพื่อส่ง = ใบตีออกสถานะร่าง
create or replace function avo.reserved(p_site bigint, p_zone text, p_lot bigint, p_rip text, p_exclude bigint default null) returns numeric
language sql stable as $$
  select coalesce(sum(dl.kg),0) from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id
  where d.status = 'draft' and d.from_site_id = p_site and d.from_zone = p_zone and dl.lot_id = p_lot and dl.ripeness = p_rip
    and d.id is distinct from p_exclude
$$;

create or replace function public.api_stock(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q text := lower(avo.jtxt(p,'q'));
begin
  return coalesce((select jsonb_agg(x order by x->>'site_kind' desc, x->>'site', (x->>'rip_rank')::int desc, x->>'received_at', x->>'lot_code') from (
    select jsonb_build_object('site_id', b.site_id, 'site', st.name, 'site_code', st.code, 'site_kind', st.kind, 'zone', b.zone,
      'lot_id', l.id, 'lot_code', l.code, 'product', l.product, 'variety_id', l.variety_id, 'variety', v.name,
      'size_id', l.size_id, 'size', z.name, 'supplier_id', l.supplier_id, 'supplier', sp.name,
      'received_at', l.received_at, 'age_days', ((now() at time zone 'Asia/Bangkok')::date - (l.received_at at time zone 'Asia/Bangkok')::date),
      'ripeness', b.ripeness, 'rip_rank', avo.rip_rank(b.ripeness), 'kg', b.kg, 'baskets', b.baskets, 'bags', b.bags,
      'unit_cost', l.unit_cost, 'value', round(b.kg * l.unit_cost, 2),
      'reserved_kg', avo.reserved(b.site_id, b.zone, b.lot_id, b.ripeness),
      'updated_at', b.updated_at) x
    from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
    left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    left join avo.suppliers sp on sp.id = l.supplier_id
    where (b.kg > 0 or b.bags > 0)
      and avo.can_see_site(u, b.site_id)
      and (avo.jid(p,'site_id') is null or b.site_id = avo.jid(p,'site_id'))
      and (case when avo.jtxt(p,'zone') is null then b.zone <> 'transit' else b.zone = p->>'zone' end)
      and (avo.jtxt(p,'site_kind') is null or st.kind = p->>'site_kind')
      and (avo.jtxt(p,'ripeness') is null or b.ripeness = p->>'ripeness')
      and (avo.jid(p,'variety_id') is null or l.variety_id = avo.jid(p,'variety_id'))
      and (avo.jid(p,'size_id') is null or l.size_id = avo.jid(p,'size_id'))
      and (avo.jid(p,'supplier_id') is null or l.supplier_id = avo.jid(p,'supplier_id'))
      and (avo.jtxt(p,'product') is null or l.product = p->>'product')
      and (q is null or lower(l.code) like '%'||q||'%' or lower(coalesce(v.name,'')) like '%'||q||'%'
           or lower(coalesce(sp.name,'')) like '%'||q||'%' or lower(coalesce(z.name,'')) like '%'||q||'%')
  ) t), '[]');
end $$;

-- ระบบแนะนำ Lot ที่ควรจ่ายก่อน (สุกก่อน → รับเข้าก่อน) และคำนวณการจัดสรรตามจำนวนที่ต้องการ
create or replace function public.api_fefo(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); need numeric := coalesce(avo.jnum(p,'need_kg'), 0); rec record; res jsonb := '[]'; take numeric; avail numeric;
begin
  if not avo.can_see_site(u, avo.jid(p,'site_id')) then perform avo.fail('ไม่มีสิทธิ์ดูสต็อกของสถานที่นี้'); end if;
  for rec in
    select b.*, l.code, l.received_at, l.product, v.name vname, z.name zname, sp.name spname
    from avo.balances b join avo.lots l on l.id = b.lot_id left join avo.varieties v on v.id = l.variety_id
    left join avo.sizes z on z.id = l.size_id left join avo.suppliers sp on sp.id = l.supplier_id
    where b.site_id = avo.jid(p,'site_id') and b.zone = coalesce(avo.jtxt(p,'zone'),'main') and b.kg > 0
      and (avo.jid(p,'variety_id') is null or l.variety_id = avo.jid(p,'variety_id'))
      and (avo.jid(p,'size_id') is null or l.size_id = avo.jid(p,'size_id'))
      and (avo.jtxt(p,'ripeness') is null or b.ripeness = p->>'ripeness')
    order by avo.rip_rank(b.ripeness) desc, l.received_at, l.id
  loop
    avail := rec.kg - avo.reserved(rec.site_id, rec.zone, rec.lot_id, rec.ripeness, avo.jid(p,'exclude_dispatch_id'));
    if avail <= 0 then continue; end if;
    take := least(avail, greatest(need, 0));
    need := need - take;
    res := res || jsonb_build_object('lot_id', rec.lot_id, 'lot_code', rec.code, 'ripeness', rec.ripeness,
      'variety', rec.vname, 'size', rec.zname, 'supplier', rec.spname, 'product', rec.product,
      'received_at', rec.received_at, 'kg', rec.kg, 'available_kg', avail, 'baskets', rec.baskets, 'bags', rec.bags,
      'suggest_kg', take,
      'suggest_baskets', case when rec.kg > 0 then round(rec.baskets * take / rec.kg)::int else 0 end);
  end loop;
  return res;
end $$;

-- ---------- ติดตาม / เปลี่ยนความสุก (อ้างอิงการตรวจจริง เก็บผู้ตรวจและเวลา) ----------
create or replace function public.api_ripeness_change(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); v_site bigint := avo.jid(p,'site_id'); v_zone text := coalesce(avo.jtxt(p,'zone'),'main');
  v_lot bigint := avo.jid(p,'lot_id'); f text := p->>'from'; t text := p->>'to'; kg numeric := avo.jnum(p,'kg');
  bk int := coalesce(avo.jint(p,'baskets'),0); no text; rid bigint; r jsonb;
begin
  perform avo.need(u, array['warehouse','branch']);
  perform avo.need_site(u, v_site);
  perform avo.check_zone(v_site, v_zone);
  if f = t then perform avo.fail('สถานะความสุกใหม่ต้องต่างจากเดิม'); end if;
  if t not in ('raw','breaking','ripe','overripe') or f not in ('raw','breaking','ripe','overripe') then perform avo.fail('สถานะความสุกไม่ถูกต้อง'); end if;
  if kg is null or kg <= 0 then perform avo.fail('กรุณาระบุน้ำหนักที่ตรวจ'); end if;
  if v_zone in ('frozen','transit') then perform avo.fail('เปลี่ยนความสุกได้เฉพาะสินค้าสดในคลัง/หน้าร้าน/หลังร้าน'); end if;
  perform avo.need_free(v_site, v_zone, v_lot, f, kg);
  no := avo.next_no('RIP');
  insert into avo.ripeness_checks(doc_no, lot_id, site_id, zone, from_ripeness, to_ripeness, kg, baskets, note, evidence, checked_by, checked_at)
  values (no, v_lot, v_site, v_zone, f, t, kg, bk, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, coalesce((p->>'checked_at')::timestamptz, now()))
  returning id into rid;
  r := avo.move(v_site, v_zone, v_lot, f, -kg, -bk, 0, 'RIPEN_OUT', 'RIPENESS', rid, no, u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'));
  perform avo.move(v_site, v_zone, v_lot, t, kg, -(r->>'d_baskets')::int, 0, 'RIPEN_IN', 'RIPENESS', rid, no, u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'));
  return jsonb_build_object('id', rid, 'doc_no', no);
end $$;

-- ---------- ประวัติเคลื่อนไหว ----------
create or replace function public.api_movements(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q text := lower(avo.jtxt(p,'q'));
begin
  return coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
    select jsonb_build_object('id', m.id, 'mtype', m.mtype, 'doc_type', m.doc_type, 'doc_id', m.doc_id, 'doc_no', m.doc_no,
      'lot_id', m.lot_id, 'lot_code', l.code, 'variety', v.name, 'size', z.name, 'site', st.name, 'site_id', m.site_id,
      'zone', m.zone, 'ripeness', m.ripeness, 'd_kg', m.d_kg, 'd_baskets', m.d_baskets, 'd_bags', m.d_bags,
      'before_kg', m.before_kg, 'after_kg', m.after_kg, 'occurred_at', m.occurred_at, 'recorded_at', m.recorded_at,
      'actor', ua.display_name, 'approver', ub.display_name, 'counterparty', m.counterparty, 'reason', m.reason, 'evidence', m.evidence) x
    from avo.movements m join avo.lots l on l.id = m.lot_id join avo.sites st on st.id = m.site_id
    left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    left join avo.users ua on ua.id = m.actor_id left join avo.users ub on ub.id = m.approver_id
    where avo.can_see_site(u, m.site_id)
      and (avo.jid(p,'lot_id') is null or m.lot_id = avo.jid(p,'lot_id'))
      and (avo.jid(p,'site_id') is null or m.site_id = avo.jid(p,'site_id'))
      and (avo.jtxt(p,'mtype') is null or m.mtype = p->>'mtype')
      and (avo.jtxt(p,'from') is null or (m.occurred_at at time zone 'Asia/Bangkok')::date >= (p->>'from')::date)
      and (avo.jtxt(p,'to') is null or (m.occurred_at at time zone 'Asia/Bangkok')::date <= (p->>'to')::date)
      and (q is null or lower(l.code) like '%'||q||'%' or lower(coalesce(m.doc_no,'')) like '%'||q||'%')
    order by m.id desc limit coalesce(avo.jint(p,'limit'), 500)) t), '[]');
end $$;

-- ---------- ตรวจสอบย้อนกลับ: Lot → สวน / ทุกปลายทาง ----------
create or replace function public.api_lot_trace(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); l avo.lots; root avo.lots; ev jsonb; br boolean;
begin
  br := u.role = 'branch';
  select * into l from avo.lots where id = avo.jid(p,'lot_id') or code = upper(avo.jtxt(p,'code')) limit 1;
  if not found then perform avo.fail('ไม่พบ Lot'); end if;
  root := l;
  if l.parent_lot_id is not null then select * into root from avo.lots where id = l.parent_lot_id; end if;
  -- สาขาดูได้เฉพาะ Lot ที่เคยอยู่/ส่งมาที่สาขาตัวเอง และเห็นเฉพาะเหตุการณ์ของสาขาตัวเอง
  if br and not exists (select 1 from avo.movements m where m.site_id = u.site_id and m.lot_id = l.id)
        and not exists (select 1 from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id where dl.lot_id = l.id and d.to_site_id = u.site_id) then
    perform avo.fail('ไม่มีสิทธิ์ดู Lot นี้');
  end if;

  select coalesce(jsonb_agg(e order by e->>'at', e->>'seq'), '[]') into ev from (
    -- รับเข้า
    select jsonb_build_object('at', r.received_at, 'seq', '1', 'kind', 'receive', 'title', 'รับเข้าจากสวน',
      'detail', format('%s · %s · สุทธิ %s กก. รับจริง %s กก.%s', s.name, r.doc_no, avo.n(rl.net_kg), avo.n(coalesce(rl.accepted_kg, rl.net_kg)),
                       case when rl.rejected_kg > 0 then ' (คัดออก ' || avo.n(rl.rejected_kg) || ' กก.)' else '' end),
      'doc_no', r.doc_no, 'status', r.status, 'actor', (select display_name from avo.users where id = r.checked_by)) e
    from avo.receipt_lines rl join avo.receipts r on r.id = rl.receipt_id join avo.suppliers s on s.id = r.supplier_id
    where rl.lot_id = root.id
    union all
    -- ตรวจความสุก
    select jsonb_build_object('at', c.checked_at, 'seq', '2', 'kind', 'ripeness', 'title', 'ตรวจความสุก',
      'detail', format('%s → %s · %s กก. · ผู้ตรวจ: %s · %s', avo.rip_label(c.from_ripeness), avo.rip_label(c.to_ripeness), avo.n(c.kg),
                       coalesce(x.display_name,'-'), st.name), 'doc_no', c.doc_no, 'evidence', c.evidence)
    from avo.ripeness_checks c join avo.sites st on st.id = c.site_id left join avo.users x on x.id = c.checked_by
    where c.lot_id = l.id and (not br or c.site_id = u.site_id)
    union all
    -- ตีออก
    select jsonb_build_object('at', d.shipped_at, 'seq', '3', 'kind', 'ship',
      'title', case when d.kind = 'sale' then 'ตีออกขาย ' || c.name else 'ตีออกไป ' || ts.name end,
      'detail', format('%s · ส่ง %s กก.%s', d.doc_no, avo.n(dl.kg), case when dl.baskets > 0 then ' / ' || dl.baskets || ' ตะกร้า' else '' end),
      'doc_no', d.doc_no, 'dispatch_id', d.id)
    from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id
    left join avo.sites ts on ts.id = d.to_site_id left join avo.customers c on c.id = d.customer_id
    where dl.lot_id = l.id and d.shipped_at is not null and (not br or u.site_id in (d.from_site_id, d.to_site_id))
    union all
    -- ปลายทางรับ
    select jsonb_build_object('at', d.received_at, 'seq', '4', 'kind', case when dl.received_kg < dl.kg then 'partial' else 'arrive' end,
      'title', case when dl.received_kg < dl.kg then 'ปลายทางรับบางส่วน' else 'ปลายทางรับครบ' end,
      'detail', format('รับ %s กก.%s · ผู้รับ: %s', avo.n(dl.received_kg),
                       case when dl.received_kg < dl.kg then ' · ขาด ' || avo.n(dl.kg - dl.received_kg) || ' กก.' else '' end, coalesce(d.receiver_name,'-')),
      'doc_no', d.doc_no, 'evidence', d.evidence, 'dispatch_id', d.id)
    from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id
    where dl.lot_id = l.id and d.received_at is not null and (not br or u.site_id in (d.from_site_id, d.to_site_id))
    union all
    -- สรุปส่วนต่าง
    select jsonb_build_object('at', cs.resolved_at, 'seq', '5', 'kind', 'case', 'title', 'สรุปส่วนต่าง ' || cs.doc_no,
      'detail', format('%s กก. → %s%s', avo.n(cs.kg), case cs.outcome when 'loss' then 'สูญเสีย' when 'return' then 'ส่งคืนต้นทาง' else 'ส่งตามภายหลัง' end,
                       coalesce(' · ' || cs.resolve_note, '')), 'doc_no', cs.doc_no)
    from avo.cases cs where cs.lot_id = l.id and cs.status = 'resolved'
      and (not br or exists (select 1 from avo.dispatches dd where dd.id = cs.dispatch_id and u.site_id in (dd.from_site_id, dd.to_site_id)))
    union all
    -- โอนภายใน
    select jsonb_build_object('at', it.created_at, 'seq', '6', 'kind', 'zone', 'title', 'โอนภายใน ' || st.name,
      'detail', format('%s → %s · %s กก.', avo.zone_label(it.from_zone), avo.zone_label(it.to_zone), avo.n(it.kg)), 'doc_no', it.doc_no)
    from avo.internal_transfers it join avo.sites st on st.id = it.site_id where it.lot_id = l.id and (not br or it.site_id = u.site_id)
    union all
    -- แปรรูปแช่แข็ง
    select jsonb_build_object('at', f.created_at, 'seq', '7', 'kind', 'freeze', 'title', 'แปรรูปแช่แข็ง',
      'detail', format('ใช้ %s กก. ได้ %s กก. / %s ถุง · สูญเสีย %s กก. · Lot ใหม่ %s', avo.n(f.input_kg), avo.n(f.output_kg), f.bags, avo.n(f.loss_kg), ol.code),
      'doc_no', f.doc_no, 'lot_code', ol.code)
    from avo.freezes f join avo.lots ol on ol.id = f.output_lot_id where (f.source_lot_id = l.id or f.output_lot_id = l.id) and (not br or f.site_id = u.site_id)
    union all
    -- ขายหน้าร้าน / ใช้ / ตัดทิ้ง / ปรับยอด
    select jsonb_build_object('at', coalesce(a.decided_at, a.requested_at), 'seq', '8', 'kind', a.kind,
      'title', case a.kind when 'retail_sale' then 'ขายหน้าร้าน' when 'internal_use' then 'นำไปใช้' when 'waste' then 'ตัดทิ้ง' else 'ปรับยอด' end
               || case a.status when 'pending' then ' (รออนุมัติ)' when 'rejected' then ' (ไม่อนุมัติ)' else '' end,
      'detail', format('%s · %s กก. · %s', st.name, avo.n(case when a.kind = 'count_adjust' then a.kg else abs(a.kg) end), coalesce(a.reason,'-')), 'doc_no', a.doc_no)
    from avo.adjustments a join avo.sites st on st.id = a.site_id where a.lot_id = l.id and (not br or a.site_id = u.site_id)
    union all
    -- ออกบิล
    select jsonb_build_object('at', i.created_at, 'seq', '9', 'kind', 'invoice', 'title', 'ออกบิล ' || i.doc_no || case when i.status = 'cancelled' then ' (ยกเลิก)' else '' end,
      'detail', format('%s · %s กก. × %s บาท', c.name, avo.n(il.kg), avo.n(il.price)), 'doc_no', i.doc_no, 'invoice_id', i.id)
    from avo.invoice_lines il join avo.invoices i on i.id = il.invoice_id join avo.customers c on c.id = i.customer_id
    where il.lot_id = l.id and not br
  ) q;

  return (avo.lot_json(l.id) - case when br then 'unit_cost' else '' end) || jsonb_build_object(
    'root', case when root.id <> l.id then avo.lot_json(root.id) else null end,
    'receipt', (select jsonb_build_object('id', r.id, 'doc_no', r.doc_no, 'received_at', r.received_at, 'supplier', s.name,
                 'contact', s.contact, 'phone', s.phone, 'province', s.province)
                from avo.receipts r join avo.suppliers s on s.id = r.supplier_id where r.id = root.receipt_id),
    'balances', coalesce((select jsonb_agg(jsonb_build_object('site', st.name, 'zone', b.zone, 'ripeness', b.ripeness, 'kg', b.kg, 'baskets', b.baskets, 'bags', b.bags))
                 from avo.balances b join avo.sites st on st.id = b.site_id where b.lot_id = l.id and (b.kg > 0 or b.bags > 0) and avo.can_see_site(u, b.site_id)), '[]'),
    'destinations', coalesce((select jsonb_agg(jsonb_build_object('doc_no', d.doc_no, 'kind', d.kind, 'to', coalesce(c.name, ts.name),
                 'channel', c.channel, 'kg', dl.kg, 'received_kg', dl.received_kg, 'status', d.status) order by d.shipped_at)
                 from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id left join avo.sites ts on ts.id = d.to_site_id
                 left join avo.customers c on c.id = d.customer_id where dl.lot_id = l.id and d.status <> 'cancelled'
                 and (not br or u.site_id in (d.from_site_id, d.to_site_id))), '[]'),
    'children', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'code', c.code)) from avo.lots c where c.parent_lot_id = l.id), '[]'),
    'open_cases', (select count(*) from avo.cases cs where cs.lot_id = l.id and cs.status = 'open'),
    'events', ev);
end $$;

-- ---------- ตีออก / โอน ----------
create or replace function avo.dispatch_json(p_id bigint) returns jsonb
language sql stable as $$
  select to_jsonb(d) || jsonb_build_object(
    'from_site', fs.name, 'from_site_kind', fs.kind, 'to_site', ts.name, 'customer', c.name, 'channel', c.channel,
    'destination', coalesce(c.name, ts.name),
    'created_by_name', (select display_name from avo.users where id = d.created_by),
    'shipped_by_name', (select display_name from avo.users where id = d.shipped_by),
    'received_by_name', (select display_name from avo.users where id = d.received_by),
    'total_kg', (select coalesce(sum(kg),0) from avo.dispatch_lines where dispatch_id = d.id),
    'total_received_kg', (select sum(received_kg) from avo.dispatch_lines where dispatch_id = d.id),
    'total_baskets', (select coalesce(sum(baskets),0) from avo.dispatch_lines where dispatch_id = d.id),
    'total_billed_kg', (select coalesce(sum(billed_kg),0) from avo.dispatch_lines where dispatch_id = d.id),
    'open_cases', (select count(*) from avo.cases where dispatch_id = d.id and status = 'open'),
    'lines', coalesce((select jsonb_agg(to_jsonb(dl) || jsonb_build_object('lot_code', l.code, 'product', l.product,
        'variety', v.name, 'size', z.name, 'supplier', sp.name, 'unit_cost', l.unit_cost) order by dl.line_no)
       from avo.dispatch_lines dl join avo.lots l on l.id = dl.lot_id left join avo.varieties v on v.id = l.variety_id
       left join avo.sizes z on z.id = l.size_id left join avo.suppliers sp on sp.id = l.supplier_id where dl.dispatch_id = d.id), '[]'),
    'cases', coalesce((select jsonb_agg(to_jsonb(cs) order by cs.id) from avo.cases cs where cs.dispatch_id = d.id), '[]'))
  from avo.dispatches d join avo.sites fs on fs.id = d.from_site_id
  left join avo.sites ts on ts.id = d.to_site_id left join avo.customers c on c.id = d.customer_id
  where d.id = p_id
$$;

create or replace function avo.dispatch_ship(u avo.users, p_id bigint) returns void
language plpgsql as $$
declare d avo.dispatches; dl avo.dispatch_lines; r jsonb; dest text;
begin
  select * into d from avo.dispatches where id = p_id for update;
  if not found then perform avo.fail('ไม่พบใบตีออก'); end if;
  if d.status <> 'draft' then perform avo.fail('ใบตีออก ' || d.doc_no || ' ถูกยืนยันส่งไปแล้ว (กันกดซ้ำ)'); end if;
  if not avo.is_approver(u, d.from_site_id) then perform avo.fail('ต้องให้ผู้จัดการคลัง/สาขา ผู้บริหาร หรือ Admin ยืนยันการตีออก'); end if;
  dest := coalesce((select name from avo.customers where id = d.customer_id), (select name from avo.sites where id = d.to_site_id));
  for dl in select * from avo.dispatch_lines where dispatch_id = d.id order by line_no loop
    r := avo.move(d.from_site_id, d.from_zone, dl.lot_id, dl.ripeness, -dl.kg, -dl.baskets, -dl.bags,
                  'SHIP_OUT', 'DISPATCH', d.id, d.doc_no, u.id, d.note, null, u.id, dest);
    perform avo.move(d.from_site_id, 'transit', dl.lot_id, dl.ripeness, dl.kg, -(r->>'d_baskets')::int, -(r->>'d_bags')::int,
                  'TRANSIT_IN', 'DISPATCH', d.id, d.doc_no, u.id, d.note, null, u.id, dest);
    update avo.dispatch_lines set baskets = -(r->>'d_baskets')::int where id = dl.id;
  end loop;
  update avo.dispatches set status = 'shipped', shipped_by = u.id, shipped_at = now() where id = d.id;
  perform avo.audit(u.id, 'ship', 'dispatch', d.id::text, null);
end $$;

create or replace function public.api_dispatch_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); d avo.dispatches; did bigint := avo.jid(p,'id'); ln jsonb; i int := 0;
  v_kind text := coalesce(p->>'kind','transfer'); v_from bigint := avo.jid(p,'from_site_id'); v_to bigint := avo.jid(p,'to_site_id');
  v_cust bigint := avo.jid(p,'customer_id'); v_fz text; v_tz text; fkind text; tkind text; v_lot bigint; v_rip text; v_kg numeric;
  bal avo.balances; avail numeric; lprod text; lcode text;
begin
  perform avo.need(u, array['warehouse','branch']);
  select kind into fkind from avo.sites where id = v_from;
  if fkind is null then perform avo.fail('กรุณาเลือกต้นทาง'); end if;
  perform avo.need_site(u, v_from);
  v_fz := coalesce(avo.jtxt(p,'from_zone'), case when fkind = 'warehouse' then 'main' else 'back' end);
  if (fkind = 'warehouse' and v_fz not in ('main','frozen')) or (fkind = 'branch' and v_fz not in ('front','back','frozen')) then
    perform avo.fail('จุดจัดเก็บต้นทางไม่ถูกต้อง'); end if;
  if v_kind = 'transfer' then
    select kind into tkind from avo.sites where id = v_to;
    if tkind is null then perform avo.fail('กรุณาเลือกสาขา/คลังปลายทาง'); end if;
    if v_to = v_from then perform avo.fail('ปลายทางต้องต่างจากต้นทาง (ย้ายภายในสาขาให้ใช้ใบโอนภายใน)'); end if;
    v_tz := coalesce(avo.jtxt(p,'to_zone'), case when v_fz = 'frozen' then 'frozen' when tkind = 'warehouse' then 'main' else 'back' end);
    perform avo.check_zone(v_to, v_tz);
    v_cust := null;
  elsif v_kind = 'sale' then
    if v_cust is null or not exists (select 1 from avo.customers where id = v_cust) then perform avo.fail('กรุณาเลือกลูกค้า / ช่องทางขาย'); end if;
    v_to := null; v_tz := null;
  else perform avo.fail('ประเภทใบตีออกไม่ถูกต้อง'); end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then perform avo.fail('กรุณาเลือก Lot อย่างน้อย 1 รายการ'); end if;

  if did is null then
    insert into avo.dispatches(doc_no, kind, from_site_id, from_zone, to_site_id, to_zone, customer_id, carrier, vehicle, packer, note, created_by)
    values (avo.next_no(case when v_kind = 'sale' then 'OUT' else 'TR' end), v_kind, v_from, v_fz, v_to, v_tz, v_cust,
            avo.jtxt(p,'carrier'), avo.jtxt(p,'vehicle'), avo.jtxt(p,'packer'), avo.jtxt(p,'note'), u.id)
    returning * into d;
  else
    if not avo.can_act_site(u, (select from_site_id from avo.dispatches where id = did)) then perform avo.fail('ไม่มีสิทธิ์แก้ไขใบตีออกของสถานที่อื่น'); end if;
    update avo.dispatches set kind = v_kind, from_site_id = v_from, from_zone = v_fz, to_site_id = v_to, to_zone = v_tz, customer_id = v_cust,
      carrier = avo.jtxt(p,'carrier'), vehicle = avo.jtxt(p,'vehicle'), packer = avo.jtxt(p,'packer'), note = avo.jtxt(p,'note')
    where id = did and status = 'draft' returning * into d;
    if not found then perform avo.fail('แก้ไขได้เฉพาะใบตีออกที่ยังเป็นร่าง'); end if;
    delete from avo.dispatch_lines where dispatch_id = d.id;
  end if;

  for ln in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    v_lot := avo.jid(ln,'lot_id'); v_kg := avo.jnum(ln,'kg');
    select product, code into lprod, lcode from avo.lots where id = v_lot and status = 'active';
    if lprod is null then perform avo.fail(format('รายการที่ %s: ไม่พบ Lot ที่ใช้งานได้', i)); end if;
    v_rip := case when lprod = 'frozen' then 'na' else coalesce(ln->>'ripeness','raw') end;
    if (lprod = 'frozen') <> (v_fz = 'frozen') then perform avo.fail(format('รายการที่ %s: สินค้าแช่แข็งต้องตีออกจากจุดแช่แข็ง', i)); end if;
    if v_kg is null or v_kg <= 0 then perform avo.fail(format('รายการที่ %s: กรุณาระบุน้ำหนัก (กก.)', i)); end if;
    if exists (select 1 from avo.dispatch_lines where dispatch_id = d.id and lot_id = v_lot and ripeness = v_rip) then
      perform avo.fail(format('Lot %s (%s) ถูกเลือกซ้ำ', lcode, avo.rip_label(v_rip))); end if;
    select * into bal from avo.balances where site_id = v_from and zone = v_fz and lot_id = v_lot and ripeness = v_rip for update;  -- ล็อกกันจองซ้อนเมื่อหลายคนบันทึกพร้อมกัน
    avail := coalesce(bal.kg, 0) - avo.reserved(v_from, v_fz, v_lot, v_rip, d.id);
    if v_kg > avail then
      perform avo.fail(format('ห้ามจ่ายเกินยอดพร้อมใช้: %s (%s) พร้อมจ่าย %s กก. แต่ขอ %s กก.', lcode, avo.rip_label(v_rip), avo.n(greatest(avail,0)), avo.n(v_kg)));
    end if;
    insert into avo.dispatch_lines(dispatch_id, line_no, lot_id, ripeness, kg, baskets, bags)
    values (d.id, i, v_lot, v_rip, v_kg, coalesce(avo.jint(ln,'baskets'),0), coalesce(avo.jint(ln,'bags'),0));
  end loop;

  perform avo.audit(u.id, case when did is null then 'create' else 'update' end, 'dispatch', d.id::text, null);
  if coalesce((p->>'ship')::boolean, false) then perform avo.dispatch_ship(u, d.id); end if;
  return avo.dispatch_json(d.id);
end $$;

create or replace function public.api_dispatch_ship(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['warehouse','branch','executive']);
  perform avo.dispatch_ship(u, avo.jid(p,'id'));
  return avo.dispatch_json(avo.jid(p,'id'));
end $$;

create or replace function public.api_dispatch_cancel(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); d avo.dispatches;
begin
  perform avo.need(u, array['warehouse','branch']);
  select * into d from avo.dispatches where id = avo.jid(p,'id') for update;
  if not found or d.status <> 'draft' then perform avo.fail('ยกเลิกได้เฉพาะใบตีออกที่ยังเป็นร่าง (ถ้าส่งแล้วให้ใช้การรับคืน/สรุปส่วนต่าง)'); end if;
  perform avo.need_site(u, d.from_site_id);
  update avo.dispatches set status = 'cancelled', note = coalesce(note || ' · ', '') || 'ยกเลิก: ' || coalesce(avo.jtxt(p,'reason'),'-') where id = d.id;
  perform avo.audit(u.id, 'cancel', 'dispatch', d.id::text, p);
  return avo.dispatch_json(d.id);
end $$;

-- ปลายทางยืนยันรับตามน้ำหนักจริง หากขาดจะเปิดงานตรวจสอบส่วนต่างอัตโนมัติ
create or replace function public.api_dispatch_receive(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); d avo.dispatches; dl avo.dispatch_lines; ln jsonb; rk numeric; rb int; rg int; r jsonb;
  partial boolean := false; src text; need_photo boolean;
begin
  select * into d from avo.dispatches where id = avo.jid(p,'id') for update;
  if not found then perform avo.fail('ไม่พบใบตีออก'); end if;
  if d.status <> 'shipped' then perform avo.fail('ใบ ' || d.doc_no || ' ไม่ได้อยู่ในสถานะ "ส่งแล้ว รอรับ" (อาจรับไปแล้ว)'); end if;
  if d.kind = 'transfer' then
    if not (u.role = 'admin' or avo.can_act_site(u, d.to_site_id)) then perform avo.fail('ต้องเป็นผู้ใช้ของสาขาปลายทางจึงยืนยันรับได้'); end if;
  else
    if not (u.role in ('admin','warehouse','sales') or avo.can_act_site(u, d.from_site_id)) then
      perform avo.fail('ต้องเป็นคลัง ฝ่ายขาย หรือสาขาต้นทางจึงบันทึกการส่งมอบลูกค้าได้'); end if;
  end if;
  if avo.jtxt(p,'receiver_name') is null then perform avo.fail('กรุณาระบุชื่อผู้รับสินค้า'); end if;
  need_photo := coalesce((avo.setting('options')->>'require_receive_photo')::boolean, true);
  if need_photo and avo.jtxt(p,'evidence') is null then perform avo.fail('กรุณาแนบรูปสภาพสินค้าเมื่อถึงปลายทาง'); end if;
  src := (select name from avo.sites where id = d.from_site_id);

  for dl in select * from avo.dispatch_lines where dispatch_id = d.id order by line_no loop
    select x into ln from jsonb_array_elements(coalesce(p->'lines','[]')) x where (x->>'id')::bigint = dl.id;
    rk := coalesce(avo.jnum(ln,'received_kg'), dl.kg);
    rb := least(coalesce(avo.jint(ln,'received_baskets'), dl.baskets), dl.baskets);
    rg := least(coalesce(avo.jint(ln,'received_bags'), dl.bags), dl.bags);
    if rk < 0 or rk > dl.kg then perform avo.fail(format('บรรทัด %s: น้ำหนักรับจริงต้องอยู่ระหว่าง 0 ถึง %s กก.', dl.line_no, avo.n(dl.kg))); end if;
    if rk = 0 then rb := 0; rg := 0; end if;
    r := avo.move(d.from_site_id, 'transit', dl.lot_id, dl.ripeness, -rk, -rb, -rg,
                  case when d.kind = 'sale' then 'DELIVERED' else 'TRANSIT_OUT' end, 'DISPATCH', d.id, d.doc_no, u.id,
                  avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, avo.jtxt(p,'receiver_name'), coalesce((p->>'received_at')::timestamptz, now()));
    if d.kind = 'transfer' then
      perform avo.move(d.to_site_id, d.to_zone, dl.lot_id, dl.ripeness, rk, -(r->>'d_baskets')::int, -(r->>'d_bags')::int,
                       'TRANSFER_IN', 'DISPATCH', d.id, d.doc_no, u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, src,
                       coalesce((p->>'received_at')::timestamptz, now()));
    end if;
    update avo.dispatch_lines set received_kg = rk, received_baskets = rb, received_bags = rg where id = dl.id;
    if rk < dl.kg then
      partial := true;
      insert into avo.cases(doc_no, dispatch_id, dispatch_line_id, lot_id, ripeness, kg, baskets, bags, note)
      values (avo.next_no('CASE'), d.id, dl.id, dl.lot_id, dl.ripeness, dl.kg - rk, greatest(dl.baskets - rb, 0), greatest(dl.bags - rg, 0),
              coalesce(avo.jtxt(ln,'note'), avo.jtxt(p,'note')));
    end if;
  end loop;

  update avo.dispatches set status = case when partial then 'partial' else 'received' end,
    receiver_name = avo.jtxt(p,'receiver_name'), received_by = u.id,
    received_at = coalesce((p->>'received_at')::timestamptz, now()), receive_note = avo.jtxt(p,'note'), evidence = avo.jtxt(p,'evidence')
  where id = d.id;
  perform avo.audit(u.id, 'receive', 'dispatch', d.id::text, jsonb_build_object('partial', partial));
  return avo.dispatch_json(d.id);
end $$;

-- สรุปส่วนต่าง: สูญเสีย / ส่งคืนต้นทาง / ส่งตามภายหลัง
create or replace function public.api_case_resolve(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); c avo.cases; d avo.dispatches; o text := p->>'outcome'; r jsonb; dest text;
begin
  select * into c from avo.cases where id = avo.jid(p,'id') for update;
  if not found then perform avo.fail('ไม่พบงานตรวจสอบ'); end if;
  if c.status <> 'open' then perform avo.fail('งานนี้ปิดไปแล้ว'); end if;
  select * into d from avo.dispatches where id = c.dispatch_id for update;
  if not (avo.is_approver(u, d.from_site_id) or (d.to_site_id is not null and avo.is_approver(u, d.to_site_id))) then
    perform avo.fail('ต้องเป็นผู้จัดการ ผู้บริหาร หรือ Admin จึงปิดงานส่วนต่างได้'); end if;
  if o not in ('loss','return','late_delivery') then perform avo.fail('กรุณาเลือกผลสรุป'); end if;
  if avo.jtxt(p,'note') is null then perform avo.fail('กรุณาระบุเหตุผล'); end if;
  dest := coalesce((select name from avo.customers where id = d.customer_id), (select name from avo.sites where id = d.to_site_id));

  if o = 'loss' then
    perform avo.move(d.from_site_id, 'transit', c.lot_id, c.ripeness, -c.kg, -c.baskets, -c.bags, 'CASE_LOSS', 'CASE', c.id, c.doc_no,
                     u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, dest);
  elsif o = 'return' then
    r := avo.move(d.from_site_id, 'transit', c.lot_id, c.ripeness, -c.kg, -c.baskets, -c.bags, 'CASE_RETURN', 'CASE', c.id, c.doc_no,
                  u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, dest);
    perform avo.move(d.from_site_id, d.from_zone, c.lot_id, c.ripeness, c.kg, -(r->>'d_baskets')::int, -(r->>'d_bags')::int, 'RETURN_IN', 'CASE', c.id, c.doc_no,
                     u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, dest);
  else
    r := avo.move(d.from_site_id, 'transit', c.lot_id, c.ripeness, -c.kg, -c.baskets, -c.bags,
                  case when d.kind = 'sale' then 'DELIVERED' else 'TRANSIT_OUT' end, 'CASE', c.id, c.doc_no,
                  u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, dest);
    if d.kind = 'transfer' then
      perform avo.move(d.to_site_id, d.to_zone, c.lot_id, c.ripeness, c.kg, -(r->>'d_baskets')::int, -(r->>'d_bags')::int, 'TRANSFER_IN', 'CASE', c.id, c.doc_no,
                       u.id, avo.jtxt(p,'note'), avo.jtxt(p,'evidence'), u.id, (select name from avo.sites where id = d.from_site_id));
    end if;
    update avo.dispatch_lines set received_kg = received_kg + c.kg, received_baskets = received_baskets + c.baskets,
           received_bags = coalesce(received_bags,0) + c.bags where id = c.dispatch_line_id;
  end if;

  update avo.cases set status = 'resolved', outcome = o, resolve_note = avo.jtxt(p,'note'), evidence = avo.jtxt(p,'evidence'),
         resolved_by = u.id, resolved_at = now() where id = c.id;
  if not exists (select 1 from avo.cases where dispatch_id = d.id and status = 'open') then
    update avo.dispatches set status = 'closed' where id = d.id;
  end if;
  perform avo.audit(u.id, 'resolve', 'case', c.id::text, p);
  return avo.dispatch_json(d.id);
end $$;

create or replace function public.api_dispatches(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q text := lower(avo.jtxt(p,'q'));
begin
  return coalesce((select jsonb_agg(avo.dispatch_json(d.id) - 'cases' order by d.created_at desc, d.id desc)
    from avo.dispatches d left join avo.customers c on c.id = d.customer_id left join avo.sites ts on ts.id = d.to_site_id
    where (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id)))
      and (avo.jtxt(p,'status') is null or d.status = any(string_to_array(p->>'status', ',')))
      and (avo.jtxt(p,'kind') is null or d.kind = p->>'kind')
      and (avo.jid(p,'site_id') is null or d.from_site_id = avo.jid(p,'site_id') or d.to_site_id = avo.jid(p,'site_id'))
      and (avo.jid(p,'to_site_id') is null or d.to_site_id = avo.jid(p,'to_site_id'))
      and (avo.jid(p,'customer_id') is null or d.customer_id = avo.jid(p,'customer_id'))
      and (avo.jtxt(p,'from') is null or (d.created_at at time zone 'Asia/Bangkok')::date >= (p->>'from')::date)
      and (avo.jtxt(p,'to') is null or (d.created_at at time zone 'Asia/Bangkok')::date <= (p->>'to')::date)
      and (q is null or lower(d.doc_no) like '%'||q||'%' or lower(coalesce(c.name, ts.name, '')) like '%'||q||'%'
           or exists (select 1 from avo.dispatch_lines dl join avo.lots l on l.id = dl.lot_id where dl.dispatch_id = d.id and lower(l.code) like '%'||q||'%'))), '[]');
end $$;

create or replace function public.api_dispatch_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); d avo.dispatches;
begin
  select * into d from avo.dispatches where id = avo.jid(p,'id');
  if not (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id))) then perform avo.fail('ไม่มีสิทธิ์ดูเอกสารนี้'); end if;
  return avo.dispatch_json(avo.jid(p,'id'));
end $$;

create or replace function public.api_cases(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  return coalesce((select jsonb_agg(to_jsonb(c) || jsonb_build_object('dispatch_no', d.doc_no, 'lot_code', l.code,
      'from_site', fs.name, 'destination', coalesce(cu.name, ts.name), 'shipped_kg', dl.kg, 'received_kg', dl.received_kg,
      'resolved_by_name', (select display_name from avo.users where id = c.resolved_by)) order by c.status, c.created_at desc)
    from avo.cases c join avo.dispatches d on d.id = c.dispatch_id join avo.dispatch_lines dl on dl.id = c.dispatch_line_id
    join avo.lots l on l.id = c.lot_id join avo.sites fs on fs.id = d.from_site_id
    left join avo.sites ts on ts.id = d.to_site_id left join avo.customers cu on cu.id = d.customer_id
    where (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id)))
      and (avo.jtxt(p,'status') is null or c.status = p->>'status')), '[]');
end $$;

-- ---------- สต็อกสาขา ----------
create or replace function public.api_branch_stock(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); sid bigint := coalesce(avo.jid(p,'site_id'), u.site_id);
begin
  if sid is null then select id into sid from avo.sites where kind = 'branch' and active order by sort, id limit 1; end if;
  if sid is null then return jsonb_build_object('site', null); end if;
  if not avo.can_see_site(u, sid) then perform avo.fail('ไม่มีสิทธิ์ดูสาขานี้'); end if;
  return jsonb_build_object(
    'site', (select to_jsonb(s) from avo.sites s where s.id = sid),
    'zones', coalesce((select jsonb_object_agg(z, rows) from (
        select b.zone z, jsonb_agg(jsonb_build_object('ripeness', b.ripeness, 'kg', b.kg, 'baskets', b.baskets, 'bags', b.bags, 'lots', b.lots)
                                   order by avo.rip_rank(b.ripeness) desc) rows
        from (select zone, ripeness, sum(kg) kg, sum(baskets) baskets, sum(bags) bags, count(distinct lot_id) lots
              from avo.balances where site_id = sid and zone <> 'transit' and (kg > 0 or bags > 0) group by zone, ripeness) b
        group by b.zone) t), '{}'),
    'incoming', coalesce((select jsonb_agg(avo.dispatch_json(d.id) order by d.shipped_at)
        from avo.dispatches d where d.to_site_id = sid and d.status in ('shipped','partial')), '[]'),
    'recent', coalesce((select jsonb_agg(x) from (select avo.dispatch_json(d.id) - 'cases' x from avo.dispatches d
        where d.to_site_id = sid and d.status in ('received','closed') order by d.received_at desc limit 10) q), '[]'),
    'pending_adjustments', (select count(*) from avo.adjustments where site_id = sid and status = 'pending'));
end $$;

-- ใบโอนภายใน (หลังร้าน ↔ หน้าร้าน ฯลฯ)
create or replace function public.api_zone_transfer(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); sid bigint := avo.jid(p,'site_id'); fz text := p->>'from_zone'; tz text := p->>'to_zone';
  v_lot bigint := avo.jid(p,'lot_id'); v_rip text; kg numeric := avo.jnum(p,'kg'); sk text; lprod text; no text; rid bigint; r jsonb;
begin
  perform avo.need(u, array['warehouse','branch']);
  perform avo.need_site(u, sid);
  select kind into sk from avo.sites where id = sid;
  select product into lprod from avo.lots where id = v_lot;
  if fz = tz then perform avo.fail('จุดต้นทางและปลายทางต้องต่างกัน'); end if;
  if (sk = 'branch' and (fz not in ('front','back','frozen') or tz not in ('front','back','frozen')))
     or (sk = 'warehouse' and (fz not in ('main','frozen') or tz not in ('main','frozen'))) then
    perform avo.fail('จุดจัดเก็บไม่ถูกต้องสำหรับสถานที่นี้'); end if;
  if (lprod = 'frozen') <> (tz = 'frozen') or (lprod = 'frozen') <> (fz = 'frozen') then
    perform avo.fail('สินค้าสดย้ายเข้าแช่แข็งต้องใช้ "แปรรูปแช่แข็ง" และสินค้าแช่แข็งอยู่ได้เฉพาะจุดแช่แข็ง'); end if;
  if kg is null or kg <= 0 then perform avo.fail('กรุณาระบุน้ำหนัก'); end if;
  v_rip := case when lprod = 'frozen' then 'na' else coalesce(p->>'ripeness','raw') end;
  perform avo.need_free(sid, fz, v_lot, v_rip, kg);
  no := avo.next_no('ZT');
  insert into avo.internal_transfers(doc_no, site_id, from_zone, to_zone, lot_id, ripeness, kg, baskets, bags, note, created_by)
  values (no, sid, fz, tz, v_lot, v_rip, kg, coalesce(avo.jint(p,'baskets'),0), coalesce(avo.jint(p,'bags'),0), avo.jtxt(p,'note'), u.id)
  returning id into rid;
  r := avo.move(sid, fz, v_lot, v_rip, -kg, -coalesce(avo.jint(p,'baskets'),0), -coalesce(avo.jint(p,'bags'),0), 'ZONE_OUT', 'ZONE', rid, no, u.id, avo.jtxt(p,'note'));
  perform avo.move(sid, tz, v_lot, v_rip, kg, -(r->>'d_baskets')::int, -(r->>'d_bags')::int, 'ZONE_IN', 'ZONE', rid, no, u.id, avo.jtxt(p,'note'));
  return jsonb_build_object('id', rid, 'doc_no', no);
end $$;

-- แปรรูปแช่แข็ง: บันทึกวัตถุดิบที่ใช้ ผลผลิต (ถุง/กก.) และส่วนสูญเสีย → สร้าง Lot แช่แข็งที่อ้างอิง Lot ต้นทาง
create or replace function public.api_freeze(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); sid bigint := avo.jid(p,'site_id'); fz text := coalesce(avo.jtxt(p,'from_zone'),'back');
  src avo.lots; inkg numeric := avo.jnum(p,'input_kg'); outkg numeric := avo.jnum(p,'output_kg'); bags int := avo.jint(p,'bags');
  no text; fid bigint; nlot bigint; ncode text; v_rip text := coalesce(p->>'ripeness','ripe'); r jsonb;
begin
  perform avo.need(u, array['warehouse','branch']);
  perform avo.need_site(u, sid);
  select * into src from avo.lots where id = avo.jid(p,'lot_id');
  if not found or src.product <> 'fresh' then perform avo.fail('ต้องเลือก Lot สินค้าสดเป็นวัตถุดิบ'); end if;
  if fz not in ('main','front','back') then perform avo.fail('จุดวัตถุดิบไม่ถูกต้อง'); end if;
  if inkg is null or inkg <= 0 then perform avo.fail('กรุณาระบุน้ำหนักวัตถุดิบที่ใช้'); end if;
  if outkg is null or outkg <= 0 then perform avo.fail('กรุณาระบุน้ำหนักผลผลิตที่ได้'); end if;
  if outkg > inkg then perform avo.fail('ผลผลิตต้องไม่มากกว่าวัตถุดิบ'); end if;
  if bags is null or bags <= 0 then perform avo.fail('กรุณาระบุจำนวนถุง'); end if;
  perform avo.check_zone(sid, fz);
  perform avo.need_free(sid, fz, src.id, v_rip, inkg);
  no := avo.next_no('FRZ');
  ncode := src.code || '-F' || ((select count(*) from avo.lots where parent_lot_id = src.id) + 1);
  insert into avo.lots(code, product, variety_id, size_id, supplier_id, receipt_id, parent_lot_id, received_at, unit_cost, status)
  values (ncode, 'frozen', src.variety_id, src.size_id, src.supplier_id, src.receipt_id, src.id, now(), round(src.unit_cost * inkg / outkg, 4), 'active')
  returning id into nlot;
  insert into avo.freezes(doc_no, site_id, from_zone, source_lot_id, ripeness, input_kg, input_baskets, output_kg, bags, output_lot_id, note, created_by)
  values (no, sid, fz, src.id, v_rip, inkg, coalesce(avo.jint(p,'input_baskets'),0), outkg, bags, nlot, avo.jtxt(p,'note'), u.id) returning id into fid;
  perform avo.move(sid, fz, src.id, v_rip, -inkg, -coalesce(avo.jint(p,'input_baskets'),0), 0, 'FREEZE_CONSUME', 'FREEZE', fid, no, u.id,
                   format('ได้ %s กก. / %s ถุง · สูญเสีย %s กก.', avo.n(outkg), bags, avo.n(inkg - outkg)));
  perform avo.move(sid, 'frozen', nlot, 'na', outkg, 0, bags, 'FREEZE_PRODUCE', 'FREEZE', fid, no, u.id, 'จาก ' || src.code);
  perform avo.audit(u.id, 'create', 'freeze', fid::text, p);
  return jsonb_build_object('id', fid, 'doc_no', no, 'lot_code', ncode, 'loss_kg', inkg - outkg);
end $$;

-- ขายหน้าร้าน / นำไปใช้ (ตัดทันที)  ·  ตัดทิ้ง / ปรับยอด (ต้องผู้จัดการอนุมัติ)
create or replace function public.api_adjust_request(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); k text := p->>'kind'; sid bigint := avo.jid(p,'site_id'); z text := coalesce(avo.jtxt(p,'zone'),'front');
  v_lot bigint := avo.jid(p,'lot_id'); lprod text; v_rip text; kg numeric := avo.jnum(p,'kg'); a avo.adjustments; bal numeric;
  bk int := coalesce(avo.jint(p,'baskets'),0); bg int := coalesce(avo.jint(p,'bags'),0); need_photo boolean;
begin
  perform avo.need(u, array['warehouse','branch']);
  perform avo.need_site(u, sid);
  if k not in ('retail_sale','internal_use','waste','count_adjust') then perform avo.fail('ประเภทรายการไม่ถูกต้อง'); end if;
  select product into lprod from avo.lots where id = v_lot;
  if lprod is null then perform avo.fail('กรุณาเลือก Lot'); end if;
  v_rip := case when lprod = 'frozen' then 'na' else coalesce(p->>'ripeness','ripe') end;
  if kg is null or kg = 0 then perform avo.fail('กรุณาระบุน้ำหนัก'); end if;
  if k <> 'count_adjust' then kg := -abs(kg); bk := -abs(bk); bg := -abs(bg); end if;
  if k in ('waste','count_adjust') and avo.jtxt(p,'reason') is null then perform avo.fail('กรุณาระบุเหตุผล'); end if;
  need_photo := coalesce((avo.setting('options')->>'require_waste_photo')::boolean, true);
  if k = 'waste' and need_photo and avo.jtxt(p,'evidence') is null then perform avo.fail('กรุณาแนบรูปสินค้าที่ตัดทิ้ง'); end if;
  perform avo.check_zone(sid, z);
  if kg < 0 then perform avo.need_free(sid, z, v_lot, v_rip, -kg); end if;

  insert into avo.adjustments(doc_no, kind, site_id, zone, lot_id, ripeness, kg, baskets, bags, amount, reason, evidence, status, requested_by)
  values (avo.next_no(case k when 'retail_sale' then 'POS' when 'internal_use' then 'USE' when 'waste' then 'WST' else 'ADJ' end),
          k, sid, z, v_lot, v_rip, kg, bk, bg, avo.jnum(p,'amount'), avo.jtxt(p,'reason'), avo.jtxt(p,'evidence'), 'pending', u.id)
  returning * into a;
  if k in ('retail_sale','internal_use') then
    perform avo.move(sid, z, v_lot, v_rip, kg, bk, bg, upper(k), 'ADJUST', a.id, a.doc_no, u.id, a.reason, a.evidence);
    update avo.adjustments set status = 'applied', decided_by = u.id, decided_at = now() where id = a.id returning * into a;
  end if;
  return to_jsonb(a);
end $$;

create or replace function public.api_adjust_decide(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); a avo.adjustments; ok boolean := coalesce((p->>'approve')::boolean, false);
begin
  select * into a from avo.adjustments where id = avo.jid(p,'id') for update;
  if not found then perform avo.fail('ไม่พบรายการ'); end if;
  if a.status <> 'pending' then perform avo.fail('รายการนี้ได้รับการพิจารณาแล้ว'); end if;
  if not avo.is_approver(u, a.site_id) then perform avo.fail('ต้องเป็นผู้จัดการสาขา/คลัง ผู้บริหาร หรือ Admin จึงอนุมัติได้'); end if;
  if a.requested_by = u.id and u.role <> 'admin' then perform avo.fail('ผู้ขอไม่สามารถอนุมัติรายการของตัวเองได้'); end if;
  if ok then
    if a.kg < 0 then perform avo.need_free(a.site_id, a.zone, a.lot_id, a.ripeness, -a.kg); end if;
    perform avo.move(a.site_id, a.zone, a.lot_id, a.ripeness, a.kg, a.baskets, a.bags,
                     case when a.kind = 'waste' then 'WASTE' else 'ADJUST' end, 'ADJUST', a.id, a.doc_no,
                     a.requested_by, a.reason, a.evidence, u.id);
  end if;
  update avo.adjustments set status = case when ok then 'applied' else 'rejected' end, decided_by = u.id, decided_at = now(),
         decision_note = avo.jtxt(p,'note') where id = a.id returning * into a;
  perform avo.audit(u.id, case when ok then 'approve' else 'reject' end, 'adjustment', a.id::text, p);
  return to_jsonb(a);
end $$;

create or replace function public.api_adjustments(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  return coalesce((select jsonb_agg(x order by x->>'requested_at' desc) from (
    select to_jsonb(a) || jsonb_build_object('site', st.name, 'lot_code', l.code, 'variety', v.name, 'size', z.name,
      'requested_by_name', ra.display_name, 'decided_by_name', rb.display_name) x
    from avo.adjustments a join avo.sites st on st.id = a.site_id join avo.lots l on l.id = a.lot_id
    left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    left join avo.users ra on ra.id = a.requested_by left join avo.users rb on rb.id = a.decided_by
    where avo.can_see_site(u, a.site_id)
      and (avo.jtxt(p,'status') is null or a.status = p->>'status')
      and (avo.jid(p,'site_id') is null or a.site_id = avo.jid(p,'site_id'))
      and (avo.jtxt(p,'kind') is null or a.kind = p->>'kind')
    order by a.requested_at desc limit 300) t), '[]');
end $$;

-- ==== sql/05_api_sales.sql ====
-- =====================================================================
-- 05_api_sales.sql : ใบเสนอราคา บิล แจ้งเตือน แดชบอร์ด รายงาน
-- บิลและใบเสนอราคา "ไม่" ตัดสต็อก (สต็อกลดตอนตีออก/ส่งมอบแล้ว)
-- =====================================================================

create or replace function avo.totals(p_sub numeric, p_disc numeric, p_ship numeric, p_rate numeric) returns jsonb
language sql immutable as $$
  select jsonb_build_object('subtotal', round(p_sub,2), 'discount', round(coalesce(p_disc,0),2), 'shipping', round(coalesce(p_ship,0),2),
    'vat', round((p_sub - coalesce(p_disc,0) + coalesce(p_ship,0)) * coalesce(p_rate,0) / 100, 2),
    'total', round((p_sub - coalesce(p_disc,0) + coalesce(p_ship,0)) * (1 + coalesce(p_rate,0) / 100), 2))
$$;

create or replace function avo.check_discount(u avo.users, p_sub numeric, p_disc numeric, p_rate numeric) returns void
language plpgsql stable as $$
declare mx numeric := coalesce((avo.setting('options')->>'max_sales_discount_pct')::numeric, 5);
begin
  if coalesce(p_disc,0) < 0 then perform avo.fail('ส่วนลดต้องไม่ติดลบ'); end if;
  if coalesce(p_disc,0) > p_sub then perform avo.fail('ส่วนลดต้องไม่เกินยอดสินค้า'); end if;
  if coalesce(p_rate,0) not in (0, 7) then perform avo.fail('VAT ต้องเป็น 0% หรือ 7%'); end if;
  if u.role not in ('admin','executive') and p_sub > 0 and coalesce(p_disc,0) * 100 / p_sub > mx then
    perform avo.fail(format('ฝ่ายขายให้ส่วนลดได้ไม่เกิน %s%% ของยอดสินค้า', avo.n(mx))); end if;
end $$;

-- ---------- ใบเสนอราคา ----------
create or replace function avo.quote_json(p_id bigint) returns jsonb
language sql stable as $$
  select to_jsonb(q) || jsonb_build_object('customer', c.name, 'customer_address', c.address, 'customer_tax_id', c.tax_id, 'customer_phone', c.phone,
    'created_by_name', (select display_name from avo.users where id = q.created_by),
    'lines', coalesce((select jsonb_agg(to_jsonb(ql) || jsonb_build_object('variety', v.name, 'size', z.name) order by ql.line_no)
       from avo.quote_lines ql join avo.varieties v on v.id = ql.variety_id join avo.sizes z on z.id = ql.size_id where ql.quote_id = q.id), '[]'))
  from avo.quotes q join avo.customers c on c.id = q.customer_id where q.id = p_id
$$;

create or replace function public.api_quote_save(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q avo.quotes; qid bigint := avo.jid(p,'id'); ln jsonb; i int := 0; sub numeric := 0; t jsonb;
  v_cust bigint := avo.jid(p,'customer_id'); v_kg numeric; pr numeric;
begin
  perform avo.need(u, array['sales','executive']);
  if v_cust is null then perform avo.fail('กรุณาเลือกลูกค้า'); end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then perform avo.fail('กรุณาเพิ่มรายการสินค้า'); end if;
  if qid is null then
    insert into avo.quotes(doc_no, customer_id, doc_date, valid_until, note, created_by)
    values (avo.next_no('QT'), v_cust, coalesce((p->>'doc_date')::date, (now() at time zone 'Asia/Bangkok')::date),
            (p->>'valid_until')::date, avo.jtxt(p,'note'), u.id) returning * into q;
  else
    update avo.quotes set customer_id = v_cust, doc_date = coalesce((p->>'doc_date')::date, doc_date), valid_until = (p->>'valid_until')::date,
           note = avo.jtxt(p,'note') where id = qid and status in ('draft','sent') returning * into q;
    if not found then perform avo.fail('แก้ไขได้เฉพาะใบเสนอราคาที่ยังไม่ปิด'); end if;
    delete from avo.quote_lines where quote_id = q.id;
  end if;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1; v_kg := avo.jnum(ln,'kg'); pr := avo.jnum(ln,'price');
    if v_kg is null or v_kg <= 0 then perform avo.fail(format('รายการที่ %s: กรุณาระบุจำนวน กก.', i)); end if;
    perform avo.check_price(u, v_cust, avo.jid(ln,'variety_id'), avo.jid(ln,'size_id'), coalesce(avo.jtxt(ln,'product'),'fresh'), pr);
    insert into avo.quote_lines(quote_id, line_no, variety_id, size_id, kg, price, amount)
    values (q.id, i, avo.jid(ln,'variety_id'), avo.jid(ln,'size_id'), v_kg, pr, round(v_kg * pr, 2));
    sub := sub + round(v_kg * pr, 2);
  end loop;
  perform avo.check_discount(u, sub, avo.jnum(p,'discount'), avo.jnum(p,'vat_rate'));
  t := avo.totals(sub, avo.jnum(p,'discount'), avo.jnum(p,'shipping'), avo.jnum(p,'vat_rate'));
  update avo.quotes set subtotal = (t->>'subtotal')::numeric, discount = (t->>'discount')::numeric, shipping = (t->>'shipping')::numeric,
    vat_rate = coalesce(avo.jnum(p,'vat_rate'),0), vat = (t->>'vat')::numeric, total = (t->>'total')::numeric,
    status = coalesce(avo.jtxt(p,'status'), status) where id = q.id;
  return avo.quote_json(q.id);
end $$;

create or replace function public.api_quote_status(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q avo.quotes;
begin
  perform avo.need(u, array['sales','executive']);
  if p->>'status' not in ('draft','sent','accepted','cancelled') then perform avo.fail('สถานะไม่ถูกต้อง'); end if;
  select * into q from avo.quotes where id = avo.jid(p,'id') for update;
  if not found then perform avo.fail('ไม่พบใบเสนอราคา'); end if;
  if q.status in ('accepted','cancelled') then perform avo.fail('ใบเสนอราคานี้ปิดแล้ว เปลี่ยนสถานะไม่ได้'); end if;
  update avo.quotes set status = p->>'status' where id = q.id;
  return avo.quote_json(avo.jid(p,'id'));
end $$;

create or replace function public.api_quotes(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin perform avo.need(u, array['warehouse','sales','executive']);
  return coalesce((select jsonb_agg(avo.quote_json(q.id) - 'lines' order by q.doc_date desc, q.id desc) from avo.quotes q
    where (avo.jid(p,'customer_id') is null or q.customer_id = avo.jid(p,'customer_id'))), '[]');
end $$;

create or replace function public.api_quote_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin perform avo.need(u, array['warehouse','sales','executive']); return avo.quote_json(avo.jid(p,'id')); end $$;

-- ---------- บิล ----------
-- รายการที่ส่งมอบแล้วและยังออกบิลไม่ครบ
create or replace function public.api_billable(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin perform avo.need(u, array['warehouse','sales','executive']);
  return coalesce((select jsonb_agg(jsonb_build_object('dispatch_line_id', dl.id, 'dispatch_id', d.id, 'dispatch_no', d.doc_no,
      'customer_id', d.customer_id, 'customer', c.name, 'channel', c.channel, 'delivered_at', d.received_at,
      'lot_id', l.id, 'lot_code', l.code, 'product', l.product, 'variety', v.name, 'size', z.name, 'ripeness', dl.ripeness,
      'shipped_kg', dl.kg, 'received_kg', dl.received_kg, 'billed_kg', dl.billed_kg, 'billable_kg', dl.received_kg - dl.billed_kg,
      'price', avo.price_for(d.customer_id, l.variety_id, l.size_id, l.product), 'unit_cost', l.unit_cost)
      order by d.received_at, d.id, dl.line_no)
    from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id join avo.customers c on c.id = d.customer_id
    join avo.lots l on l.id = dl.lot_id left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    where d.kind = 'sale' and d.status in ('received','partial','closed') and dl.received_kg > dl.billed_kg
      and (avo.jid(p,'customer_id') is null or d.customer_id = avo.jid(p,'customer_id'))
      and (avo.jid(p,'dispatch_id') is null or d.id = avo.jid(p,'dispatch_id'))), '[]');
end $$;

create or replace function avo.invoice_json(p_id bigint) returns jsonb
language sql stable as $$
  select to_jsonb(i) || jsonb_build_object('customer', c.name, 'customer_address', c.address, 'customer_tax_id', c.tax_id,
    'customer_phone', c.phone, 'channel', c.channel,
    'created_by_name', (select display_name from avo.users where id = i.created_by),
    'gross_profit', i.subtotal - i.discount - i.cost_total,
    'dispatches', (select string_agg(distinct d.doc_no, ', ') from avo.invoice_lines il join avo.dispatch_lines dl on dl.id = il.dispatch_line_id
                   join avo.dispatches d on d.id = dl.dispatch_id where il.invoice_id = i.id),
    'lines', coalesce((select jsonb_agg(to_jsonb(il) || jsonb_build_object('lot_code', l.code, 'product', l.product,
        'variety', v.name, 'size', z.name, 'dispatch_no', d.doc_no, 'dispatch_id', d.id,
        'delivered_kg', dl.received_kg, 'shipped_kg', dl.kg,
        'receipt_no', r.doc_no, 'supplier', sp.name, 'received_at', rl.received_at) order by il.line_no)
       from avo.invoice_lines il join avo.lots l on l.id = il.lot_id
       join avo.dispatch_lines dl on dl.id = il.dispatch_line_id join avo.dispatches d on d.id = dl.dispatch_id
       left join avo.lots rl on rl.id = coalesce(l.parent_lot_id, l.id)
       left join avo.receipts r on r.id = rl.receipt_id left join avo.suppliers sp on sp.id = rl.supplier_id
       left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
       where il.invoice_id = i.id), '[]'))
  from avo.invoices i join avo.customers c on c.id = i.customer_id where i.id = p_id
$$;

create or replace function public.api_invoice_create(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); inv avo.invoices; ln jsonb; i int := 0; sub numeric := 0; v_cost numeric := 0; t jsonb;
  v_cust bigint := avo.jid(p,'customer_id'); dl avo.dispatch_lines; d avo.dispatches; l avo.lots; v_kg numeric; pr numeric; lp numeric;
begin
  perform avo.need(u, array['sales','executive']);
  if v_cust is null then perform avo.fail('กรุณาเลือกลูกค้า'); end if;
  if jsonb_array_length(coalesce(p->'lines','[]')) = 0 then perform avo.fail('กรุณาเลือกรายการจากใบตีออกที่ส่งมอบแล้ว'); end if;
  insert into avo.invoices(doc_no, title, customer_id, doc_date, note, created_by)
  values (avo.next_no('INV'), coalesce(avo.jtxt(p,'title'), 'ใบส่งของ / ใบแจ้งหนี้'), v_cust,
          coalesce((p->>'doc_date')::date, (now() at time zone 'Asia/Bangkok')::date), avo.jtxt(p,'note'), u.id)
  returning * into inv;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1; v_kg := avo.jnum(ln,'kg'); pr := avo.jnum(ln,'price');
    select * into dl from avo.dispatch_lines where id = avo.jid(ln,'dispatch_line_id') for update;
    if not found then perform avo.fail(format('รายการที่ %s: ไม่พบรายการส่งสินค้า', i)); end if;
    select * into d from avo.dispatches where id = dl.dispatch_id;
    if d.kind <> 'sale' then perform avo.fail('การโอนไปสาขาไม่ถือเป็นยอดขาย ออกบิลไม่ได้'); end if;
    if d.customer_id <> v_cust then perform avo.fail('รวมบิลได้เฉพาะใบตีออกของลูกค้ารายเดียวกัน'); end if;
    if d.status not in ('received','partial','closed') then perform avo.fail(format('ใบ %s ยังไม่ได้ยืนยันส่งมอบ', d.doc_no)); end if;
    if v_kg is null or v_kg <= 0 then perform avo.fail(format('รายการที่ %s: กรุณาระบุจำนวน กก.', i)); end if;
    if v_kg > dl.received_kg - dl.billed_kg then
      perform avo.fail(format('ออกบิลเกินจำนวนที่ส่งมอบจริง: %s คงเหลือให้ออกบิล %s กก. (กันบิลซ้ำ)', d.doc_no, avo.n(dl.received_kg - dl.billed_kg)));
    end if;
    select * into l from avo.lots where id = dl.lot_id;
    lp := avo.check_price(u, v_cust, l.variety_id, l.size_id, l.product, pr);
    update avo.dispatch_lines set billed_kg = billed_kg + v_kg where id = dl.id;
    insert into avo.invoice_lines(invoice_id, line_no, dispatch_line_id, lot_id, kg, price, list_price, amount, cost)
    values (inv.id, i, dl.id, dl.lot_id, v_kg, pr, lp, round(v_kg * pr, 2), round(v_kg * l.unit_cost, 2));
    sub := sub + round(v_kg * pr, 2); v_cost := v_cost + round(v_kg * l.unit_cost, 2);
  end loop;
  perform avo.check_discount(u, sub, avo.jnum(p,'discount'), avo.jnum(p,'vat_rate'));
  t := avo.totals(sub, avo.jnum(p,'discount'), avo.jnum(p,'shipping'), avo.jnum(p,'vat_rate'));
  update avo.invoices set subtotal = (t->>'subtotal')::numeric, discount = (t->>'discount')::numeric, shipping = (t->>'shipping')::numeric,
    vat_rate = coalesce(avo.jnum(p,'vat_rate'),0), vat = (t->>'vat')::numeric, total = (t->>'total')::numeric, cost_total = v_cost
  where id = inv.id;
  perform avo.audit(u.id, 'create', 'invoice', inv.id::text, null);
  return avo.invoice_json(inv.id);
end $$;

create or replace function public.api_invoice_cancel(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); inv avo.invoices; il avo.invoice_lines;
begin
  perform avo.need(u, array['executive']);
  select * into inv from avo.invoices where id = avo.jid(p,'id') for update;
  if not found or inv.status <> 'issued' then perform avo.fail('ยกเลิกได้เฉพาะบิลที่ออกแล้ว'); end if;
  if avo.jtxt(p,'reason') is null then perform avo.fail('กรุณาระบุเหตุผลการยกเลิกบิล'); end if;
  for il in select * from avo.invoice_lines where invoice_id = inv.id loop
    update avo.dispatch_lines set billed_kg = billed_kg - il.kg where id = il.dispatch_line_id;
  end loop;
  update avo.invoices set status = 'cancelled', cancel_reason = avo.jtxt(p,'reason'), cancelled_by = u.id, cancelled_at = now() where id = inv.id;
  perform avo.audit(u.id, 'cancel', 'invoice', inv.id::text, p);
  return avo.invoice_json(inv.id);
end $$;

create or replace function public.api_invoices(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); q text := lower(avo.jtxt(p,'q'));
begin
  perform avo.need(u, array['sales','executive','warehouse']);
  return coalesce((select jsonb_agg(avo.invoice_json(i.id) - 'lines' order by i.doc_date desc, i.id desc)
    from avo.invoices i join avo.customers c on c.id = i.customer_id
    where (avo.jid(p,'customer_id') is null or i.customer_id = avo.jid(p,'customer_id'))
      and (avo.jtxt(p,'status') is null or i.status = p->>'status')
      and (avo.jtxt(p,'from') is null or i.doc_date >= (p->>'from')::date)
      and (avo.jtxt(p,'to') is null or i.doc_date <= (p->>'to')::date)
      and (q is null or lower(i.doc_no) like '%'||q||'%' or lower(c.name) like '%'||q||'%')), '[]');
end $$;

create or replace function public.api_invoice_get(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin
  perform avo.need(u, array['sales','executive','warehouse']);
  return avo.invoice_json(coalesce(avo.jid(p,'id'), (select id from avo.invoices where doc_no = upper(avo.jtxt(p,'doc_no')))));
end $$;

-- ---------- แจ้งเตือนและงานรอตรวจ ----------
create or replace function avo.alerts(u avo.users) returns jsonb
language plpgsql stable as $$
declare low numeric := avo.threshold('low_stock_kg', 200); near int := avo.threshold('near_ripe_days', 5)::int;
  aging int := avo.threshold('aging_days', 7)::int; pct numeric := avo.threshold('weight_variance_pct', 5);
  std numeric := avo.threshold('std_basket_kg', 20); hrs numeric := avo.threshold('receive_deadline_hours', 4);
  res jsonb := '[]'; today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  -- สุกมาก
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','danger','kind','overripe','title','สุกมาก เร่งระบาย/พิจารณาตัดทิ้ง',
      'detail', format('%s · %s · %s %s กก.', l.code, st.name, avo.zone_label(b.zone), avo.n(b.kg)), 'lot_id', l.id, 'lot_code', l.code))
    from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
    where b.ripeness = 'overripe' and b.kg > 0 and b.zone <> 'transit' and avo.can_see_site(u, b.site_id)), '[]');
  -- สุกแล้ว ควรจ่ายก่อน (เฉพาะคลัง)
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','warn','kind','ripe','title','สุกแล้ว ควรจ่ายก่อน',
      'detail', format('%s · %s %s กก.', l.code, st.name, avo.n(b.kg)), 'lot_id', l.id, 'lot_code', l.code))
    from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
    where b.ripeness = 'ripe' and b.kg > 0 and st.kind = 'warehouse' and b.zone = 'main' and avo.can_see_site(u, b.site_id)), '[]');
  -- ใกล้สุก (ตามอายุ Lot) ควรตรวจความสุก
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','info','kind','near_ripe','title','ใกล้สุก ควรตรวจความสุก',
      'detail', format('%s · %s · %s · อายุ %s วัน', l.code, avo.rip_label(b.ripeness), st.name, today - (l.received_at at time zone 'Asia/Bangkok')::date),
      'lot_id', l.id, 'lot_code', l.code))
    from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
    where b.ripeness in ('raw','breaking') and b.kg > 0 and b.zone in ('main','front','back') and avo.can_see_site(u, b.site_id)
      and today - (l.received_at at time zone 'Asia/Bangkok')::date >= near
      and not exists (select 1 from avo.ripeness_checks c where c.lot_id = l.id and c.checked_at > now() - interval '1 day')), '[]');
  -- ค้างคลัง
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','warn','kind','aging','title','ค้างคลังเกิน ' || aging || ' วัน',
      'detail', format('%s · %s · %s กก. · อายุ %s วัน', l.code, st.name, avo.n(b.kg), today - (l.received_at at time zone 'Asia/Bangkok')::date),
      'lot_id', l.id, 'lot_code', l.code))
    from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
    where l.product = 'fresh' and b.kg > 0 and b.zone <> 'transit' and avo.can_see_site(u, b.site_id)
      and today - (l.received_at at time zone 'Asia/Bangkok')::date >= aging), '[]');
  -- สต็อกต่ำ (ต่อสายพันธุ์ในคลัง)
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','warn','kind','low_stock','title','สต็อกต่ำ',
      'detail', format('%s เหลือ %s กก. (เกณฑ์ %s กก.)', v.name, avo.n(coalesce(s.kg,0)), avo.n(low))))
    from avo.varieties v left join (select l.variety_id, sum(b.kg) kg from avo.balances b join avo.lots l on l.id = b.lot_id
         join avo.sites st on st.id = b.site_id where st.kind = 'warehouse' and b.zone = 'main' group by l.variety_id) s on s.variety_id = v.id
    where v.active and coalesce(s.kg,0) < low and u.role <> 'branch'
      and exists (select 1 from avo.lots l where l.variety_id = v.id)), '[]');
  -- น้ำหนักไม่ตรง (รับเข้า: ชั่งจริงต่างจากตะกร้า × น้ำหนักมาตรฐาน)
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','info','kind','weight','title','น้ำหนักรับเข้าต่างจากค่ามาตรฐาน',
      'detail', format('%s · %s · %s ตะกร้า ชั่งได้ %s กก. (มาตรฐาน %s กก.)', r.doc_no, l.code, rl.baskets, avo.n(rl.net_kg), avo.n(rl.baskets * std)),
      'lot_id', l.id, 'lot_code', l.code))
    from avo.receipt_lines rl join avo.receipts r on r.id = rl.receipt_id join avo.lots l on l.id = rl.lot_id
    where r.status in ('pending_check','confirmed') and r.received_at > now() - interval '7 days' and rl.baskets > 0 and std > 0
      and abs(rl.net_kg - rl.baskets * std) * 100 / (rl.baskets * std) > pct and u.role <> 'branch'), '[]');
  -- รับไม่ครบ / รอตรวจสอบส่วนต่าง
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','danger','kind','case','title','รับไม่ครบ รอตรวจสอบส่วนต่าง',
      'detail', format('%s · %s ขาด %s กก.', d.doc_no, l.code, avo.n(c.kg)), 'dispatch_id', d.id, 'lot_code', l.code, 'lot_id', l.id))
    from avo.cases c join avo.dispatches d on d.id = c.dispatch_id join avo.lots l on l.id = c.lot_id
    where c.status = 'open' and (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id)))), '[]');
  -- ค้างรับเกินเวลา
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','danger','kind','late','title','ปลายทางยังไม่ยืนยันรับเกิน ' || avo.n(hrs) || ' ชม.',
      'detail', format('%s → %s · ส่งเมื่อ %s', d.doc_no, coalesce(c.name, ts.name), to_char(d.shipped_at at time zone 'Asia/Bangkok', 'DD/MM HH24:MI')),
      'dispatch_id', d.id))
    from avo.dispatches d left join avo.customers c on c.id = d.customer_id left join avo.sites ts on ts.id = d.to_site_id
    where d.status = 'shipped' and d.shipped_at < now() - make_interval(secs => hrs * 3600)
      and (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id)))), '[]');
  -- รอตรวจรับ
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','info','kind','pending_receipt','title','รอตรวจรับจากสวน',
      'detail', format('%s · %s', r.doc_no, s.name), 'receipt_id', r.id))
    from avo.receipts r join avo.suppliers s on s.id = r.supplier_id
    where r.status = 'pending_check' and avo.can_see_site(u, r.site_id)), '[]');
  -- รออนุมัติ
  res := res || coalesce((select jsonb_agg(jsonb_build_object('level','info','kind','pending_adjust','title','รออนุมัติ' ||
        case a.kind when 'waste' then 'ตัดทิ้ง' else 'ปรับยอด' end,
      'detail', format('%s · %s · %s กก. · %s', a.doc_no, st.name, avo.n(a.kg), coalesce(a.reason,'-')), 'adjustment_id', a.id))
    from avo.adjustments a join avo.sites st on st.id = a.site_id where a.status = 'pending' and avo.can_see_site(u, a.site_id)), '[]');
  return res;
end $$;

create or replace function public.api_alerts(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur();
begin return avo.alerts(u); end $$;

-- ---------- แดชบอร์ด ----------
create or replace function public.api_dashboard(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); today date := (now() at time zone 'Asia/Bangkok')::date; wh numeric; res numeric;
begin
  select coalesce(sum(b.kg),0) into wh from avo.balances b join avo.sites st on st.id = b.site_id
   where st.kind = 'warehouse' and b.zone = 'main' and avo.can_see_site(u, b.site_id);
  select coalesce(sum(dl.kg),0) into res from avo.dispatch_lines dl join avo.dispatches d on d.id = dl.dispatch_id
   join avo.sites st on st.id = d.from_site_id where d.status = 'draft' and st.kind = 'warehouse' and d.from_zone = 'main' and avo.can_see_site(u, d.from_site_id);
  return jsonb_build_object(
    'warehouse_kg', wh, 'reserved_kg', res, 'ready_kg', wh - res,
    'baskets', (select coalesce(sum(b.baskets),0) from avo.balances b where b.zone <> 'transit' and avo.can_see_site(u, b.site_id)),
    'transit_kg', (select coalesce(sum(b.kg),0) from avo.balances b where b.zone = 'transit' and avo.can_see_site(u, b.site_id)),
    'frozen_bags', (select coalesce(sum(b.bags),0) from avo.balances b where b.zone = 'frozen' and avo.can_see_site(u, b.site_id)),
    'lots_active', (select count(distinct b.lot_id) from avo.balances b where (b.kg > 0 or b.bags > 0) and b.zone <> 'transit' and avo.can_see_site(u, b.site_id)),
    'by_ripeness', coalesce((select jsonb_object_agg(r, kg) from (select b.ripeness r, sum(b.kg) kg from avo.balances b join avo.sites st on st.id = b.site_id
          where st.kind = 'warehouse' and b.zone = 'main' and avo.can_see_site(u, b.site_id) group by b.ripeness) q), '{}'),
    'by_variety', coalesce((select jsonb_agg(jsonb_build_object('variety', v, 'kg', kg, 'baskets', bk) order by kg desc) from (
          select coalesce(vv.name,'-') v, sum(b.kg) kg, sum(b.baskets) bk from avo.balances b join avo.lots l on l.id = b.lot_id
          left join avo.varieties vv on vv.id = l.variety_id join avo.sites st on st.id = b.site_id
          where st.kind = 'warehouse' and b.zone = 'main' and b.kg > 0 and avo.can_see_site(u, b.site_id) group by vv.name) q), '[]'),
    'by_size', coalesce((select jsonb_agg(jsonb_build_object('size', z, 'kg', kg) order by kg desc) from (
          select coalesce(zz.name,'-') z, sum(b.kg) kg from avo.balances b join avo.lots l on l.id = b.lot_id
          left join avo.sizes zz on zz.id = l.size_id join avo.sites st on st.id = b.site_id
          where st.kind = 'warehouse' and b.zone = 'main' and b.kg > 0 and avo.can_see_site(u, b.site_id) group by zz.name) q), '[]'),
    'by_site', coalesce((select jsonb_agg(jsonb_build_object('site_id', st.id, 'site', st.name, 'kind', st.kind,
          'kg', (select coalesce(sum(kg),0) from avo.balances b where b.site_id = st.id and b.zone <> 'transit'),
          'baskets', (select coalesce(sum(baskets),0) from avo.balances b where b.site_id = st.id and b.zone <> 'transit'),
          'bags', (select coalesce(sum(bags),0) from avo.balances b where b.site_id = st.id and b.zone = 'frozen')) order by st.kind desc, st.sort, st.name)
        from avo.sites st where st.active and avo.can_see_site(u, st.id)), '[]'),
    'today', jsonb_build_object(
      'in_kg', (select coalesce(sum(m.d_kg),0) from avo.movements m where m.mtype = 'RECEIVE' and (m.occurred_at at time zone 'Asia/Bangkok')::date = today and avo.can_see_site(u, m.site_id)),
      'out_kg', (select coalesce(sum(-m.d_kg),0) from avo.movements m where m.mtype = 'SHIP_OUT' and (m.occurred_at at time zone 'Asia/Bangkok')::date = today and avo.can_see_site(u, m.site_id)),
      'sales', (select coalesce(sum(i.subtotal - i.discount),0) from avo.invoices i where i.status = 'issued' and i.doc_date = today and u.role <> 'branch'),
      'gross_profit', (select coalesce(sum(i.subtotal - i.discount - i.cost_total),0) from avo.invoices i where i.status = 'issued' and i.doc_date = today and u.role <> 'branch'),
      'waste_kg', (select coalesce(sum(-m.d_kg),0) from avo.movements m where m.mtype in ('WASTE','CASE_LOSS') and (m.occurred_at at time zone 'Asia/Bangkok')::date = today and avo.can_see_site(u, m.site_id))),
    'queue', jsonb_build_array(
      jsonb_build_object('key','pending_receipt','title','รอตรวจรับจากสวน','sub','คลังต้องยืนยันน้ำหนักจริง',
        'count', (select count(*) from avo.receipts r where r.status = 'pending_check' and avo.can_see_site(u, r.site_id))),
      jsonb_build_object('key','draft_dispatch','title','ใบตีออกรอผู้จัดการยืนยัน','sub','จองสต็อกไว้แล้ว ยังไม่ส่ง',
        'count', (select count(*) from avo.dispatches d where d.status = 'draft' and avo.can_see_site(u, d.from_site_id))),
      jsonb_build_object('key','in_transit','title','ส่งแล้ว รอสาขารับ','sub','อยู่ระหว่างขนส่ง',
        'count', (select count(*) from avo.dispatches d where d.status = 'shipped' and (avo.can_see_site(u, d.from_site_id) or avo.can_see_site(u, d.to_site_id)))),
      jsonb_build_object('key','partial','title','รับบางส่วน','sub','รอตรวจสอบส่วนต่าง',
        'count', (select count(*) from avo.cases c join avo.dispatches d on d.id = c.dispatch_id where c.status = 'open'
                  and (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id))))),
      jsonb_build_object('key','pending_adjust','title','รออนุมัติตัดทิ้ง / ปรับยอด','sub','ผู้จัดการต้องอนุมัติ',
        'count', (select count(*) from avo.adjustments a where a.status = 'pending' and avo.can_see_site(u, a.site_id))),
      jsonb_build_object('key','to_bill','title','ส่งมอบแล้ว รอออกบิล','sub','ฝ่ายขายสร้างบิลจากใบตีออก',
        'count', (select count(distinct d.id) from avo.dispatches d join avo.dispatch_lines dl on dl.dispatch_id = d.id
                  where d.kind = 'sale' and d.status in ('received','partial','closed') and dl.received_kg > dl.billed_kg and u.role <> 'branch'))),
    'watch_lots', coalesce((select jsonb_agg(x order by (x->>'urgency')::int desc, x->>'received_at') from (
        select jsonb_build_object('lot_id', l.id, 'lot_code', l.code, 'variety', v.name, 'size', z.name, 'received_at', l.received_at,
          'ripeness', b.ripeness, 'kg', b.kg, 'site', st.name, 'zone', b.zone,
          'age_days', today - (l.received_at at time zone 'Asia/Bangkok')::date,
          'urgency', avo.rip_rank(b.ripeness) * 100 + (today - (l.received_at at time zone 'Asia/Bangkok')::date)) x
        from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
        left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
        where b.kg > 0 and l.product = 'fresh' and b.zone in ('main','front','back') and avo.can_see_site(u, b.site_id)
        order by avo.rip_rank(b.ripeness) desc, l.received_at limit 8) q), '[]'),
    'alerts_count', jsonb_array_length(avo.alerts(u)),
    'open_cases', (select count(*) from avo.cases c join avo.dispatches d on d.id = c.dispatch_id where c.status = 'open'
                   and (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id)))));
end $$;

-- ---------- รายงาน ----------
create or replace function public.api_report(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = avo, pg_temp as $$
declare u avo.users := avo.cur(); k text := coalesce(p->>'kind','stock');
  f date := coalesce((p->>'from')::date, (now() at time zone 'Asia/Bangkok')::date - 30);
  t date := coalesce((p->>'to')::date, (now() at time zone 'Asia/Bangkok')::date);
  cols jsonb; rows jsonb; today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if k = 'receipts' then
    cols := '[{"key":"date","label":"วันที่","type":"date"},{"key":"doc_no","label":"เลขที่รับเข้า"},{"key":"supplier","label":"สวน","dim":true},{"key":"province","label":"จังหวัด","dim":true},{"key":"lot","label":"Lot"},{"key":"variety","label":"สายพันธุ์","dim":true},{"key":"size","label":"ไซส์","dim":true},{"key":"ripeness","label":"ความสุก","dim":true},{"key":"baskets","label":"ตะกร้า","type":"num"},{"key":"net_kg","label":"ชั่งสุทธิ (กก.)","type":"num"},{"key":"rejected_kg","label":"คัดออก (กก.)","type":"num"},{"key":"accepted_kg","label":"รับจริง (กก.)","type":"num"},{"key":"unit_cost","label":"ราคาซื้อ/กก.","type":"money","nosum":true},{"key":"cost","label":"ต้นทุน (บาท)","type":"money"}]';
    select coalesce(jsonb_agg(jsonb_build_object('date', (r.received_at at time zone 'Asia/Bangkok')::date, 'doc_no', r.doc_no, 'supplier', s.name, 'province', s.province,
      'lot', l.code, 'variety', v.name, 'size', z.name, 'ripeness', avo.rip_label(rl.ripeness), 'baskets', rl.baskets, 'net_kg', rl.net_kg,
      'rejected_kg', rl.rejected_kg, 'accepted_kg', rl.accepted_kg, 'unit_cost', rl.unit_cost, 'cost', round(rl.accepted_kg * rl.unit_cost, 2)) order by r.received_at, rl.line_no), '[]')
    into rows from avo.receipts r join avo.receipt_lines rl on rl.receipt_id = r.id join avo.suppliers s on s.id = r.supplier_id
    join avo.lots l on l.id = rl.lot_id join avo.varieties v on v.id = rl.variety_id join avo.sizes z on z.id = rl.size_id
    where r.status = 'confirmed' and (r.received_at at time zone 'Asia/Bangkok')::date between f and t and avo.can_see_site(u, r.site_id);

  elsif k = 'dispatches' then
    cols := '[{"key":"date","label":"วันที่ส่ง","type":"date"},{"key":"doc_no","label":"เลขที่"},{"key":"kind","label":"ประเภท","dim":true},{"key":"from","label":"ต้นทาง","dim":true},{"key":"destination","label":"ปลายทาง","dim":true},{"key":"channel","label":"ช่องทาง","dim":true},{"key":"lot","label":"Lot"},{"key":"supplier","label":"สวน","dim":true},{"key":"variety","label":"สายพันธุ์","dim":true},{"key":"size","label":"ไซส์","dim":true},{"key":"kg","label":"ส่ง (กก.)","type":"num"},{"key":"received_kg","label":"รับจริง (กก.)","type":"num"},{"key":"variance_kg","label":"ส่วนต่าง (กก.)","type":"num"},{"key":"status","label":"สถานะ","dim":true}]';
    select coalesce(jsonb_agg(jsonb_build_object('date', (d.shipped_at at time zone 'Asia/Bangkok')::date, 'doc_no', d.doc_no,
      'kind', case d.kind when 'sale' then 'ขาย' else 'โอนสาขา' end, 'from', fs.name, 'destination', coalesce(c.name, ts.name),
      'channel', coalesce(c.channel, 'สาขา'), 'lot', l.code, 'supplier', sp.name, 'variety', v.name, 'size', z.name,
      'kg', dl.kg, 'received_kg', dl.received_kg, 'variance_kg', case when dl.received_kg is null then null else dl.kg - dl.received_kg end,
      'status', d.status) order by d.shipped_at, dl.line_no), '[]')
    into rows from avo.dispatches d join avo.dispatch_lines dl on dl.dispatch_id = d.id join avo.sites fs on fs.id = d.from_site_id
    left join avo.sites ts on ts.id = d.to_site_id left join avo.customers c on c.id = d.customer_id
    join avo.lots l on l.id = dl.lot_id left join avo.suppliers sp on sp.id = l.supplier_id
    left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    where d.shipped_at is not null and (d.shipped_at at time zone 'Asia/Bangkok')::date between f and t
      and (avo.can_see_site(u, d.from_site_id) or (d.to_site_id is not null and avo.can_see_site(u, d.to_site_id)));

  elsif k in ('stock','branch','aging') then
    cols := '[{"key":"site","label":"สถานที่","dim":true},{"key":"zone","label":"จุดจัดเก็บ","dim":true},{"key":"lot","label":"Lot"},{"key":"supplier","label":"สวน","dim":true},{"key":"variety","label":"สายพันธุ์","dim":true},{"key":"size","label":"ไซส์","dim":true},{"key":"ripeness","label":"ความสุก","dim":true},{"key":"received","label":"รับเข้า","type":"date"},{"key":"age_days","label":"อายุ (วัน)","type":"num","nosum":true},{"key":"kg","label":"คงเหลือ (กก.)","type":"num"},{"key":"baskets","label":"ตะกร้า","type":"num"},{"key":"bags","label":"ถุง","type":"num"},{"key":"value","label":"มูลค่าทุน (บาท)","type":"money"}]';
    select coalesce(jsonb_agg(jsonb_build_object('site', st.name, 'zone', avo.zone_label(b.zone), 'lot', l.code, 'supplier', sp.name,
      'variety', v.name, 'size', z.name, 'ripeness', avo.rip_label(b.ripeness), 'received', (l.received_at at time zone 'Asia/Bangkok')::date,
      'age_days', today - (l.received_at at time zone 'Asia/Bangkok')::date, 'kg', b.kg, 'baskets', b.baskets, 'bags', b.bags,
      'value', round(b.kg * l.unit_cost, 2))
      order by case when k = 'aging' then today - (l.received_at at time zone 'Asia/Bangkok')::date end desc nulls last, st.kind desc, st.name, b.zone, l.code), '[]')
    into rows from avo.balances b join avo.lots l on l.id = b.lot_id join avo.sites st on st.id = b.site_id
    left join avo.suppliers sp on sp.id = l.supplier_id left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    where (b.kg > 0 or b.bags > 0) and avo.can_see_site(u, b.site_id)
      and (k <> 'branch' or st.kind = 'branch')
      and (k <> 'aging' or (l.product = 'fresh' and b.zone <> 'transit'));

  elsif k = 'sales' then
    cols := '[{"key":"date","label":"วันที่บิล","type":"date"},{"key":"doc_no","label":"เลขที่บิล"},{"key":"customer","label":"ลูกค้า","dim":true},{"key":"channel","label":"ช่องทาง","dim":true},{"key":"lot","label":"Lot"},{"key":"supplier","label":"สวน","dim":true},{"key":"variety","label":"สายพันธุ์","dim":true},{"key":"size","label":"ไซส์","dim":true},{"key":"kg","label":"กก.","type":"num"},{"key":"price","label":"ราคา/กก.","type":"money","nosum":true},{"key":"amount","label":"ยอดขาย (บาท)","type":"money"},{"key":"cost","label":"ต้นทุน (บาท)","type":"money"},{"key":"gp","label":"กำไรขั้นต้น (บาท)","type":"money"}]';
    perform avo.need(u, array['sales','executive','warehouse']);
    select coalesce(jsonb_agg(jsonb_build_object('date', i.doc_date, 'doc_no', i.doc_no, 'customer', c.name, 'channel', c.channel,
      'lot', l.code, 'supplier', sp.name, 'variety', v.name, 'size', z.name, 'kg', il.kg, 'price', il.price, 'amount', il.amount,
      'cost', il.cost, 'gp', il.amount - il.cost) order by i.doc_date, i.id, il.line_no), '[]')
    into rows from avo.invoices i join avo.invoice_lines il on il.invoice_id = i.id join avo.customers c on c.id = i.customer_id
    join avo.lots l on l.id = il.lot_id left join avo.lots rl on rl.id = coalesce(l.parent_lot_id, l.id)
    left join avo.suppliers sp on sp.id = rl.supplier_id
    left join avo.varieties v on v.id = l.variety_id left join avo.sizes z on z.id = l.size_id
    where i.status = 'issued' and i.doc_date between f and t;

  elsif k = 'waste' then
    cols := '[{"key":"date","label":"วันที่","type":"date"},{"key":"doc_no","label":"เอกสาร"},{"key":"type","label":"ประเภทสูญเสีย","dim":true},{"key":"site","label":"สถานที่","dim":true},{"key":"lot","label":"Lot"},{"key":"supplier","label":"สวน","dim":true},{"key":"variety","label":"สายพันธุ์","dim":true},{"key":"kg","label":"สูญเสีย (กก.)","type":"num"},{"key":"reason","label":"เหตุผล"}]';
    select coalesce(jsonb_agg(x order by x->>'date'), '[]') into rows from (
      select jsonb_build_object('date', (m.occurred_at at time zone 'Asia/Bangkok')::date, 'doc_no', m.doc_no,
        'type', case m.mtype when 'WASTE' then 'ตัดทิ้ง/เน่าเสีย' else 'สูญหายระหว่างขนส่ง' end, 'site', st.name, 'lot', l.code,
        'supplier', sp.name, 'variety', v.name, 'kg', -m.d_kg, 'reason', m.reason) x
      from avo.movements m join avo.lots l on l.id = m.lot_id join avo.sites st on st.id = m.site_id
      left join avo.lots rl on rl.id = coalesce(l.parent_lot_id, l.id) left join avo.suppliers sp on sp.id = rl.supplier_id
      left join avo.varieties v on v.id = l.variety_id
      where m.mtype in ('WASTE','CASE_LOSS') and (m.occurred_at at time zone 'Asia/Bangkok')::date between f and t and avo.can_see_site(u, m.site_id)
      union all
      select jsonb_build_object('date', (fr.created_at at time zone 'Asia/Bangkok')::date, 'doc_no', fr.doc_no, 'type', 'สูญเสียจากแปรรูป (เปลือก/เมล็ด)',
        'site', st.name, 'lot', l.code, 'supplier', sp.name, 'variety', v.name, 'kg', fr.loss_kg, 'reason', fr.note)
      from avo.freezes fr join avo.lots l on l.id = fr.source_lot_id join avo.sites st on st.id = fr.site_id
      left join avo.suppliers sp on sp.id = l.supplier_id left join avo.varieties v on v.id = l.variety_id
      where (fr.created_at at time zone 'Asia/Bangkok')::date between f and t and avo.can_see_site(u, fr.site_id)
      union all
      select jsonb_build_object('date', (r.received_at at time zone 'Asia/Bangkok')::date, 'doc_no', r.doc_no, 'type', 'คัดออกตอนรับเข้า',
        'site', st.name, 'lot', l.code, 'supplier', sp.name, 'variety', v.name, 'kg', rl.rejected_kg, 'reason', rl.note)
      from avo.receipt_lines rl join avo.receipts r on r.id = rl.receipt_id join avo.lots l on l.id = rl.lot_id join avo.sites st on st.id = r.site_id
      join avo.suppliers sp on sp.id = r.supplier_id join avo.varieties v on v.id = rl.variety_id
      where r.status = 'confirmed' and rl.rejected_kg > 0 and (r.received_at at time zone 'Asia/Bangkok')::date between f and t and avo.can_see_site(u, r.site_id)
    ) q;

  elsif k = 'movements' then
    cols := '[{"key":"date","label":"เวลาเกิดจริง","type":"datetime"},{"key":"mtype","label":"ประเภท","dim":true},{"key":"doc_no","label":"เอกสาร"},{"key":"lot","label":"Lot"},{"key":"site","label":"สถานที่","dim":true},{"key":"zone","label":"จุด","dim":true},{"key":"ripeness","label":"ความสุก","dim":true},{"key":"d_kg","label":"เปลี่ยน (กก.)","type":"num"},{"key":"before_kg","label":"ก่อน","type":"num","nosum":true},{"key":"after_kg","label":"หลัง","type":"num","nosum":true},{"key":"actor","label":"ผู้ทำ","dim":true},{"key":"approver","label":"ผู้อนุมัติ"},{"key":"reason","label":"เหตุผล"}]';
    select coalesce(jsonb_agg(jsonb_build_object('date', m.occurred_at, 'mtype', m.mtype, 'doc_no', m.doc_no, 'lot', l.code, 'site', st.name,
      'zone', avo.zone_label(m.zone), 'ripeness', avo.rip_label(m.ripeness), 'd_kg', m.d_kg, 'before_kg', m.before_kg, 'after_kg', m.after_kg,
      'actor', ua.display_name, 'approver', ub.display_name, 'reason', m.reason) order by m.id), '[]')
    into rows from avo.movements m join avo.lots l on l.id = m.lot_id join avo.sites st on st.id = m.site_id
    left join avo.users ua on ua.id = m.actor_id left join avo.users ub on ub.id = m.approver_id
    where (m.occurred_at at time zone 'Asia/Bangkok')::date between f and t and avo.can_see_site(u, m.site_id);
  else
    perform avo.fail('ประเภทรายงานไม่ถูกต้อง');
  end if;
  return jsonb_build_object('kind', k, 'from', f, 'to', t, 'columns', cols, 'rows', rows);
end $$;

-- ==== sql/06_setup.sql ====
-- =====================================================================
-- 06_setup.sql : สิทธิ์การเข้าถึง + ค่าเริ่มต้น
-- =====================================================================

-- ปิดการเข้าถึงตาราง/ฟังก์ชันภายในจากภายนอกทั้งหมด
revoke all on schema avo from public;
revoke all on all tables in schema avo from public;
revoke execute on all functions in schema avo from public;

-- ฟังก์ชัน public.api_* : เรียกได้เฉพาะผู้ที่ล็อกอินแล้ว (role "authenticated" ของ Neon Data API / Supabase)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'api\_%' loop
    execute format('revoke execute on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anonymous') then
      execute format('revoke execute on function %s from anonymous', f.sig);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;

-- ---------- ค่าเริ่มต้น (แก้ได้ในหน้า "ตั้งค่า") ----------
insert into avo.settings(key, value) values
  ('thresholds', '{"low_stock_kg":200,"near_ripe_days":5,"aging_days":7,"weight_variance_pct":5,"std_basket_kg":20,"receive_deadline_hours":4}'),
  ('options', '{"require_receive_photo":true,"require_waste_photo":true,"max_sales_discount_pct":5}'),
  ('company', '{"name":"","address":"","tax_id":"","phone":""}')
on conflict (key) do nothing;

insert into avo.sites(code, name, kind, sort) values ('CW', 'คลังกลาง', 'warehouse', 1)
on conflict (code) do nothing;

insert into avo.varieties(code, name, sort) values
  ('HASS', 'Hass', 1), ('BUCC', 'บัคคาเนีย', 2), ('BOOTH7', 'Booth 7', 3), ('PETER', 'ปีเตอร์สัน', 4)
on conflict (code) do nothing;

insert into avo.sizes(code, name, min_g, max_g, sort) values
  ('S', 'S', null, 179, 1), ('M', 'M', 180, 219, 2), ('180', '180+', 180, null, 3), ('220', '220+', 220, null, 4), ('L', 'L', 220, 299, 5), ('XL', 'XL', 300, null, 6)
on conflict (code) do nothing;
commit;
