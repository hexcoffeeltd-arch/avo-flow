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
