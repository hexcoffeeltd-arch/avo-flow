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
