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
