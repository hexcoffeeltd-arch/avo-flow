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
