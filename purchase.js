// =====================================================================
// จัดซื้อ: ใบสั่งซื้อจากสวน (PO) · งบจัดซื้อรายเดือน
// =====================================================================
import { $, $$, esc, fmtN, fmtKg, fmtMoney, thDate, thDateY, thDateTime, todayISO, statusBadge, table, opt, field, formData, openModal, busy, toast, confirmBox, exportExcel, PAGE, moreBtn } from './ui.js';
import { done, receiptForm, receiptView, supplierForm } from './docs.js';

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const monthLabel = (m) => (m ? `${TH_MONTH[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}` : '');
const pctBar = (pct, over) => `<div class="bar-track" style="height:8px"><div class="bar-fill" style="width:${Math.min(Number(pct) || 0, 100)}%;background:${over ? 'var(--danger-ink)' : Number(pct) >= 90 ? 'var(--warn-ink)' : 'var(--primary)'}"></div></div>`;

export function budgetBox(b) {
  if (!b) return '';
  const has = b.budget != null;
  return `<div class="summary-box"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>งบจัดซื้อ ${esc(monthLabel(b.month))}</b>
    <span>${has ? `${fmtMoney(b.total)} / ${fmtMoney(b.budget)} บาท (${fmtN(b.pct ?? 0)}%)` : 'ยังไม่ได้ตั้งงบเดือนนี้'}</span></div>
    ${has ? `<div style="margin:8px 0">${pctBar(b.pct, b.over)}</div>` : ''}
    <div class="small muted">รับแล้ว ${fmtMoney(b.received_value)} · สั่งแล้วรอรับ ${fmtMoney(b.open_po_value)}${has ? ` · <b style="color:${b.over ? 'var(--danger-ink)' : 'inherit'}">${b.over ? 'เกินงบ' : 'คงเหลือ'} ${fmtMoney(Math.abs(b.remaining))}</b>` : ''} บาท</div></div>`;
}

// ---------- ใบสั่งซื้อ ----------
export function poForm(ctx, ex = null) {
  const M = ctx.master;
  const whs = M.sites.filter((s) => s.kind === 'warehouse' && s.active && (ctx.me.role !== 'warehouse' || ctx.can.actAt(s.id)));
  const sups = M.suppliers.filter((s) => s.active || s.id === ex?.supplier_id);
  let lines = ex ? ex.lines.map((l) => ({ variety_id: l.variety_id, size_id: l.size_id ?? '', est_kg: l.est_kg, price: l.price }))
    : [{ variety_id: M.varieties[0]?.id, size_id: '', est_kg: '', price: '' }];
  const m = openModal({ title: ex ? `แก้ไขใบสั่งซื้อ ${esc(ex.doc_no)}` : 'สร้างใบสั่งซื้อจากสวน (PO)', sub: 'ราคาซื้อแยกตามสายพันธุ์/ไซส์ · ไซส์ "ทุกไซส์" = ใช้ราคานี้กับไซส์ที่ไม่ได้ระบุ · ยอดซื้อจริงคิดจาก กก. ที่รับหลังคัด', size: 'xl',
    body: `<div class="form-grid g4" id="ph">
        ${field('สวน', `<select class="input" name="supplier_id">${opt(sups, ex?.supplier_id, (x) => x.name, (x) => x.id, '— เลือกสวน —')}</select>`, { req: true, hint: ctx.can.suppliers ? '<button class="link" id="add-sup" type="button">+ เพิ่มสวนใหม่</button>' : '' })}
        ${field('คลังที่รับ', `<select class="input" name="site_id">${opt(whs, ex?.site_id ?? ctx.me.site_id ?? whs[0]?.id)}</select>`)}
        ${field('วันที่สั่ง', `<input class="input" type="date" name="order_date" value="${esc(ex?.order_date || todayISO())}">`, { req: true })}
        ${field('วันนัดรับ', `<input class="input" type="date" name="expected_date" value="${esc(ex?.expected_date || '')}">`, { hint: 'ใช้คิดงบของเดือนนั้น' })}
        ${field('หมายเหตุ', `<input class="input" name="note" value="${esc(ex?.note || '')}">`, { cls: 'span-all' })}</div>
      <div class="section-title">รายการที่สั่ง</div><div id="pl"></div>
      <button class="btn sm" id="add-line" type="button" style="margin-top:8px">+ เพิ่มรายการ</button>
      <div class="summary-box" id="psum" style="margin-top:14px"></div><div id="pbud" style="margin-top:10px"></div>`,
    foot: '<button class="btn" id="draft">บันทึกร่าง</button><button class="btn primary" id="submit">บันทึกและส่งอนุมัติ</button>' });
  const draw = () => {
    $('#pl', m.el).innerHTML = table([
      { label: 'สายพันธุ์', render: (l, i) => `<select class="input" data-i="${i}" data-k="variety_id" style="min-width:130px">${opt(M.varieties.filter((v) => v.active || v.id === l.variety_id), l.variety_id)}</select>` },
      { label: 'ไซส์ / เกรด', render: (l, i) => `<select class="input" data-i="${i}" data-k="size_id" style="min-width:110px">${opt(M.sizes.filter((v) => v.active || v.id === l.size_id), l.size_id, (x) => x.name, (x) => x.id, 'ทุกไซส์')}</select>` },
      { label: 'สั่ง (กก.)', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" data-k="est_kg" value="${esc(l.est_kg)}" style="width:110px">` },
      { label: 'ราคา/กก.', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" data-k="price" value="${esc(l.price)}" style="width:100px">` },
      { label: 'มูลค่า', right: true, render: (l) => `<b data-v>${fmtMoney(Number(l.est_kg || 0) * Number(l.price || 0))}</b>` },
      { label: '', render: (l, i) => (lines.length > 1 ? `<button class="btn sm ghost" data-del="${i}" type="button" aria-label="ลบ">✕</button>` : '') },
    ], lines);
    $$('#pl [data-k]', m.el).forEach((el) => (el.oninput = el.onchange = () => { const l = lines[el.dataset.i]; l[el.dataset.k] = el.value;
      $('[data-v]', el.closest('tr')).textContent = fmtMoney(Number(l.est_kg || 0) * Number(l.price || 0)); sum(); }));
    $$('#pl [data-del]', m.el).forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
    sum();
  };
  let bud = null;
  const sum = () => {
    const kg = lines.reduce((a, l) => a + Number(l.est_kg || 0), 0); const val = lines.reduce((a, l) => a + Number(l.est_kg || 0) * Number(l.price || 0), 0);
    $('#psum', m.el).innerHTML = `สั่งรวม <b>${fmtKg(kg)}</b> · มูลค่าประมาณ <b>${fmtMoney(val)}</b> บาท${kg ? ` · เฉลี่ย ${fmtMoney(val / kg)} บาท/กก.` : ''}`;
    if (bud) { const after = { ...bud, total: bud.total - (ex && ['approved', 'partial'].includes(ex.status) ? 0 : 0) + val };
      after.remaining = bud.budget == null ? null : bud.budget - after.total; after.pct = bud.budget > 0 ? Math.round(after.total * 1000 / bud.budget) / 10 : null; after.over = bud.budget != null && after.total > bud.budget;
      $('#pbud', m.el).innerHTML = budgetBox(after) + (after.over ? '<div class="small" style="color:var(--danger-ink);margin-top:6px">⚠ ถ้าอนุมัติใบนี้ ยอดจัดซื้อเดือนนี้จะเกินงบ (ระบบไม่บล็อก แต่จะบันทึกว่าอนุมัติเกินงบ)</div>' : ''); }
  };
  const loadBud = async () => {
    const h = formData($('#ph', m.el)); const mo = (h.expected_date || h.order_date || todayISO()).slice(0, 7);
    try { const r = await ctx.api.rpc('api_budget_summary', { year: Number(mo.slice(0, 4)), month: mo }); bud = r.months.find((x) => x.month === mo); } catch (e) { bud = null; }
    sum();
  };
  $$('[name=order_date],[name=expected_date]', m.el).forEach((i) => (i.onchange = loadBud));
  $('#add-line', m.el).onclick = () => { const last = lines[lines.length - 1] || {}; lines.push({ variety_id: last.variety_id, size_id: '', est_kg: '', price: '' }); draw(); };
  const addSup = $('#add-sup', m.el); if (addSup) addSup.onclick = () => supplierForm(ctx, null, async (s) => { await ctx.reloadMe(); $('[name=supplier_id]', m.el).innerHTML = opt(ctx.master.suppliers.filter((x) => x.active), s.id, (x) => x.name, (x) => x.id, '— เลือกสวน —'); });
  const save = (submit) => (e) => busy(e.currentTarget, async () => {
    const h = formData($('#ph', m.el));
    const res = await ctx.api.rpc('api_po_save', { id: ex?.id, ...h, supplier_id: h.supplier_id ? Number(h.supplier_id) : null, site_id: h.site_id ? Number(h.site_id) : null,
      expected_date: h.expected_date || null, submit, lines: lines.map((l) => ({ variety_id: Number(l.variety_id), size_id: l.size_id ? Number(l.size_id) : null, est_kg: l.est_kg, price: l.price })) });
    m.close(); done(ctx, submit ? `ส่ง ${res.doc_no} ให้ผู้จัดการ/ผู้บริหารอนุมัติแล้ว` : `บันทึกร่าง ${res.doc_no} แล้ว`); poView(ctx, res.id);
  });
  $('#draft', m.el).onclick = save(false); $('#submit', m.el).onclick = save(true);
  draw(); loadBud();
}

export async function poView(ctx, id) {
  let po; try { po = await ctx.api.rpc('api_po_get', { id }); } catch (e) { toast(e.message, 'err'); return; }
  const open = ['draft', 'pending'].includes(po.status); const active = ['approved', 'partial'].includes(po.status);
  const approver = ctx.can.approveAt(po.site_id);
  const m = openModal({ title: `ใบสั่งซื้อ ${esc(po.doc_no)}`, sub: `${esc(po.supplier)} · รับที่ ${esc(po.site)} · สั่ง ${thDateY(po.order_date)}${po.expected_date ? ` · นัดรับ ${thDateY(po.expected_date)}` : ''}`, size: 'xl',
    body: `<div class="print-area"><div class="actions" style="margin-bottom:10px;align-items:center">${statusBadge('po', po.status)}${po.over_budget ? ' <span class="badge b-danger">อนุมัติเกินงบ</span>' : ''}
        <span class="small muted">สร้างโดย ${esc(po.created_by_name || '-')}${po.approved_by_name ? ` · อนุมัติโดย ${esc(po.approved_by_name)}` : ''}${po.closed_by_name ? ` · ${po.status === 'cancelled' ? 'ยกเลิก' : 'ปิด'}โดย ${esc(po.closed_by_name)}` : ''}</span></div>
      ${po.close_note ? `<div class="notice info">${esc(po.close_note)}</div>` : ''}
      ${table([{ label: 'สายพันธุ์', key: 'variety' }, { label: 'ไซส์ / เกรด', render: (l) => esc(l.size || 'ทุกไซส์') },
        { label: 'สั่ง (กก.)', right: true, render: (l) => fmtN(l.est_kg) }, { label: 'ราคา/กก.', right: true, render: (l) => fmtMoney(l.price) },
        { label: 'มูลค่า', right: true, render: (l) => fmtMoney(l.value) },
        { label: 'รับแล้ว (กก.)', right: true, render: (l) => `<b>${fmtN(l.received_kg)}</b><div class="small muted">${Number(l.est_kg) ? Math.round(l.received_kg * 100 / l.est_kg) : 0}%</div>` }], po.lines)}
      <div class="summary-box" style="margin-top:12px">สั่ง <b>${fmtKg(po.total_kg)}</b> · <b>${fmtMoney(po.total_value)}</b> บาท
        · รับแล้ว <b>${fmtKg(po.received_kg)}</b> · <b>${fmtMoney(po.received_value)}</b> บาท${active ? ` · รอรับ ${fmtMoney(po.open_value)} บาท` : ''}</div>
      ${po.receipts.length ? `<div class="section-title">ใบรับเข้าที่อ้างอิง</div>${table([{ label: 'วันที่', render: (r) => thDateTime(r.received_at) }, { label: 'เลขที่', key: 'doc_no' },
        { label: 'กก.', right: true, render: (r) => fmtN(r.kg) }, { label: 'มูลค่า', right: true, render: (r) => fmtMoney(r.value) }, { label: '', right: true, render: (r) => statusBadge('receipt', r.status) }],
        po.receipts, { rowAttr: (r) => `class="click" data-r="${r.id}"` })}` : ''}
      ${po.note ? `<div class="small muted" style="margin-top:8px">หมายเหตุ: ${esc(po.note)}</div>` : ''}</div>
      <div style="margin-top:12px">${budgetBox(po.budget)}</div>`,
    foot: `<div class="left">${open && ctx.can.purchase ? '<button class="btn" id="edit">แก้ไข</button>' : ''}
        ${(open || (po.status === 'approved' && approver)) && ctx.can.purchase && !po.receipts.length ? '<button class="btn danger" id="cancel">ยกเลิกใบ</button>' : ''}
        ${active && approver ? '<button class="btn" id="close">ปิดใบสั่งซื้อ</button>' : ''}<button class="btn" onclick="window.print()">พิมพ์</button></div>
      ${po.status === 'draft' && ctx.can.purchase ? '<button class="btn" id="submit">ส่งอนุมัติ</button>' : ''}
      ${open && approver ? '<button class="btn primary" id="approve">อนุมัติ</button>' : ''}
      ${active && ctx.can.receive ? '<button class="btn primary" id="recv">+ รับเข้าตามใบสั่งซื้อ</button>' : ''}` });
  const b = (sel, fn) => { const el = $(sel, m.el); if (el) el.onclick = fn; };
  $$('[data-r]', m.el).forEach((tr) => (tr.onclick = () => receiptView(ctx, Number(tr.dataset.r))));
  b('#edit', () => { m.close(); poForm(ctx, po); });
  b('#submit', (e) => busy(e.currentTarget, async () => {
    await ctx.api.rpc('api_po_save', { id: po.id, supplier_id: po.supplier_id, site_id: po.site_id, order_date: po.order_date, expected_date: po.expected_date, note: po.note, submit: true,
      lines: po.lines.map((l) => ({ variety_id: l.variety_id, size_id: l.size_id, est_kg: l.est_kg, price: l.price })) });
    m.close(); done(ctx, `ส่ง ${po.doc_no} ให้อนุมัติแล้ว`); poView(ctx, po.id); }));
  b('#approve', async (e) => {
    if (po.budget?.budget != null && Number(po.budget.total) + Number(po.total_value) > Number(po.budget.budget)) {
      const ok = await confirmBox('อนุมัติเกินงบ', `ยอดจัดซื้อ ${esc(monthLabel(po.month))} จะเป็น ${fmtMoney(Number(po.budget.total) + Number(po.total_value))} บาท เกินงบ ${fmtMoney(po.budget.budget)} บาท — ยืนยันอนุมัติ?`, { ok: 'อนุมัติเกินงบ', danger: true });
      if (!ok) return; }
    busy(e.target, async () => { await ctx.api.rpc('api_po_approve', { id: po.id }); m.close(); done(ctx, `อนุมัติ ${po.doc_no} แล้ว`); poView(ctx, po.id); });
  });
  b('#cancel', async () => { const why = await confirmBox('ยกเลิกใบสั่งซื้อ', 'ยอดของใบนี้จะไม่นับในงบ', { ok: 'ยกเลิกใบ', danger: true, input: { label: 'เหตุผล', required: true } }); if (!why) return;
    try { await ctx.api.rpc('api_po_cancel', { id: po.id, reason: why }); m.close(); done(ctx, 'ยกเลิกใบสั่งซื้อแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  b('#close', async () => { const note = await confirmBox('ปิดใบสั่งซื้อ', `ไม่รอรับเพิ่มแล้ว · ยอดที่ยังไม่รับ ${fmtMoney(po.open_value)} บาท จะคืนงบ`, { ok: 'ปิดใบสั่งซื้อ', input: { label: 'หมายเหตุ เช่น สวนส่งได้เท่านี้' } }); if (note === null) return;
    try { await ctx.api.rpc('api_po_close', { id: po.id, note }); m.close(); done(ctx, `ปิด ${po.doc_no} แล้ว`); } catch (e) { toast(e.message, 'err'); } });
  b('#recv', () => { m.close(); receiptForm(ctx, null, { po }); });
}

// ---------- หน้า: รายการใบสั่งซื้อ ----------
const st = { status: '', q: '' };
export async function poList(el, ctx) {
  let rows = []; let size = PAGE;
  const load = async () => {
    rows = await ctx.api.rpc('api_pos', { status: st.status || null, q: st.q || null, limit: size });
    el.innerHTML = `<div class="toolbar"><input class="input" id="q" placeholder="ค้นหาเลขที่ / สวน" value="${esc(st.q)}" style="max-width:260px">
        <select class="input" id="s" style="max-width:200px"><option value="">ทุกสถานะ</option>${Object.entries({ pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว รอรับ', partial: 'รับบางส่วน', received: 'รับครบ', closed: 'ปิดแล้ว', draft: 'ร่าง', cancelled: 'ยกเลิก' })
          .map(([k, v]) => `<option value="${k}" ${st.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <span style="flex:1"></span>${ctx.can.purchase ? '<button class="btn primary" id="new">+ สร้างใบสั่งซื้อ</button>' : ''}</div>
      <div class="card">${table([{ label: 'วันที่สั่ง', render: (p) => `${thDate(p.order_date)}${p.expected_date ? `<div class="small muted">นัดรับ ${thDate(p.expected_date)}</div>` : ''}` },
        { label: 'เลขที่', render: (p) => `<b>${esc(p.doc_no)}</b>` }, { label: 'สวน', key: 'supplier' },
        { label: 'สั่ง', right: true, render: (p) => `${fmtN(p.total_kg)} กก.<div class="small muted">${fmtMoney(p.total_value)} บาท</div>` },
        { label: 'รับแล้ว', right: true, render: (p) => `${fmtN(p.received_kg)} กก.<div class="small muted">${fmtMoney(p.received_value)} บาท</div>` },
        { label: 'สถานะ', right: true, render: (p) => statusBadge('po', p.status) + (p.over_budget ? ' <span class="badge b-danger">เกินงบ</span>' : '') }],
        rows, { rowAttr: (p) => `class="click" data-id="${p.id}"`, empty: 'ยังไม่มีใบสั่งซื้อ' })}${moreBtn(rows.length, size)}</div>`;
    $('#q', el).onchange = (e) => { st.q = e.target.value.trim(); load(); };
    $('#s', el).onchange = (e) => { st.status = e.target.value; load(); };
    const n = $('#new', el); if (n) n.onclick = () => poForm(ctx);
    const more = $('[data-more]', el); if (more) more.onclick = () => { size += PAGE; load(); };
    $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => poView(ctx, Number(tr.dataset.id))));
  };
  await load();
}

// ---------- หน้า: งบจัดซื้อ + ยอดซื้อสำหรับบัญชี ----------
const bs = { year: null, month: null };
export async function budgetPage(el, ctx) {
  const now = todayISO(); bs.year = bs.year || Number(now.slice(0, 4)); bs.month = bs.month || now.slice(0, 7);
  const r = await ctx.api.rpc('api_budget_summary', { year: bs.year, month: bs.month });
  const edit = ctx.can.budget; const cur = r.months.find((x) => x.month === bs.month);
  const tot = r.months.reduce((a, x) => ({ budget: a.budget + Number(x.budget || 0), rv: a.rv + Number(x.received_value), kg: a.kg + Number(x.received_kg), ov: a.ov + Number(x.open_po_value) }), { budget: 0, rv: 0, kg: 0, ov: 0 });
  el.innerHTML = `<div class="toolbar"><select class="input" id="y" style="max-width:140px">${[bs.year - 1, bs.year, bs.year + 1].map((y) => `<option value="${y}" ${y === bs.year ? 'selected' : ''}>ปี ${y + 543}</option>`).join('')}</select>
      <span class="small muted">ยอดซื้อ = กก. ที่รับจริงหลังคัด × ราคาซื้อ (ใบรับเข้าที่ยืนยันแล้ว ทั้งที่มีและไม่มีใบสั่งซื้อ) · รอรับ = ใบสั่งซื้อที่อนุมัติแล้วยังรับไม่ครบ (นับตามเดือนนัดรับ)</span>
      <span style="flex:1"></span><button class="btn" id="xls">Export Excel</button></div>
    <div class="card">${table([
      { label: 'เดือน', render: (x) => `<b>${esc(monthLabel(x.month))}</b>` },
      { label: 'งบ (บาท)', right: true, render: (x) => (edit ? `<input class="cell" type="number" min="0" step="1000" data-m="${x.month}" value="${x.budget ?? ''}" placeholder="—" style="width:120px">` : x.budget != null ? fmtMoney(x.budget) : '—') },
      { label: 'รับแล้ว (กก.)', right: true, render: (x) => (Number(x.received_kg) ? fmtN(x.received_kg) : '—') },
      { label: 'ยอดซื้อรับแล้ว', right: true, render: (x) => (Number(x.received_value) ? `<b>${fmtMoney(x.received_value)}</b><div class="small muted">${x.receipts} ใบ</div>` : '—') },
      { label: 'สั่งแล้วรอรับ', right: true, render: (x) => (Number(x.open_po_value) ? fmtMoney(x.open_po_value) : '—') },
      { label: 'รวม', right: true, render: (x) => (Number(x.total) ? fmtMoney(x.total) : '—') },
      { label: 'คงเหลือ', right: true, render: (x) => (x.remaining == null ? '—' : `<b style="color:${x.over ? 'var(--danger-ink)' : 'inherit'}">${fmtMoney(x.remaining)}</b>`) },
      { label: 'ใช้งบ', render: (x) => (x.pct == null ? '' : `<div style="min-width:90px">${pctBar(x.pct, x.over)}<div class="small muted">${fmtN(x.pct)}%</div></div>`) },
    ], r.months, { rowAttr: (x) => `class="click ${x.month === bs.month ? 'row-sel' : ''}" data-mo="${x.month}"` })}
      <div class="summary-box" style="margin-top:12px">ทั้งปี: งบ <b>${fmtMoney(tot.budget)}</b> · ยอดซื้อรับแล้ว <b>${fmtMoney(tot.rv)}</b> บาท (${fmtKg(tot.kg)}) · รอรับ ${fmtMoney(tot.ov)} บาท</div></div>
    <div class="card" style="margin-top:14px"><div class="card-title" style="margin-bottom:10px">ยอดซื้อรายสวน · ${esc(monthLabel(bs.month))}</div>
      ${budgetBox(cur)}<div style="margin-top:10px">${table([{ label: 'สวน', key: 'supplier' }, { label: 'ใบรับเข้า', right: true, render: (s) => fmtN(s.receipts) },
        { label: 'กก.', right: true, render: (s) => fmtN(s.kg) }, { label: 'ราคาเฉลี่ย/กก.', right: true, render: (s) => fmtMoney(s.avg_price) }, { label: 'ยอดซื้อ (บาท)', right: true, render: (s) => `<b>${fmtMoney(s.value)}</b>` }],
        r.suppliers, { empty: 'ยังไม่มียอดรับเข้าในเดือนนี้' })}</div>
      <div class="small muted" style="margin-top:8px">รายละเอียดรายใบ/รายบรรทัดสำหรับบัญชี: เมนู <a class="link" href="#/reports">รายงาน → รับเข้า</a> (มีเลขใบสั่งซื้อ เดือน ต้นทุน) · Export Excel ได้</div></div>`;
  $('#y', el).onchange = (e) => { bs.year = Number(e.target.value); bs.month = `${bs.year}-${bs.month.slice(5, 7)}`; budgetPage(el, ctx); };
  $$('tr[data-mo]', el).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('input')) return; bs.month = tr.dataset.mo; budgetPage(el, ctx); }));
  $$('[data-m]', el).forEach((i) => (i.onchange = async () => {
    try { await ctx.api.rpc('api_budget_save', { month: i.dataset.m, amount: i.value === '' ? null : Number(i.value) }); toast(`บันทึกงบ ${monthLabel(i.dataset.m)} แล้ว`, 'ok'); ctx.refreshBell(); budgetPage(el, ctx); }
    catch (e) { toast(e.message, 'err'); } }));
  $('#xls', el).onclick = () => exportExcel(`งบจัดซื้อ-${bs.year + 543}`, [{ key: 'month', label: 'เดือน' }, { key: 'budget', label: 'งบ', type: 'money' }, { key: 'received_kg', label: 'รับแล้ว (กก.)', type: 'num' },
    { key: 'received_value', label: 'ยอดซื้อรับแล้ว', type: 'money' }, { key: 'open_po_value', label: 'สั่งแล้วรอรับ', type: 'money' }, { key: 'total', label: 'รวม', type: 'money' }, { key: 'remaining', label: 'คงเหลือ', type: 'money' }], r.months);
}
