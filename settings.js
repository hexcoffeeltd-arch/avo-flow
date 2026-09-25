import { $, $$, esc, fmtN, fmtMoney, thDateTime, ROLE, CHANNEL, table, opt, field, formData, openModal, busy, toast } from '../ui.js';

export async function render(el, ctx, params) {
  const c = ctx.can;
  const TABS = [c.settings && ['general', 'ทั่วไป · เกณฑ์แจ้งเตือน'], c.master && ['master', 'สายพันธุ์ · ไซส์ · สาขา'], c.prices && ['prices', 'ราคาขาย'], c.settings && ['users', 'ผู้ใช้งานและสิทธิ์'], (c.settings || c.prices) && ['audit', 'ประวัติการแก้ไข']].filter(Boolean);
  const tab = TABS.find((t) => t[0] === params[0]) ? params[0] : TABS[0][0];
  el.innerHTML = `<div class="page-head"><div><h1>ตั้งค่า</h1><div class="sub">ผู้ใช้งาน สิทธิ์ สายพันธุ์ ไซส์ สาขา ราคา และเกณฑ์แจ้งเตือน · ระบบบันทึกผู้แก้ไขและเวลาทุกครั้ง</div></div></div>
    <div class="tabs">${TABS.map(([k, v]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/settings/${k}">${v}</a>`).join('')}</div><div id="tab"></div>`;
  const t = $('#tab', el); const rerender = () => render(el, ctx, [tab]);
  if (tab === 'general') general(t, ctx);
  if (tab === 'master') master(t, ctx, rerender);
  if (tab === 'prices') await prices(t, ctx);
  if (tab === 'users') await users(t, ctx, rerender);
  if (tab === 'audit') await audit(t, ctx);
}

function general(el, ctx) {
  const s = ctx.master.settings || {}; const th = s.thresholds || {}; const op = s.options || {}; const co = s.company || {};
  const num = (k, label, hint, unit) => field(`${label}${unit ? ` (${unit})` : ''}`, `<input class="input" type="number" min="0" step="any" name="${k}" value="${esc(th[k] ?? '')}">`, { hint });
  el.innerHTML = `<div class="split"><div class="card"><div class="card-title" style="margin-bottom:12px">เกณฑ์แจ้งเตือน</div>
      <div class="form-grid" id="th">
        ${num('low_stock_kg', 'สต็อกต่ำเมื่อต่ำกว่า', 'ต่อสายพันธุ์ ในคลัง', 'กก.')}
        ${num('near_ripe_days', 'เตือนใกล้สุกเมื่ออายุ Lot ถึง', 'ใช้ช่วยเตือนให้ไปตรวจจริง', 'วัน')}
        ${num('aging_days', 'ค้างคลังเมื่ออายุ Lot เกิน', '', 'วัน')}
        ${num('receive_deadline_hours', 'ปลายทางต้องยืนยันรับภายใน', 'หลังตีออก', 'ชม.')}
        ${num('std_basket_kg', 'น้ำหนักมาตรฐานต่อตะกร้า', 'ใช้เทียบกับน้ำหนักชั่งจริง', 'กก.')}
        ${num('weight_variance_pct', 'เตือนน้ำหนักไม่ตรงเมื่อต่างเกิน', '', '%')}
      </div><div class="card-title" style="margin:18px 0 12px">ข้อบังคับ</div>
      <div class="grid" id="op">
        <label class="check"><input type="checkbox" name="require_receive_photo" ${op.require_receive_photo !== false ? 'checked' : ''}> ต้องแนบรูปเมื่อยืนยันรับปลายทาง</label>
        <label class="check"><input type="checkbox" name="require_waste_photo" ${op.require_waste_photo !== false ? 'checked' : ''}> ต้องแนบรูปเมื่อขอตัดทิ้ง</label>
        ${field('ส่วนลดสูงสุดที่ฝ่ายขายให้เองได้ (%)', `<input class="input" type="number" min="0" max="100" step="any" name="max_sales_discount_pct" value="${esc(op.max_sales_discount_pct ?? 5)}">`)}
      </div></div>
    <div class="card"><div class="card-title" style="margin-bottom:12px">ข้อมูลบริษัท (หัวบิล / ใบเสนอราคา)</div>
      <div class="grid" id="co">${field('ชื่อบริษัท', `<input class="input" name="name" value="${esc(co.name || '')}">`)}${field('ที่อยู่', `<textarea class="input" name="address">${esc(co.address || '')}</textarea>`)}
        ${field('เลขประจำตัวผู้เสียภาษี', `<input class="input" name="tax_id" value="${esc(co.tax_id || '')}">`)}${field('โทรศัพท์', `<input class="input" name="phone" value="${esc(co.phone || '')}">`)}</div></div></div>
    <div class="actions" style="margin-top:14px;justify-content:flex-end"><button class="btn primary" id="save">บันทึกการตั้งค่า</button></div>`;
  $('#save', el).onclick = (e) => busy(e.currentTarget, async () => {
    const t = Object.fromEntries(Object.entries(formData($('#th', el))).map(([k, v]) => [k, v == null ? null : Number(v)]));
    const o = formData($('#op', el)); o.max_sales_discount_pct = Number(o.max_sales_discount_pct || 0);
    await ctx.api.rpc('api_settings_save', { key: 'thresholds', value: t });
    await ctx.api.rpc('api_settings_save', { key: 'options', value: o });
    await ctx.api.rpc('api_settings_save', { key: 'company', value: formData($('#co', el)) });
    await ctx.reloadMe(); toast('บันทึกการตั้งค่าแล้ว', 'ok');
  });
}

function master(el, ctx, rerender) {
  const M = ctx.master;
  const block = (ent, title, rows, cols) => `<div class="card" style="margin-bottom:14px"><div class="card-head"><div class="card-title">${title}</div>${ent !== 'site' || ctx.can.settings ? `<button class="btn sm" data-add="${ent}">+ เพิ่ม</button>` : ''}</div>
    ${table(cols, rows, { rowAttr: (r) => (ent !== 'site' || ctx.can.settings ? `class="click" data-ent="${ent}" data-id="${r.id}"` : '') })}</div>`;
  const active = (r) => (r.active ? '<span class="badge b-ok">ใช้งาน</span>' : '<span class="badge b-gray">ปิด</span>');
  el.innerHTML = `<div class="notice info">สายพันธุ์/ไซส์แก้ได้โดย Admin หรือผู้จัดการคลัง · ปิดการใช้งานแทนการลบ เพื่อรักษาประวัติ Lot เดิม</div>
    <div class="row-2" style="grid-template-columns:1fr 1fr">${block('variety', 'สายพันธุ์', M.varieties, [{ label: 'รหัส', key: 'code' }, { label: 'ชื่อ', key: 'name' }, { label: 'ลำดับ', key: 'sort' }, { label: '', right: true, render: active }])}
    ${block('size', 'ไซส์ / เกรด', M.sizes, [{ label: 'รหัส', key: 'code' }, { label: 'ชื่อ', key: 'name' }, { label: 'กรัม/ลูก', render: (s) => (s.min_g || s.max_g ? `${s.min_g ?? ''}–${s.max_g ?? ''}` : '—') }, { label: '', right: true, render: active }])}</div>
    ${block('site', 'คลังและสาขา', M.sites, [{ label: 'รหัส', key: 'code' }, { label: 'ชื่อ', key: 'name' }, { label: 'ประเภท', render: (s) => (s.kind === 'warehouse' ? 'คลัง (คลัง · แช่แข็ง)' : 'สาขา (หน้าร้าน · หลังร้าน · แช่แข็ง)') }, { label: '', right: true, render: active }])}`;
  const edit = (ent, row = null) => {
    const m = openModal({ title: `${row ? 'แก้ไข' : 'เพิ่ม'}${{ variety: 'สายพันธุ์', size: 'ไซส์', site: 'คลัง/สาขา' }[ent]}`, size: 'sm',
      body: `<div class="grid" id="mf">${field('รหัส', `<input class="input" name="code" value="${esc(row?.code || '')}">`, { req: true })}${field('ชื่อ', `<input class="input" name="name" value="${esc(row?.name || '')}">`, { req: true })}
        ${ent === 'size' ? `<div class="form-grid">${field('น้ำหนักต่ำสุด (กรัม/ลูก)', `<input class="input" type="number" name="min_g" value="${esc(row?.min_g ?? '')}">`)}${field('สูงสุด', `<input class="input" type="number" name="max_g" value="${esc(row?.max_g ?? '')}">`)}</div>` : ''}
        ${ent === 'site' ? field('ประเภท', `<select class="input" name="kind"><option value="branch">สาขา</option><option value="warehouse" ${row?.kind === 'warehouse' ? 'selected' : ''}>คลัง</option></select>`) : ''}
        ${field('ลำดับการแสดง', `<input class="input" type="number" name="sort" value="${esc(row?.sort ?? 0)}">`)}
        <label class="check"><input type="checkbox" name="active" ${row?.active !== false ? 'checked' : ''}> ใช้งาน</label></div>`,
      foot: '<button class="btn primary" id="ok">บันทึก</button>' });
    $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => { await ctx.api.rpc('api_master_save', { entity: ent, row: { id: row?.id, ...formData($('#mf', m.el)) } }); m.close(); await ctx.reloadMe(); toast('บันทึกแล้ว', 'ok'); rerender(); });
  };
  $$('[data-add]', el).forEach((b) => (b.onclick = () => edit(b.dataset.add)));
  $$('tr[data-ent]', el).forEach((tr) => (tr.onclick = () => { const list = { variety: M.varieties, size: M.sizes, site: M.sites }[tr.dataset.ent]; edit(tr.dataset.ent, list.find((x) => x.id === Number(tr.dataset.id))); }));
}

async function prices(el, ctx) {
  const M = ctx.master; const rows = await ctx.api.rpc('api_prices', {});
  el.innerHTML = `<div class="notice info">ฝ่ายขายต้องใช้ราคาที่ตั้งไว้ (แก้หน้าบิลไม่ได้) · ราคาเฉพาะลูกค้าจะใช้ก่อนราคามาตรฐาน · ผู้บริหาร/Admin แก้ราคาหน้าบิลได้</div>
    <div class="toolbar"><button class="btn primary" id="add">+ ตั้งราคา</button></div>
    <div class="card">${table([{ label: 'ลูกค้า', render: (p) => (p.customer ? esc(p.customer) : '<span class="badge b-ok">ราคามาตรฐาน</span>') }, { label: 'สายพันธุ์', key: 'variety' }, { label: 'ไซส์', key: 'size' },
      { label: 'ประเภท', render: (p) => (p.product === 'frozen' ? 'แช่แข็ง' : 'สด') }, { label: 'ราคาขาย/กก.', right: true, render: (p) => `<b>${fmtMoney(p.sell_price)}</b>` }, { label: 'แก้ไขล่าสุด', render: (p) => thDateTime(p.updated_at) }],
      rows, { rowAttr: (p, i) => `class="click" data-i="${i}"`, empty: 'ยังไม่ได้ตั้งราคา' })}</div>`;
  const edit = (p = null) => {
    const m = openModal({ title: p ? 'แก้ไขราคา' : 'ตั้งราคาขาย', size: 'sm',
      body: `<div class="grid" id="pf">${field('ลูกค้า', `<select class="input" name="customer_id">${opt(M.customers, p?.customer_id, (c) => c.name, (c) => c.id, 'ราคามาตรฐาน (ทุกลูกค้า)')}</select>`)}
        ${field('สายพันธุ์', `<select class="input" name="variety_id">${opt(M.varieties, p?.variety_id)}</select>`, { req: true })}${field('ไซส์', `<select class="input" name="size_id">${opt(M.sizes, p?.size_id)}</select>`, { req: true })}
        ${field('ประเภท', `<select class="input" name="product"><option value="fresh">สด</option><option value="frozen" ${p?.product === 'frozen' ? 'selected' : ''}>แช่แข็ง</option></select>`)}
        ${field('ราคาขาย (บาท/กก.)', `<input class="input" type="number" min="0" step="0.01" name="sell_price" value="${esc(p?.sell_price ?? '')}">`, { hint: 'เว้นว่างแล้วบันทึก = ลบราคานี้' })}</div>`,
      foot: '<button class="btn primary" id="ok">บันทึก</button>' });
    $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => { await ctx.api.rpc('api_price_save', formData($('#pf', m.el))); m.close(); toast('บันทึกราคาแล้ว', 'ok'); prices(el, ctx); });
  };
  $('#add', el).onclick = () => edit();
  $$('tr[data-i]', el).forEach((tr) => (tr.onclick = () => edit(rows[Number(tr.dataset.i)])));
}

async function users(el, ctx, rerender) {
  const M = ctx.master; const rows = await ctx.api.rpc('api_users', {});
  const pending = rows.filter((u) => u.role === 'pending').length;
  el.innerHTML = `${pending ? `<div class="notice">มีผู้ใช้ใหม่รอกำหนดสิทธิ์ ${pending} คน</div>` : ''}
    <div class="notice info">ผู้ใช้สมัครเองจากหน้าเข้าสู่ระบบ แล้ว Admin กำหนดบทบาท สาขา และสิทธิ์ผู้จัดการ (อนุมัติตีออก / ตัดทิ้ง / ปรับยอด / ปิดงานส่วนต่าง)</div>
    <div class="card">${table([{ label: 'ชื่อ', render: (u) => `<b>${esc(u.display_name || '-')}</b><div class="small muted">${esc(u.email || '')}</div>` },
      { label: 'บทบาท', render: (u) => (u.role === 'pending' ? '<span class="badge b-warn">รอกำหนดสิทธิ์</span>' : esc(ROLE[u.role])) + (u.is_manager ? ' <span class="badge b-info">ผู้จัดการ</span>' : '') },
      { label: 'สาขา / คลัง', render: (u) => esc(u.site_name || 'ทุกสาขา') }, { label: 'สถานะ', render: (u) => (u.active ? '<span class="badge b-ok">ใช้งาน</span>' : '<span class="badge b-gray">ปิด</span>') },
      { label: 'สมัครเมื่อ', render: (u) => thDateTime(u.created_at) }], rows, { rowAttr: (u) => `class="click" data-id="${u.id}"` })}</div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:10px">สิทธิ์ตามบทบาท</div>
      ${table([{ label: 'บทบาท', key: 'r' }, { label: 'ทำได้', key: 'd' }], [
        { r: 'Admin', d: 'ทุกอย่าง รวมตั้งค่า ผู้ใช้ สาขา' },
        { r: 'ผู้บริหาร', d: 'ดูทุกสาขา · ตั้งราคา · แก้ราคาหน้าบิล · ยกเลิกบิล · อนุมัติตัดทิ้ง/ปรับยอด/ส่วนต่าง' },
        { r: 'คลัง', d: 'รับเข้า · ตรวจรับ · ความสุก · สร้างใบตีออก (ผู้จัดการ: ยืนยันตีออก · กลับรายการ · อนุมัติ · แก้สายพันธุ์/ไซส์)' },
        { r: 'สาขา', d: 'เฉพาะสาขาตัวเอง: รับของ · โอนภายใน · แช่แข็ง · ขายหน้าร้าน · ขอตัดทิ้ง (ผู้จัดการ: อนุมัติ · ปิดส่วนต่าง)' },
        { r: 'ฝ่ายขาย', d: 'ลูกค้า · ใบเสนอราคา · ทำบิลจากใบตีออก (ใช้ราคาที่ตั้งไว้) · บันทึกลูกค้ารับของ · ดูสต็อก' }])}</div>`;
  $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => {
    const u = rows.find((x) => x.id === Number(tr.dataset.id));
    const m = openModal({ title: esc(u.display_name || u.email), sub: esc(u.email || ''), size: 'sm',
      body: `<div class="grid" id="uf">${field('ชื่อที่แสดง', `<input class="input" name="display_name" value="${esc(u.display_name || '')}">`)}
        ${field('บทบาท', `<select class="input" name="role">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`)}
        ${field('สาขา / คลัง', `<select class="input" name="site_id">${opt(M.sites, u.site_id, (s) => s.name, (s) => s.id, 'ทุกสาขา (ไม่ผูก)')}</select>`, { hint: 'ฝ่ายสาขาต้องผูกสาขา · คลังผูกคลังหรือเว้นว่าง = ทุกคลัง' })}
        <label class="check"><input type="checkbox" name="is_manager" ${u.is_manager ? 'checked' : ''}> ผู้จัดการ (อนุมัติได้)</label>
        <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> เปิดใช้งาน</label></div>`,
      foot: '<button class="btn primary" id="ok">บันทึก</button>' });
    $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => { const f = formData($('#uf', m.el)); await ctx.api.rpc('api_user_save', { id: u.id, ...f, site_id: f.site_id ? Number(f.site_id) : null }); m.close(); toast('บันทึกสิทธิ์แล้ว', 'ok'); rerender(); });
  }));
}

async function audit(el, ctx) {
  const rows = await ctx.api.rpc('api_audit', { limit: 300 });
  const A = { create: 'สร้าง', update: 'แก้ไข', confirm: 'ยืนยัน', cancel: 'ยกเลิก', reverse: 'กลับรายการ', ship: 'ยืนยันตีออก', receive: 'ยืนยันรับ', resolve: 'ปิดส่วนต่าง', approve: 'อนุมัติ', reject: 'ไม่อนุมัติ', signup: 'สมัคร' };
  el.innerHTML = `<div class="card">${table([{ label: 'เวลา', render: (a) => thDateTime(a.at) }, { label: 'ผู้ทำ', render: (a) => esc(a.actor || '-') }, { label: 'การกระทำ', render: (a) => esc(A[a.action] || a.action) },
    { label: 'ข้อมูล', render: (a) => `${esc(a.entity)} #${esc(a.entity_id)}` }, { label: 'รายละเอียด', render: (a) => `<span class="small muted">${esc(a.data ? JSON.stringify(a.data).slice(0, 120) : '')}</span>` }], rows, { empty: 'ยังไม่มีประวัติ' })}</div>`;
}
