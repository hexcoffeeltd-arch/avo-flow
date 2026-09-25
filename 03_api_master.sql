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
