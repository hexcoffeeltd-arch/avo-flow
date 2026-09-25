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
