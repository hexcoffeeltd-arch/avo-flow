// =====================================================================
// เอกสารและหน้าต่างที่ใช้ร่วมกันทุกหน้า: Lot trace, ใบรับเข้า, ใบตีออก/โอน,
// รับปลายทาง, ส่วนต่าง, ความสุก, งานสาขา (โอนภายใน/แช่แข็ง/ขาย/ตัดทิ้ง)
// =====================================================================
import { $, $$, esc, fmtN, fmtKg, fmtMoney, thDate, thDateY, thDateTime, todayISO, toLocalInput, fromLocalInput, ripBadge, statusBadge, RIP, RIP_ORDER, ZONE, ROLE, CHANNEL,
  openModal, openDrawer, confirmBox, toast, busy, opt, field, table, photoField, bindPhotoFields, showEvidence, formData, ADJ_KIND, pcs, fmtPcs, ICONS } from './ui.js';
import { qrSvg } from './qr.js';

const site = (ctx, id) => ctx.master.sites.find((s) => s.id === Number(id));
const zonesOf = (ctx, sid) => (site(ctx, sid)?.kind === 'warehouse' ? ['main', 'frozen'] : ['front', 'back', 'frozen']);
const done = (ctx, msg, res = null) => {
  if (res?._queued) { toast('ไม่มีสัญญาณ — บันทึกไว้ในเครื่องแล้ว ระบบจะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์'); return; }
  toast(msg, 'ok'); ctx.refreshBell(); if (ctx._onChange) ctx._onChange();
};
export { done };
export const onChange = (ctx, fn) => { ctx._onChange = fn; };

// ---------- เมนูผู้ใช้ ----------
export function userMenu(ctx) {
  const u = ctx.me;
  const m = openModal({ title: esc(u.display_name || u.email), sub: `${esc(ROLE[u.role])}${u.is_manager ? ' · ผู้จัดการ' : ''} · ${esc(u.site?.name || 'ทุกสาขา')}`, size: 'sm',
    body: `<div class="grid">${u.email ? `<div class="kv"><span>อีเมล</span><span>${esc(u.email)}</span></div>` : ''}
      <div class="kv"><span>โหมด</span><span>${ctx.api.mode === 'demo' ? 'ทดลอง (ข้อมูลจำลอง)' : ctx.api.mode === 'neon' ? 'ใช้งานจริง' : 'นักพัฒนา'}</span></div>
      <div class="kv"><span>ธีม</span><span><button class="link" id="theme">สลับ สว่าง/มืด</button></span></div>
      ${ctx.api.auth.canReset && u.email ? '<div class="kv"><span>รหัสผ่าน</span><span><button class="link" id="chpw">ส่งลิงก์เปลี่ยนรหัสผ่านไปที่อีเมล</button></span></div>' : ''}
      ${ctx.api.outbox ? `<div class="kv"><span>รายการรอส่ง (ออฟไลน์)</span><span><button class="link" id="obx">${ctx.api.outbox().length} รายการ</button></span></div>` : ''}</div>`,
    foot: `${ctx.api.mode === 'demo' ? '<div class="left"><button class="btn" id="reset">รีเซ็ตข้อมูลตัวอย่าง</button></div>' : ''}<button class="btn primary" id="out">${ctx.api.mode === 'demo' ? 'เปลี่ยนบทบาท' : 'ออกจากระบบ'}</button>` });
  $('#out', m.el).onclick = async () => { m.close(); await ctx.api.auth.signOut(); location.hash = ''; ctx.boot(); };
  $('#theme', m.el).onclick = () => { const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; try { localStorage.setItem('avoflow-theme', r.dataset.theme); } catch (e) { /* ignore */ } };
  const cp = $('#chpw', m.el); if (cp) cp.onclick = async () => { try { await ctx.api.auth.requestReset(u.email); toast(`ส่งลิงก์เปลี่ยนรหัสผ่านไปที่ ${u.email} แล้ว`, 'ok'); } catch (e) { toast(e.message, 'err'); } };
  const ob = $('#obx', m.el); if (ob) ob.onclick = () => { m.close(); outboxModal(ctx); };
  const rs = $('#reset', m.el); if (rs) rs.onclick = async () => { if (await confirmBox('รีเซ็ตข้อมูลตัวอย่าง', 'ข้อมูลที่ทดลองบันทึกไว้จะถูกลบและสร้างข้อมูลตัวอย่างใหม่')) { await ctx.api.resetDemo(); m.close(); toast('รีเซ็ตแล้ว', 'ok'); await ctx.reloadMe(); ctx.rerender(); } };
}

// =====================================================================
// Lot trace (เส้นทางสินค้าและเอกสาร)
// =====================================================================
export async function lotTrace(ctx, ref) {
  const d = openDrawer({ title: esc(typeof ref === 'string' ? ref : 'Lot'), sub: 'เส้นทางสินค้าและเอกสารที่เกี่ยวข้อง', body: '<div class="spinner"></div>' });
  let t;
  try { t = await ctx.api.rpc('api_lot_trace', typeof ref === 'string' ? { code: ref } : { lot_id: ref }); }
  catch (e) { d.setBody(`<div class="notice">${esc(e.message)}</div>`); return; }
  $('.drawer-head h3', d.el).textContent = t.code;
  const cls = (k) => (['partial', 'case', 'waste'].includes(k) ? 'warn' : '');
  d.setBody(`
    <div class="summary-box" style="margin-top:6px">
      <div class="strong">${esc(t.variety || '-')} · ${esc(t.size || '-')} ${t.product === 'frozen' ? '<span class="badge b-info">แช่แข็ง</span>' : ''}</div>
      <div class="small muted" style="margin-top:4px">${t.receipt ? `สวน <b>${esc(t.receipt.supplier)}</b>${t.receipt.province ? ' · ' + esc(t.receipt.province) : ''}${t.receipt.phone ? ' · ' + esc(t.receipt.phone) : ''}<br>รับเข้า ${thDateY(t.receipt.received_at)} · ${esc(t.receipt.doc_no)}` : ''}
      ${t.root ? `<br>แปรรูปจาก <button class="link" data-lot="${t.root.id}">${esc(t.root.code)}</button>` : ''}
      ${ctx.can.seeWarehouse ? ` · ต้นทุน ${fmtMoney(t.unit_cost)} บาท/กก.` : ''}
      ${t.avg_g ? `<br>เฉลี่ย ${fmtN(t.avg_g)} กรัม/ลูก` : ''}${Number(t.shrink_kg) ? ` · น้ำหนักหายระหว่างบ่ม ${fmtKg(t.shrink_kg)}` : ''}</div>
    </div>
    <div class="timeline">${t.events.map((e) => `<div class="tl-item ${cls(e.kind)}"><div class="tl-title">${esc(e.title)}</div>
      <div class="tl-detail">${thDate(e.at)} · ${esc(e.detail)}</div>
      ${e.dispatch_id ? `<button class="link small" data-dispatch="${e.dispatch_id}">เปิดใบ ${esc(e.doc_no)}</button>` : ''}
      ${e.invoice_id && ctx.can.invoices ? `<button class="link small" data-invoice="${e.invoice_id}">เปิดบิล</button>` : ''}
      ${e.return_id ? `<button class="link small" data-return="${e.return_id}">เปิด ${esc(e.doc_no)}</button>` : ''}
      ${e.credit_note_id && ctx.can.invoices ? `<button class="link small" data-cn="${e.credit_note_id}">เปิดใบลดหนี้</button>` : ''}
      ${e.lot_code && e.lot_code !== t.code ? `<button class="link small" data-lotcode="${esc(e.lot_code)}">เปิด ${esc(e.lot_code)}</button>` : ''}</div>`).join('') || '<div class="muted small">ยังไม่มีการเคลื่อนไหว</div>'}</div>
    ${t.open_cases ? '<span class="badge b-warn">มีงานรอตรวจสอบส่วนต่าง</span>' : ''}
    <div class="section-title">คงเหลือตอนนี้</div>
    ${t.balances.length ? t.balances.map((b) => `<div class="zone-row"><span>${esc(b.site)} · ${esc(ZONE[b.zone])} · ${RIP[b.ripeness]}</span><span class="num">${b.bags ? fmtN(b.bags) + ' ถุง · ' : ''}${fmtKg(b.kg)} <span class="small muted">${fmtPcs(b.kg, t.avg_g)}</span></span></div>`).join('') : '<div class="muted small">หมดแล้ว</div>'}
    <div class="section-title">ปลายทางทั้งหมดของ Lot นี้</div>
    ${t.destinations.length ? t.destinations.map((x) => `<div class="zone-row"><span>${esc(x.to)} <span class="muted small">${esc(x.doc_no)} · ${x.kind === 'sale' ? CHANNEL[x.channel] || 'ขาย' : 'โอนสาขา'}</span></span><span class="num">${fmtKg(x.kg)}${x.received_kg != null && Number(x.received_kg) !== Number(x.kg) ? ` <span class="small muted">(รับ ${fmtN(x.received_kg)})</span>` : ''}</span></div>`).join('') : '<div class="muted small">ยังไม่ได้ส่งออก</div>'}
    ${t.children.length ? `<div class="section-title">Lot ที่แปรรูปต่อ</div>${t.children.map((c) => `<button class="link" data-lot="${c.id}">${esc(c.code)}</button>`).join(' · ')}` : ''}
  `);
  $$('[data-dispatch]', d.el).forEach((b) => (b.onclick = () => dispatchView(ctx, Number(b.dataset.dispatch))));
  $$('[data-invoice]', d.el).forEach((b) => (b.onclick = async () => (await import('./salesdocs.js')).invoiceView(ctx, Number(b.dataset.invoice))));
  $$('[data-lot]', d.el).forEach((b) => (b.onclick = () => { d.close(); lotTrace(ctx, Number(b.dataset.lot)); }));
  $$('[data-return]', d.el).forEach((b) => (b.onclick = () => returnView(ctx, Number(b.dataset.return))));
  $$('[data-cn]', d.el).forEach((b) => (b.onclick = async () => (await import('./salesdocs.js')).creditNoteView(ctx, Number(b.dataset.cn))));
  $$('[data-lotcode]', d.el).forEach((b) => (b.onclick = () => { d.close(); lotTrace(ctx, b.dataset.lotcode); }));
}

export async function askLot(ctx) {
  const m = openModal({ title: 'ตรวจสอบ Lot', sub: 'พิมพ์เลข Lot หรือเลขบิล เพื่อย้อนดูสวนต้นทางและทุกปลายทาง', size: 'sm',
    body: field('เลข Lot / เลขบิล', '<input class="input" id="lot-q" placeholder="เช่น LOT-2609-001 หรือ INV-2609-001" autocomplete="off">') + '<div id="scan-box"></div>',
    foot: `<div class="left"><button class="btn" id="scan">${ICONS.qr} สแกน QR ป้าย Lot</button></div><button class="btn primary" id="go">ค้นหา</button>` });
  $('#scan', m.el).onclick = () => scanQR($('#scan-box', m.el), (text) => { const mm = /(LOT-[0-9A-Z-]+)/i.exec(text); $('#lot-q', m.el).value = (mm ? mm[1] : text).toUpperCase(); goFn(); });
  const goFn = async () => {
    const q = $('#lot-q', m.el).value.trim().toUpperCase(); if (!q) return;
    if (/^(INV|TIV|CS)-/.test(q)) { m.close(); (await import('./salesdocs.js')).invoiceView(ctx, null, q); return; }
    m.close(); lotTrace(ctx, q);
  };
  $('#go', m.el).onclick = goFn; $('#lot-q', m.el).onkeydown = (e) => { if (e.key === 'Enter') goFn(); }; $('#lot-q', m.el).focus();
}

// =====================================================================
// ใบรับเข้า
// =====================================================================
export function receiptForm(ctx, existing = null, opts = {}) {
  const M = ctx.master; const r = existing; let po = opts.po || null;
  const whs = M.sites.filter((s) => s.kind === 'warehouse' && s.active && ctx.can.actAt(s.id));
  const sups = M.suppliers.filter((s) => s.active || s.id === r?.supplier_id);
  const std = Number(M.settings?.thresholds?.std_basket_kg || 20);
  let tarePer = Number(M.settings?.thresholds?.basket_tare_kg ?? 1.5);
  let lines = r ? r.lines.map((l) => ({ tareAuto: false, costManual: true, id: l.id, variety_id: l.variety_id, size_id: l.size_id, ripeness: l.ripeness, baskets: l.baskets, gross_kg: l.is_estimated ? '' : l.gross_kg, tare_kg: l.is_estimated ? '' : l.tare_kg, unit_cost: l.unit_cost, lot_code: l.lot_code, estimated: l.is_estimated, pieces: l.pieces ?? '' }))
    : [{ tareAuto: true, variety_id: M.varieties[0]?.id, size_id: '', ripeness: 'raw', baskets: '', gross_kg: '', tare_kg: '', unit_cost: '', estimated: false, pieces: '' }];
  const poPrice = (l) => { if (!po) return null; const v = Number(l.variety_id); const z = Number(l.size_id) || null;
    const x = po.lines.filter((y) => y.variety_id === v && (y.size_id === z || y.size_id == null)).sort((a, b) => (a.size_id == null) - (b.size_id == null))[0]; return x ? x.price : null; };
  const applyPo = (l) => { if (po && !l.costManual) { const pr = poPrice(l); if (pr != null) l.unit_cost = String(pr); } };
  const autoTare = (l) => { if (l.tareAuto && !l.estimated) l.tare_kg = Number(l.baskets) > 0 && tarePer > 0 ? String(Math.round(Number(l.baskets) * tarePer * 100) / 100) : ''; };
  const m = openModal({ title: r ? `แก้ไขใบรับเข้า ${esc(r.doc_no)}` : 'รับเข้าสินค้าจากสวน', sub: 'ยึดน้ำหนักชั่งจริง (สุทธิ = น้ำหนักรวม − น้ำหนักตะกร้า) · สต็อกจะเพิ่มเมื่อยืนยันตรวจรับเท่านั้น', size: 'xl',
    body: `<div class="form-grid g4" id="rh">
        ${field('สวน / แหล่งที่มา', `<select class="input" name="supplier_id">${opt(sups, r?.supplier_id, (x) => x.name, (x) => x.id, '— เลือกสวน —')}</select>`, { req: true, hint: ctx.can.suppliers ? '<button class="link" id="add-sup" type="button">+ เพิ่มสวนใหม่</button>' : '' })}
        ${ctx.can.purchase ? field('ใบสั่งซื้อ (PO)', '<select class="input" id="po-sel"><option value="">— ไม่อ้างอิง —</option></select>', { hint: 'เลือกแล้วดึงสวนและราคาตามไซส์มาให้' }) : ''}
        ${field('วันเวลารับจริง', `<input class="input" type="datetime-local" name="received_at" value="${toLocalInput(r?.received_at)}">`, { req: true })}
        ${field('คลังที่รับ', `<select class="input" name="site_id">${opt(whs, r?.site_id ?? ctx.me.site_id ?? whs[0]?.id)}</select>`)}
        ${field('น้ำหนักตะกร้าเปล่า (กก./ใบ)', `<input class="input" type="number" min="0" step="0.01" inputmode="decimal" id="tare-per" value="${esc(tarePer)}">`, { hint: 'น้ำหนักตะกร้า = จำนวนตะกร้า × ค่านี้ (แก้รายบรรทัดได้)' })}
        ${field('หมายเหตุ', `<input class="input" name="note" value="${esc(r?.note || '')}">`, { cls: 'span-2' })}
        <div class="span-all">${photoField('evidence', 'ใบชั่ง / รูปสินค้า (แนะนำ)', false, r?.evidence || '')}</div>
      </div>
      <div class="notice info hidden" id="po-info" style="margin-top:10px"></div>
      <div class="section-title">รายการสินค้า <span class="muted small">(แต่ละบรรทัด = 1 Lot ใหม่ · แยก Lot ทุกรอบรับ)</span></div>
      <div id="rl"></div>
      <button class="btn sm" id="add-line" type="button" style="margin-top:8px">+ เพิ่มรายการ</button>
      <div class="summary-box" id="rsum" style="margin-top:14px"></div>`,
    foot: `<button class="btn" id="save-draft">บันทึกร่าง</button><button class="btn primary" id="save-submit">บันทึกและส่งตรวจรับ</button>` });
  bindPhotoFields(m.el, ctx.api);
  const supSel = $('[name=supplier_id]', m.el);
  const netOf = (l) => (l.estimated ? Number(l.baskets || 0) * std : l.gross_kg ? Number(l.gross_kg) - Number(l.tare_kg || 0) : 0);
  const draw = () => {
    $('#rl', m.el).innerHTML = table([
      { label: 'สายพันธุ์', render: (l, i) => `<select class="input" data-i="${i}" data-k="variety_id" style="min-width:120px">${opt(M.varieties.filter((v) => v.active || v.id === l.variety_id), l.variety_id)}</select>` },
      { label: 'ไซส์', render: (l, i) => `<select class="input" data-i="${i}" data-k="size_id" style="min-width:90px">${opt(M.sizes.filter((v) => v.active || v.id === l.size_id), l.size_id, (x) => x.name, (x) => x.id, '—')}</select>` },
      { label: 'ความสุก', render: (l, i) => `<select class="input" data-i="${i}" data-k="ripeness" style="min-width:90px">${RIP_ORDER.map((k) => `<option value="${k}" ${l.ripeness === k ? 'selected' : ''}>${RIP[k]}</option>`).join('')}</select>` },
      { label: 'ตะกร้า', render: (l, i) => `<input class="input num" type="number" min="0" step="1" inputmode="numeric" data-i="${i}" data-k="baskets" value="${esc(l.baskets)}" style="width:80px">` },
      { label: 'ยังไม่ชั่ง', render: (l, i) => `<label class="check" title="ประมาณจากจำนวนตะกร้า × ${std} กก. แล้วค่อยชั่งจริงตอนตรวจรับ"><input type="checkbox" data-i="${i}" data-k="estimated" ${l.estimated ? 'checked' : ''}> ประมาณ</label>` },
      { label: 'น้ำหนักรวม (กก.)', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" data-k="gross_kg" value="${esc(l.gross_kg)}" style="width:110px" ${l.estimated ? 'disabled placeholder="ชั่งตอนตรวจรับ"' : ''}>` },
      { label: 'น้ำหนักตะกร้า (กก.)', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" data-k="tare_kg" value="${esc(l.tare_kg)}" style="width:110px" ${l.estimated ? 'disabled' : ''}>${!l.estimated && l.tareAuto && Number(l.baskets) > 0 ? `<div class="small muted" data-tare-hint>${fmtN(l.baskets)} × ${fmtN(tarePer)}</div>` : '<div class="small muted" data-tare-hint></div>'}` },
      { label: 'สุทธิ (กก.)', right: true, render: (l) => `<b data-net>${netOf(l) ? fmtN(netOf(l)) : '—'}</b>${l.estimated ? '<div class="small muted">ประมาณ</div>' : ''}` },
      { label: 'จำนวนลูก', render: (l, i) => `<input class="input num" type="number" min="1" step="1" inputmode="numeric" data-i="${i}" data-k="pieces" value="${esc(l.pieces)}" style="width:86px" placeholder="ถ้านับ">` },
      { label: 'ราคาซื้อ/กก.', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" data-k="unit_cost" value="${esc(l.unit_cost)}" style="width:96px">` },
      { label: 'Lot', render: (l) => `<span class="small muted">${esc(l.lot_code || 'ออกเลขอัตโนมัติ')}</span>` },
      { label: '', render: (l, i) => (lines.length > 1 ? `<button class="btn sm ghost" data-del="${i}" type="button" aria-label="ลบ">✕</button>` : '') },
    ], lines);
    $$('#rl [data-k]', m.el).forEach((el) => (el.oninput = el.onchange = () => { const l = lines[el.dataset.i]; const k = el.dataset.k;
      l[k] = el.type === 'checkbox' ? el.checked : el.value;
      if (k === 'estimated') { draw(); return; }
      if (k === 'tare_kg') l.tareAuto = el.value === '';
      if (k === 'unit_cost') l.costManual = el.value !== '';
      if ((k === 'variety_id' || k === 'size_id') && po && !l.costManual) { applyPo(l); const c = $('[data-k="unit_cost"]', el.closest('tr')); if (c) c.value = l.unit_cost; }
      const tr = el.closest('tr');
      if (k === 'baskets' && l.tareAuto) { autoTare(l); const t = $('[data-k="tare_kg"]', tr); if (t) t.value = l.tare_kg;
        const h = $('[data-tare-hint]', tr); if (h) h.textContent = Number(l.baskets) > 0 && tarePer > 0 ? `${fmtN(l.baskets)} × ${fmtN(tarePer)}` : ''; }
      if (['gross_kg', 'tare_kg', 'baskets'].includes(k)) $('[data-net]', tr).textContent = netOf(l) ? fmtN(netOf(l)) : '—'; sum(); }));
    $$('#rl [data-del]', m.el).forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
    sum();
  };
  const sum = () => {
    const bk = lines.reduce((a, l) => a + Number(l.baskets || 0), 0); const net = lines.reduce((a, l) => a + netOf(l), 0);
    const cost = lines.reduce((a, l) => a + netOf(l) * Number(l.unit_cost || 0), 0);
    const warn = lines.filter((l) => !l.estimated && Number(l.baskets) > 0 && l.gross_kg && Math.abs((l.gross_kg - (l.tare_kg || 0)) - l.baskets * std) / (l.baskets * std) > Number(M.settings?.thresholds?.weight_variance_pct || 5) / 100);
    $('#rsum', m.el).innerHTML = `<b>${fmtN(bk)}</b> ตะกร้า · น้ำหนักสุทธิ <b>${fmtKg(net)}</b>${lines.some((l) => l.estimated) ? ' (มีรายการประมาณ — ต้องชั่งจริงตอนตรวจรับ)' : ''}${ctx.can.seeWarehouse ? ` · ต้นทุนรวม <b>${fmtMoney(cost)}</b> บาท` : ''}
      ${warn.length ? `<div class="small" style="color:var(--warn-ink);margin-top:6px">⚠ น้ำหนักชั่งจริงต่างจากค่ามาตรฐาน ${std} กก./ตะกร้า เกินเกณฑ์ — ระบบยึดน้ำหนักชั่งจริง ตรวจสอบอีกครั้งก่อนบันทึก</div>` : ''}`;
  };
  supSel.onchange = () => { if (po) return; const s = M.suppliers.find((x) => x.id === Number(supSel.value)); if (s?.buy_price) { lines.forEach((l) => { if (!l.unit_cost) l.unit_cost = s.buy_price; }); draw(); } };
  // ใบสั่งซื้อ: ใช้สวน/คลัง/ราคาจาก PO · ถ้ายังไม่กรอกรายการ ดึงรายการจาก PO ให้
  const poSel = $('#po-sel', m.el);
  const usePo = (x, fill) => {
    po = x; supSel.disabled = !!po; const sp = $('#po-info', m.el);
    if (po) { supSel.value = po.supplier_id; const ss = $('[name=site_id]', m.el); if (ss) ss.value = po.site_id;
      if (fill && lines.every((l) => !l.gross_kg && !l.baskets)) lines = po.lines.map((pl) => ({ tareAuto: true, costManual: false, variety_id: pl.variety_id, size_id: pl.size_id ?? '', ripeness: 'raw', baskets: '', gross_kg: '', tare_kg: '', unit_cost: String(pl.price), estimated: false, pieces: '' }));
      lines.forEach(applyPo); }
    if (sp) sp.innerHTML = po ? `ใบสั่งซื้อ ${esc(po.doc_no)} · ${esc(po.supplier)} · สั่ง ${fmtKg(po.total_kg)} · รับแล้ว ${fmtKg(po.received_kg)} · ราคา: ${po.lines.map((pl) => `${esc(pl.variety)} ${esc(pl.size || 'ทุกไซส์')} ${fmtMoney(pl.price)}`).join(' · ')}` : '';
    if (sp) sp.classList.toggle('hidden', !po);
    draw();
  };
  if (poSel) {
    ctx.api.rpc('api_pos', { open: true, limit: 200 }).then(async (list) => {
      const cur = po || (r?.po_id ? await ctx.api.rpc('api_po_get', { id: r.po_id }).catch(() => null) : null);
      if (cur && !list.some((x) => x.id === cur.id)) list.unshift(cur);
      poSel.innerHTML = '<option value="">— ไม่อ้างอิง —</option>' + list.map((x) => `<option value="${x.id}" ${cur?.id === x.id ? 'selected' : ''}>${esc(x.doc_no)} · ${esc(x.supplier)}</option>`).join('');
      if (cur) usePo(cur.lines ? cur : await ctx.api.rpc('api_po_get', { id: cur.id }), !r);
    }).catch(() => {});
    poSel.onchange = async () => { if (!poSel.value) { usePo(null); return; } try { usePo(await ctx.api.rpc('api_po_get', { id: Number(poSel.value) }), true); } catch (e) { toast(e.message, 'err'); } };
  }
  $('#add-line', m.el).onclick = () => { const last = lines[lines.length - 1] || {}; lines.push({ tareAuto: true, variety_id: last.variety_id, size_id: '', ripeness: last.ripeness || 'raw', baskets: '', gross_kg: '', tare_kg: '', unit_cost: last.unit_cost || '', estimated: !!last.estimated, pieces: '' }); draw(); };
  $('#tare-per', m.el).oninput = (e) => { tarePer = Number(e.target.value || 0); lines.forEach(autoTare); draw(); };
  const addSup = $('#add-sup', m.el); if (addSup) addSup.onclick = () => supplierForm(ctx, null, async (s) => { await ctx.reloadMe(); supSel.innerHTML = opt(ctx.master.suppliers.filter((x) => x.active), s.id, (x) => x.name, (x) => x.id, '— เลือกสวน —'); M.suppliers = ctx.master.suppliers; supSel.onchange(); });
  const save = (submit) => async (e) => busy(e.currentTarget, async () => {
    const h = formData($('#rh', m.el));
    const res = await ctx.api.rpc('api_receipt_save', { id: r?.id, po_id: po?.id ?? null, supplier_id: po ? po.supplier_id : h.supplier_id, site_id: h.site_id, received_at: fromLocalInput(h.received_at), note: h.note, evidence: h.evidence, submit,
      lines: lines.map((l) => ({ id: l.id, variety_id: l.variety_id, size_id: l.size_id, ripeness: l.ripeness, baskets: l.baskets || 0, estimated: !!l.estimated,
        gross_kg: l.estimated ? null : l.gross_kg, tare_kg: l.estimated ? 0 : l.tare_kg || 0, pieces: l.pieces || null, unit_cost: l.unit_cost || 0 })) });
    m.close(); done(ctx, submit ? `ส่งตรวจรับ ${res.doc_no} แล้ว` : `บันทึกร่าง ${res.doc_no} แล้ว`, res); if (!res._queued) receiptView(ctx, res.id);
  });
  $('#save-draft', m.el).onclick = save(false); $('#save-submit', m.el).onclick = save(true);
  draw();
}

export async function receiptView(ctx, id) {
  const r = await ctx.api.rpc('api_receipt_get', { id });
  const open = ['draft', 'pending_check'].includes(r.status);
  const canConfirm = open && ctx.can.receive && ctx.can.actAt(r.site_id);
  const m = openModal({ title: `ใบรับเข้า ${esc(r.doc_no)}`, sub: `${esc(r.supplier)} · ${thDateTime(r.received_at)} · ${esc(r.site)}${r.po_no ? ` · อ้างอิง ${esc(r.po_no)}` : ''}`, size: 'xl',
    body: `<div class="actions" style="margin-bottom:14px">${statusBadge('receipt', r.status)}
        <span class="small muted">บันทึกโดย ${esc(r.created_by_name || '-')}${r.checked_by_name ? ` · ตรวจรับโดย ${esc(r.checked_by_name)} ${thDateTime(r.checked_at)}` : ''}</span></div>
      ${r.status === 'pending_check' ? `<div class="notice">รอตรวจรับ: ชั่งน้ำหนักจริง คัดลูกช้ำ/ลายออก แล้วกรอก "คัดออก" ก่อนกดยืนยัน — สต็อกจะเพิ่มตามน้ำหนักรับจริงเท่านั้น${r.lines.some((l) => l.is_estimated) ? '<br><b>มีรายการที่รับแบบประมาณ</b> กรอกน้ำหนักรวมและน้ำหนักตะกร้าที่ชั่งจริงก่อนยืนยัน' : ''}</div>` : ''}
      ${r.cancel_reason ? `<div class="notice">${r.status === 'reversed' ? 'กลับรายการ' : 'ยกเลิก'}: ${esc(r.cancel_reason)}</div>` : ''}
      ${table([
        { label: 'Lot', render: (l) => `<span class="lot">${esc(l.lot_code)}</span>` },
        { label: 'สินค้า', render: (l) => `${esc(l.variety)} · ${esc(l.size)}` },
        { label: 'ความสุก', render: (l) => ripBadge(l.ripeness) },
        { label: 'ตะกร้า', right: true, render: (l) => `${fmtN(l.baskets)}${l.pieces ? `<div class="small muted">${fmtN(l.pieces)} ลูก</div>` : ''}` },
        { label: 'รวม', right: true, render: (l) => (canConfirm && l.is_estimated ? `<input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-gross="${l.id}" placeholder="ชั่งจริง">` : `${fmtN(l.gross_kg)}${l.est_kg != null && !l.is_estimated ? `<div class="small muted">ประมาณไว้ ${fmtN(l.est_kg)}</div>` : ''}`) },
        { label: 'ตะกร้าเปล่า', right: true, render: (l) => (canConfirm && l.is_estimated ? `<input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-tare="${l.id}" placeholder="0">` : fmtN(l.tare_kg)) },
        { label: 'สุทธิ', right: true, render: (l) => (l.is_estimated ? `<b data-netv="${l.id}">≈ ${fmtN(l.net_kg)}</b><div class="small" style="color:var(--warn-ink)">ประมาณ · ต้องชั่งจริง</div>` : `<b>${fmtN(l.net_kg)}</b>`) },
        { label: 'คัดออก (กก.)', right: true, render: (l) => (canConfirm ? `<input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-rej="${l.id}" value="${Number(l.rejected_kg) || ''}" placeholder="0">` : fmtN(l.rejected_kg)) },
        { label: 'รับจริง', right: true, render: (l) => `<b data-acc="${l.id}">${l.accepted_kg != null ? fmtN(l.accepted_kg) : fmtN(l.net_kg)}</b>` },
        ...(ctx.can.seeWarehouse ? [{ label: 'ราคา/กก.', right: true, render: (l) => fmtMoney(l.unit_cost) }] : []),
      ], r.lines, { rowAttr: (l) => (r.status === 'confirmed' ? `class="click" data-lot="${l.lot_id}"` : '') })}
      <div class="split" style="margin-top:14px"><div>${canConfirm ? photoField('evidence', 'รูปหลักฐานตอนตรวจรับ') : ''}${r.note ? `<div class="small muted" style="margin-top:8px">หมายเหตุ: ${esc(r.note)}</div>` : ''}</div>
        <div><div class="small muted" style="margin-bottom:6px">หลักฐานที่แนบ</div><div id="ev"></div></div></div>`,
    foot: `<div class="left">${open && ctx.can.receive ? '<button class="btn" id="edit">แก้ไข</button><button class="btn danger" id="cancel">ยกเลิกใบ</button>' : ''}
        ${r.status === 'confirmed' && ctx.can.approveAt(r.site_id) ? '<button class="btn danger" id="reverse">กลับรายการ</button>' : ''}
        ${r.status === 'confirmed' ? '<button class="btn" id="labels">พิมพ์ป้าย Lot</button>' : ''}</div>
      ${r.status === 'draft' && ctx.can.receive ? '<button class="btn" id="submit">ส่งตรวจรับ</button>' : ''}
      ${canConfirm ? '<button class="btn primary" id="confirm">ยืนยันตรวจรับ · เพิ่มสต็อก</button>' : ''}` });
  showEvidence($('#ev', m.el), r.evidence, ctx.api);
  bindPhotoFields(m.el, ctx.api);
  const netNow = (l) => { const g = $(`[data-gross="${l.id}"]`, m.el); return g ? Number(g.value || 0) - Number($(`[data-tare="${l.id}"]`, m.el).value || 0) : Number(l.net_kg); };
  const recalc = (id) => { const l = r.lines.find((x) => x.id === id); const rej = $(`[data-rej="${id}"]`, m.el); $(`[data-acc="${id}"]`, m.el).textContent = fmtN(netNow(l) - Number(rej?.value || 0));
    const nv = $(`[data-netv="${id}"]`, m.el); if (nv && $(`[data-gross="${id}"]`, m.el).value) nv.textContent = fmtN(netNow(l)); };
  $$('[data-rej]', m.el).forEach((inp) => (inp.oninput = () => recalc(Number(inp.dataset.rej))));
  const tarePer = Number(ctx.master.settings?.thresholds?.basket_tare_kg ?? 1.5);
  r.lines.forEach((l) => { const t = $(`[data-tare="${l.id}"]`, m.el); if (t && Number(l.baskets) > 0 && tarePer > 0) { t.value = Math.round(Number(l.baskets) * tarePer * 100) / 100; t.title = `${l.baskets} ตะกร้า × ${tarePer} กก.`; } });
  $$('[data-gross],[data-tare]', m.el).forEach((inp) => (inp.oninput = () => recalc(Number(inp.dataset.gross || inp.dataset.tare))));
  $$('[data-lot]', m.el).forEach((tr) => (tr.onclick = () => lotTrace(ctx, Number(tr.dataset.lot))));
  const b = (sel, fn) => { const el = $(sel, m.el); if (el) el.onclick = fn; };
  b('#edit', () => { m.close(); receiptForm(ctx, r); });
  b('#submit', (e) => busy(e.currentTarget, async () => {
    await ctx.api.rpc('api_receipt_save', { id: r.id, supplier_id: r.supplier_id, site_id: r.site_id, received_at: r.received_at, note: r.note, submit: true, lines: r.lines.map((l) => ({ id: l.id, variety_id: l.variety_id, size_id: l.size_id, ripeness: l.ripeness, baskets: l.baskets, estimated: l.is_estimated, gross_kg: l.gross_kg, tare_kg: l.tare_kg, pieces: l.pieces, unit_cost: l.unit_cost })) });
    m.close(); done(ctx, 'ส่งตรวจรับแล้ว'); receiptView(ctx, r.id);
  }));
  b('#confirm', (e) => busy(e.currentTarget, async () => {
    const lines = $$('[data-rej]', m.el).map((i) => { const id = Number(i.dataset.rej); const g = $(`[data-gross="${id}"]`, m.el);
      return { id, rejected_kg: Number(i.value || 0), ...(g ? { gross_kg: g.value === '' ? null : Number(g.value), tare_kg: Number($(`[data-tare="${id}"]`, m.el).value || 0) } : {}) }; });
    const res = await ctx.api.rpc('api_receipt_confirm', { id: r.id, lines, evidence: $('[name=evidence]', m.el)?.value || null });
    m.close(); done(ctx, `ยืนยันรับเข้า ${res.doc_no} · เพิ่มสต็อก ${fmtKg(res.total_accepted)}`);
  }));
  b('#cancel', async () => { const why = await confirmBox('ยกเลิกใบรับเข้า', `ยกเลิก ${esc(r.doc_no)} และ Lot ที่ออกไว้`, { ok: 'ยกเลิกใบ', danger: true, input: { label: 'เหตุผล' } }); if (why === null) return;
    try { await ctx.api.rpc('api_receipt_cancel', { id: r.id, reason: why }); m.close(); done(ctx, 'ยกเลิกแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  b('#reverse', async () => { const why = await confirmBox('กลับรายการรับเข้า', 'ระบบจะสร้างรายการตรงข้ามเพื่อลดสต็อกกลับ (ไม่ลบรายการเดิม) ทำได้เมื่อ Lot ยังไม่ถูกเคลื่อนไหว', { ok: 'กลับรายการ', danger: true, input: { label: 'เหตุผล', required: true } }); if (!why) return;
    try { await ctx.api.rpc('api_receipt_reverse', { id: r.id, reason: why }); m.close(); done(ctx, 'กลับรายการแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  b('#labels', () => printLabels(r));
}

// ลิงก์ที่ฝังใน QR: สแกนด้วยกล้องมือถือแล้วเปิดประวัติ Lot ในระบบได้ทันที
export const lotUrl = (code) => location.origin + location.pathname + '#/lot/' + encodeURIComponent(code);
function printLabels(r) {
  openModal({ title: 'ป้าย Lot', sub: 'พิมพ์แล้วติดที่ตะกร้า · สแกน QR ด้วยกล้องมือถือเพื่อเปิดประวัติ Lot', size: 'lg', foot: '<button class="btn primary" onclick="window.print()">พิมพ์</button>',
    body: `<div class="print-area label-grid">${r.lines.map((l) => `
      <div class="lot-label"><div class="lot-label-qr">${qrSvg(lotUrl(l.lot_code), 104)}</div><div style="min-width:0">
      <div style="font-size:21px;font-weight:700;letter-spacing:.02em">${esc(l.lot_code)}</div>
      <div>${esc(l.variety)} · ${esc(l.size)} · ${RIP[l.ripeness]}</div><div class="small">${esc(r.supplier)} · รับ ${thDateY(r.received_at)}</div>
      <div class="small">${fmtN(l.baskets)} ตะกร้า · ${fmtKg(l.accepted_kg ?? l.net_kg)}${l.pieces ? ' · ' + fmtN(l.pieces) + ' ลูก' : ''} · ${esc(r.doc_no)}</div></div></div>`).join('')}</div>` });
}
export { printLabels };

// สแกน QR ด้วยกล้อง (Chrome/Edge บน Android และเดสก์ท็อป) · ถ้าเบราว์เซอร์ไม่รองรับ ให้ใช้แอปกล้องสแกนแทน
export async function scanQR(box, onText) {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    box.innerHTML = '<div class="notice info" style="margin-top:10px">เบราว์เซอร์นี้สแกนในแอปไม่ได้ — เปิดแอปกล้องของมือถือแล้วส่องที่ QR บนป้าย Lot ระบบจะเปิดประวัติ Lot ให้อัตโนมัติ</div>'; return;
  }
  let stream; let stop = false;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch (e) { box.innerHTML = '<div class="notice" style="margin-top:10px">เปิดกล้องไม่ได้ (ต้องอนุญาตการใช้กล้อง)</div>'; return; }
  box.innerHTML = '<video class="scan-video" playsinline muted></video><div class="small muted">ส่องกล้องที่ QR บนป้าย Lot</div>';
  const v = $('video', box); v.srcObject = stream; await v.play().catch(() => {});
  const det = new window.BarcodeDetector({ formats: ['qr_code'] });
  const end = () => { stop = true; stream.getTracks().forEach((t) => t.stop()); };
  const obs = new MutationObserver(() => { if (!box.isConnected) { end(); obs.disconnect(); } }); obs.observe(document.body, { childList: true, subtree: true });
  const tick = async () => { if (stop) return; try { const c = await det.detect(v); if (c[0]?.rawValue) { end(); box.innerHTML = ''; onText(c[0].rawValue); return; } } catch (e) { /* ignore */ } setTimeout(tick, 250); };
  tick();
}

// =====================================================================
// ใบตีออก / ใบโอน
// รุ่น 2.5: 1 แถวต่อ Lot กรอกน้ำหนักที่จ่ายแยก ดิบ/ห่าม/สุก/สุกมาก ได้เอง (ระบบปรับความสุกในสต็อกให้ตอนยืนยัน)
//           ตีออกเกินยอดได้ (Lot ติดลบ · ผู้จัดการยืนยัน) เว้นแต่ปิดในตั้งค่า · แก้ใบที่ตีออกแล้ว (ปลายทางยังไม่รับ)
// =====================================================================
const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// แบ่งจำนวนเต็ม n ตามสัดส่วนน้ำหนัก (ผลรวมเท่า n เสมอ) — ใช้แบ่งตะกร้า/ถุง/ลูกของ Lot ไปยังแต่ละความสุก
export function apportion(weights, n) {
  const W = weights.reduce((a, w) => a + w, 0); n = Math.max(0, Math.round(Number(n) || 0));
  if (!W || !n) return weights.map(() => 0);
  const raw = weights.map((w) => (n * w) / W); const out = raw.map(Math.floor);
  let left = n - out.reduce((a, v) => a + v, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).forEach(([, i]) => { if (left > 0) { out[i] += 1; left -= 1; } });
  return out;
}
const NEG_RE = /^ต้องยืนยันการตีออกเกินยอด[^:]*:\s*/;
// เรียกคำสั่งที่อาจต้องยืนยันตีออกเกินยอด: ครั้งแรกไม่ยืนยัน ถ้าระบบแจ้งว่า Lot จะติดลบ ให้ผู้ใช้ยืนยันแล้วส่งอีกครั้ง
// ส่งรายการที่ผู้ใช้เห็นบนจอกลับไปด้วย — ถ้ายอดเปลี่ยนไประหว่างนั้น (มีคนตัด Lot เดียวกัน) ระบบจะแจ้งรายการใหม่ให้ยืนยันอีกครั้ง
async function withNegConfirm(call) {
  let ack = false;
  for (let i = 0; i < 4; i++) {
    try { return await call(ack); }
    catch (e) {
      if (!NEG_RE.test(e.message || '')) throw e;
      const list = e.message.replace(NEG_RE, '');
      const items = list.split(' · ').map((x) => `<li>${esc(x)}</li>`).join('');
      const ok = await confirmBox('ตีออกเกินยอด — Lot จะติดลบ', `${ack ? '<b>ยอดสต็อกเปลี่ยนไปจากเมื่อครู่</b> กรุณาตรวจรายการอีกครั้ง · ' : ''}ยอดในระบบของ Lot ต่อไปนี้ไม่พอ ถ้ายืนยัน ยอด Lot จะติดลบ และขึ้นในรายการแจ้งเตือน "ยอด Lot ติดลบ รอเคลียร์"</p><ul class="neg-list">${items}</ul><p style="margin:0">`,
        { ok: 'ยืนยันตีออกเกินยอด', danger: true });
      if (!ok) return null;
      ack = list;
    }
  }
  throw new Error('ยอดสต็อกเปลี่ยนระหว่างยืนยันหลายครั้ง กรุณาเปิดใบใหม่แล้วลองอีกครั้ง');
}

export async function dispatchForm(ctx, opts = {}) {
  const M = ctx.master; const ex = opts.existing || null; const reedit = ex?.status === 'shipped';
  const fromSites = M.sites.filter((s) => (reedit ? s.id === ex.from_site_id : s.active && ctx.can.actAt(s.id)));
  if (!fromSites.length) { toast('ไม่มีสิทธิ์ตีออกจากสถานที่ใด', 'err'); return; }
  const allowNeg = M.settings?.options?.allow_negative_dispatch !== false;
  const st = {
    kind: ex?.kind || opts.kind || 'transfer', from: ex?.from_site_id || opts.from_site_id || fromSites[0].id, fromZone: ex?.from_zone || opts.from_zone || null,
    to: ex?.to_site_id || opts.to_site_id || null, cust: ex?.customer_id || opts.customer_id || null,
    picks: {}, // lot_id → { kg: { raw, breaking, ripe, overripe | na }, units (ตะกร้า/ถุง), pieces, detail, manual }
    zero: false, q: '', vr: '',
  };
  const pick = (lot) => (st.picks[lot] = st.picks[lot] || { kg: {}, units: null, pieces: null, detail: '', manual: false });
  const addLine = (l) => { const p = pick(l.lot_id); p.kg[l.ripeness] = R2((p.kg[l.ripeness] || 0) + Number(l.kg));
    const u = Number((l.ripeness === 'na' ? l.bags : l.baskets) || 0); if (u) p.units = (p.units || 0) + u;
    if (l.pieces) p.pieces = (p.pieces || 0) + Number(l.pieces); if (l.detail && !p.detail) p.detail = l.detail; };
  (ex?.lines || []).forEach(addLine); (opts.preset || []).forEach(addLine);
  const m = openModal({ title: reedit ? `แก้ไขใบที่ตีออกแล้ว ${esc(ex.doc_no)}` : ex ? `แก้ไข ${esc(ex.doc_no)}` : 'สร้างใบตีออก / ใบโอน',
    sub: reedit ? 'ปลายทางยังไม่ยืนยันรับ · ระบบจะกลับรายการเดิม แล้วตัดสต็อกใหม่ตามตัวเลขที่แก้'
      : `กรอกน้ำหนักที่จ่ายแยกตามความสุกได้เอง · ระบบเรียง Lot ที่สุกก่อน → รับเข้าก่อน${allowNeg ? '' : ' · ห้ามจ่ายเกินยอดพร้อมใช้'}`, size: 'xl',
    body: `<div class="seg" id="kind"><button data-k="transfer">โอนไปสาขา / คลัง</button><button data-k="sale">ขาย / ส่งลูกค้า · DC · ONLINE · TIKTOK</button></div>
      <div class="form-grid g4" id="dh"></div>
      <div class="form-grid g4" id="dx" style="margin-top:12px">
        ${field('วันที่ตีออก', `<input class="input" type="date" name="doc_date" value="${esc(ex?.doc_date || opts.doc_date || todayISO())}">`, { req: true })}
        ${field('รายละเอียดในใบตีออก', `<textarea class="input" name="details" rows="2" maxlength="1000" placeholder="ข้อความที่ต้องการให้แสดงในใบตีออก (PDF) เช่น เวลานัดส่ง ผู้ติดต่อ เงื่อนไขการรับของ">${esc(ex?.details || '')}</textarea>`, { cls: 'span-3' })}
        ${reedit ? field('เหตุผลที่แก้ไข', '<input class="input" name="edit_reason" maxlength="200" placeholder="เช่น ชั่งใหม่ / แบ่งความสุกใหม่ / ลูกค้าขอเพิ่ม">', { req: true, cls: 'span-all' }) : ''}
        <div class="span-all">${photoField('ship_evidence', 'รูปสินค้าก่อนส่ง / ใบส่งของ', false, ex?.ship_evidence || '')}</div></div>
      <div class="section-title lp-head"><span>เลือก Lot และกรอกน้ำหนักที่จ่าย (กก.)</span>
        <span class="actions"><input class="input" id="lq" type="search" placeholder="ค้นหา Lot / พันธุ์ / สวน" style="width:190px;height:34px">
        <select class="input" id="f-var" style="width:140px;height:34px">${opt(M.varieties, '', (x) => x.name, (x) => x.id, 'ทุกสายพันธุ์')}</select>
        <input class="input" id="need" type="number" min="0" step="0.01" placeholder="ต้องการ (กก.)" style="width:130px;height:34px" value="${esc(opts.need ?? '')}">
        <button class="btn sm" id="suggest" type="button">แนะนำอัตโนมัติ</button></span></div>
      ${allowNeg ? '<label class="check small lp-zero"><input type="checkbox" id="zero"> แสดง Lot ที่ยอดเป็น 0 / ติดลบด้วย (ที่เคลื่อนไหวใน 30 วัน)</label>' : ''}
      <div id="lots"><div class="spinner"></div></div>
      <div class="summary-box" id="dsum" style="margin-top:12px"></div>`,
    foot: reedit ? '<button class="btn primary" id="resave">บันทึกการแก้ไข · ตัดสต็อกใหม่</button>'
      : '<button class="btn" id="save">บันทึกร่าง · จองสต็อก</button><button class="btn primary" id="ship">ยืนยันตีออกทันที</button>' });
  let lots = [];
  const frozen = () => st.fromZone === 'frozen';
  const rips = () => (frozen() ? ['na'] : RIP_ORDER);
  const lotOf = (id) => lots.find((x) => x.lot_id === Number(id));
  const have = (l, r) => Number(l?.rip.find((x) => x.ripeness === r)?.kg || 0);
  const sumKg = (p) => R2(Object.values(p?.kg || {}).reduce((a, v) => a + (Number(v) || 0), 0));
  const unitsOf = (l) => Number(frozen() ? l.bags : l.baskets) || 0;
  const header = () => {
    const isSale = st.kind === 'sale'; const fk = site(ctx, st.from)?.kind;
    const zones = zonesOf(ctx, st.from); if (!st.fromZone || !zones.includes(st.fromZone)) st.fromZone = fk === 'warehouse' ? 'main' : 'back';
    $$('#kind button', m.el).forEach((b) => { b.classList.toggle('active', b.dataset.k === st.kind); b.disabled = reedit; });
    $('#dh', m.el).innerHTML = `
      ${field('ต้นทาง', `<select class="input" name="from_site_id" ${reedit ? 'disabled' : ''}>${opt(fromSites, st.from)}</select>`, { req: true })}
      ${field('จุดจัดเก็บต้นทาง', `<select class="input" name="from_zone" ${reedit ? 'disabled' : ''}>${zones.map((z) => `<option value="${z}" ${z === st.fromZone ? 'selected' : ''}>${ZONE[z]}</option>`).join('')}</select>`)}
      ${isSale ? field('ลูกค้า / ช่องทาง', `<select class="input" name="customer_id">${opt(M.customers.filter((c) => c.active || c.id === Number(st.cust)), st.cust, (c) => `${c.name} (${CHANNEL[c.channel] || c.channel})`, (c) => c.id, '— เลือกลูกค้า —')}</select>`,
          { req: true, hint: ctx.can.addCustomer ? '<button class="link" id="add-cust" type="button">+ เพิ่มลูกค้าใหม่</button>' : 'ไม่มีในรายการ → ให้ฝ่ายขายเพิ่มลูกค้า' })
        : field('ปลายทาง (สาขา/คลัง)', `<select class="input" name="to_site_id">${opt(M.sites.filter((s) => (s.active || s.id === Number(st.to)) && s.id !== Number(st.from)), st.to, (s) => s.name, (s) => s.id, '— เลือกปลายทาง —')}</select>`,
          { req: true, hint: ctx.can.settings ? '<a class="link" href="#/settings/master">+ เพิ่มสาขา / คลัง</a>' : 'ไม่มีในรายการ → ให้ Admin เพิ่มสาขาที่ ตั้งค่า' })}
      ${field('ผู้ขนส่ง', `<input class="input" name="carrier" value="${esc(ex?.carrier || '')}" placeholder="เช่น รถบริษัท / Kerry Cool">`)}
      ${field('ทะเบียนรถ / เลขพัสดุ', `<input class="input" name="vehicle" value="${esc(ex?.vehicle || '')}">`)}
      ${field('ผู้แพ็ค / ผู้จ่าย', `<input class="input" name="packer" value="${esc(ex?.packer || ctx.me.display_name || '')}">`)}
      ${field('หมายเหตุ', `<input class="input" name="note" value="${esc(ex?.note || '')}">`, { cls: 'span-2' })}`;
    $('[name=from_site_id]', m.el).onchange = (e) => { st.from = Number(e.target.value); st.picks = {}; header(); loadLots(); };
    $('[name=from_zone]', m.el).onchange = (e) => { st.fromZone = e.target.value; st.picks = {}; loadLots(); };
    const ts = $('[name=to_site_id]', m.el); if (ts) ts.onchange = (e) => { st.to = e.target.value; };
    const cs = $('[name=customer_id]', m.el); if (cs) cs.onchange = (e) => { st.cust = e.target.value; };
    const ac = $('#add-cust', m.el); if (ac) ac.onclick = async () => (await import('./salesdocs.js')).customerForm(ctx, null, (c) => { st.cust = c.id; M.customers = ctx.master.customers; header(); });
    const al = $('#dh a.link', m.el); if (al) al.onclick = () => m.close();
    const sb = $('#ship', m.el); if (sb) sb.classList.toggle('hidden', !ctx.can.approveAt(st.from));
  };
  const loadLots = async () => {
    $('#lots', m.el).innerHTML = '<div class="spinner"></div>'; const prev = lots;
    try { lots = await ctx.api.rpc('api_dispatch_lots', { site_id: st.from, zone: st.fromZone, dispatch_id: ex?.id, include_zero: st.zero });
      // Lot ที่กรอกไว้แล้วต้องยังเห็นอยู่ในรายการ (เช่น เลิกติ๊ก "แสดง Lot ที่ยอดเป็น 0") — ไม่ให้มีรายการที่มองไม่เห็นถูกบันทึก
      Object.keys(st.picks).forEach((id) => { if (lots.some((l) => l.lot_id === Number(id))) return;
        const o = prev.find((l) => l.lot_id === Number(id)); if (o && sumKg(st.picks[id]) > 0) lots.push(o); else delete st.picks[id]; }); }
    catch (e) { lots = []; toast(/ยังไม่รู้จักฟังก์ชันใหม่|ไม่พบฟังก์ชัน|does not exist/.test(e.message) ? 'ฐานข้อมูลยังไม่ได้อัปเดตเป็นรุ่น 2.5 — ให้ผู้ดูแลรันไฟล์ avo_flow_update_2_5.sql แล้วกด Refresh schema cache' : e.message, 'err'); }
    drawLots();
  };
  const shown = () => { const q = st.q.trim().toLowerCase(); const vn = st.vr ? M.varieties.find((v) => v.id === Number(st.vr))?.name : null;
    return lots.filter((l) => sumKg(st.picks[l.lot_id]) > 0 || ((!vn || l.variety === vn) && (!q || [l.lot_code, l.variety, l.size, l.supplier].some((x) => (x || '').toLowerCase().includes(q))))); };
  // สถานะของ Lot หลังกรอก: จ่ายรวม · ยอดว่างที่เหลือ · ต้องปรับความสุกหรือไม่
  const calc = (l) => { const p = st.picks[l.lot_id]; const tot = sumKg(p); const after = R2(Number(l.free_kg) - tot);
    const conv = tot > 0 && after >= 0 && rips().some((r) => Number(p.kg[r] || 0) > Math.max(have(l, r), 0) + 1e-9);
    return { tot, after, conv, over: tot > 0 && after < 0 }; };
  const refresh = (lot) => {
    const l = lotOf(lot); const row = $(`.lp-row[data-lot="${lot}"]`, m.el); if (!l || !row) return; const c = calc(l); const p = st.picks[lot];
    row.classList.toggle('on', c.tot > 0); row.classList.toggle('neg', c.over);
    $(`[data-tot="${lot}"]`, row).textContent = c.tot ? fmtN(c.tot) : '—';
    const af = $(`[data-after="${lot}"]`, row);
    af.textContent = !c.tot ? '' : c.over ? `${allowNeg ? 'ติดลบ' : 'เกินยอด'} ${fmtN(-c.after)}` : `เหลือ ${fmtN(c.after)}`; af.classList.toggle('bad', c.over);
    rips().forEach((r) => { const h = $(`[data-have="${lot}|${r}"]`, row); if (h) h.classList.toggle('conv', !c.over && Number(p?.kg[r] || 0) > Math.max(have(l, r), 0) + 1e-9); });
    sum();
  };
  // กรอก กก. แล้วเติมจำนวนตะกร้า/ถุงตามสัดส่วนให้ (จ่ายทั้ง Lot = ตะกร้าทั้งหมด) · แก้เองได้
  const autoUnits = (lot) => { const l = lotOf(lot); const p = st.picks[lot]; const i = $(`[data-bk="${lot}"]`, m.el); if (!l || !p || !i || p.manual) return;
    const tot = sumKg(p); const hv = unitsOf(l); const base = Number(l.total_kg);
    p.units = tot <= 0 ? null : base <= 0 || tot >= base ? hv : Math.min(hv, Math.round(hv * tot / base)); i.value = p.units ?? ''; };
  const rowHtml = (l) => {
    const p = st.picks[l.lot_id] || { kg: {} }; const fz = frozen();
    return `<div class="lp-row" data-lot="${l.lot_id}">
      <div class="lp-lot"><div><span class="lot">${esc(l.lot_code)}</span> <span class="small">${esc(l.variety || '-')} · ${esc(l.size || '-')}</span></div>
        <div class="small muted">${esc(l.supplier || '')}${l.supplier ? ' · ' : ''}รับ ${thDate(l.received_at)} · ${fmtN(l.age_days)} วัน</div>
        <div class="small">คงเหลือ <b class="${Number(l.total_kg) < 0 ? 'bad' : ''}">${fmtN(l.total_kg)}</b>${Number(l.reserved_kg) ? ` · จอง ${fmtN(l.reserved_kg)} · ว่าง <b>${fmtN(l.free_kg)}</b>` : ''} กก.
          ${Number(l.free_kg) > 0 ? `<button class="link small" type="button" data-all="${l.lot_id}">จ่ายทั้ง Lot</button>` : ''}</div></div>
      <div class="lp-rips ${fz ? 'one' : ''}">${rips().map((r) => `<label class="lp-rip"><span class="lp-cap rip rip-${r}">${fz ? 'จ่าย (กก.)' : RIP[r]}</span>
        <input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-kg="${l.lot_id}|${r}" value="${esc(p.kg[r] ?? '')}" aria-label="${esc(l.lot_code)} ${fz ? 'กก.' : RIP[r]}">
        <span class="lp-have" data-have="${l.lot_id}|${r}">มี ${fmtN(have(l, r))}</span></label>`).join('')}</div>
      <div class="lp-tot"><span class="lp-cap">รวมจ่าย</span><b class="num" data-tot="${l.lot_id}">—</b><span class="lp-have" data-after="${l.lot_id}"></span></div>
      <label class="lp-unit"><span class="lp-cap">${fz ? 'ถุง' : 'ตะกร้า'}</span><input class="cell" type="number" min="0" step="1" inputmode="numeric" data-bk="${l.lot_id}" value="${esc(p.units ?? '')}"><span class="lp-have">มี ${fmtN(unitsOf(l))}</span></label>
      ${fz ? '' : `<label class="lp-unit"><span class="lp-cap">ลูก</span><input class="cell" type="number" min="0" step="1" inputmode="numeric" data-pc="${l.lot_id}" value="${esc(p.pieces ?? '')}" ${l.avg_g ? `title="เฉลี่ย ${fmtN(l.avg_g)} กรัม/ลูก"` : ''}><span class="lp-have">${l.avg_g ? `${fmtN(l.avg_g)} ก./ลูก` : 'ไม่บังคับ'}</span></label>`}
      <label class="lp-detail"><span class="lp-cap">รายละเอียด (พิมพ์ในใบ)</span><input class="input" type="text" maxlength="200" data-dt="${l.lot_id}" value="${esc(p.detail || '')}" placeholder="เช่น เกรด A / คัดลูกสวย"></label>
    </div>`;
  };
  const drawLots = () => {
    const rows = shown();
    $('#lots', m.el).innerHTML = rows.length ? `<div class="lp-list ${frozen() ? 'frozen' : ''}">${rows.map(rowHtml).join('')}</div>`
      : `<div class="empty">${lots.length ? 'ไม่พบ Lot ตามที่ค้นหา' : 'ไม่มีสินค้าที่จุดนี้'}${allowNeg && !st.zero && !lots.length ? ' · ติ๊ก "แสดง Lot ที่ยอดเป็น 0" เพื่อจ่ายจาก Lot ที่ยอดหมดแล้ว' : ''}</div>`;
    $$('[data-kg]', m.el).forEach((i) => (i.oninput = () => { const [lot, r] = i.dataset.kg.split('|'); const p = pick(lot);
      const v = Number(i.value || 0); if (v > 0) p.kg[r] = R2(v); else delete p.kg[r];
      autoUnits(lot); if (!sumKg(p) && !p.detail) delete st.picks[lot]; refresh(lot); }));
    $$('[data-bk]', m.el).forEach((i) => (i.oninput = () => { const p = pick(i.dataset.bk); p.units = i.value === '' ? null : Math.max(0, Math.round(Number(i.value))); p.manual = i.value !== ''; sum(); }));
    $$('[data-pc]', m.el).forEach((i) => (i.oninput = () => { const lot = i.dataset.pc; const l = lotOf(lot); const p = pick(lot); p.pieces = i.value === '' ? null : Math.max(0, Math.round(Number(i.value)));
      // กรอกจำนวนลูก → คำนวณ กก. ให้ เมื่อ Lot นี้มียอดอยู่ความสุกเดียวและยังไม่ได้กรอกความสุกอื่น
      const only = l.rip.filter((x) => Number(x.kg) > 0);
      if (l.avg_g && p.pieces && only.length === 1 && Object.keys(p.kg).every((k) => k === only[0].ripeness)) {
        p.kg[only[0].ripeness] = Math.round(p.pieces * Number(l.avg_g) / 10) / 100; $(`[data-kg="${lot}|${only[0].ripeness}"]`, m.el).value = p.kg[only[0].ripeness]; autoUnits(lot); }
      refresh(lot); }));
    $$('[data-dt]', m.el).forEach((i) => (i.oninput = () => { const p = pick(i.dataset.dt); p.detail = i.value; if (!sumKg(p) && !p.detail) delete st.picks[i.dataset.dt]; }));
    $$('[data-all]', m.el).forEach((b) => (b.onclick = () => { const l = lotOf(b.dataset.all); const p = pick(l.lot_id); let free = Number(l.free_kg); p.kg = {};
      [...l.rip].sort((a, c) => RIP_ORDER.indexOf(c.ripeness) - RIP_ORDER.indexOf(a.ripeness)).forEach((x) => { const t = R2(Math.min(Math.max(Number(x.kg), 0), free)); if (t > 0) { p.kg[x.ripeness] = t; free = R2(free - t); } });
      p.manual = false; rips().forEach((r) => { $(`[data-kg="${l.lot_id}|${r}"]`, m.el).value = p.kg[r] ?? ''; }); autoUnits(l.lot_id); refresh(l.lot_id); }));
    rows.forEach((l) => refresh(l.lot_id)); sum();
  };
  const sum = () => {
    const picked = lots.filter((l) => sumKg(st.picks[l.lot_id]) > 0); const cs = picked.map((l) => ({ l, ...calc(l) }));
    const tot = R2(cs.reduce((a, c) => a + c.tot, 0)); const units = picked.reduce((a, l) => a + Number(st.picks[l.lot_id].units || 0), 0);
    const over = cs.filter((c) => c.over); const conv = cs.filter((c) => c.conv);
    $('#dsum', m.el).innerHTML = `เลือก <b>${picked.length}</b> Lot · จ่ายรวม <b>${fmtKg(tot)}</b> · ${frozen() ? 'ถุง' : 'ตะกร้า'} <b>${fmtN(units)}</b>
      ${conv.length ? `<div class="lp-note info">ความสุกที่กรอกไม่ตรงกับยอดในระบบ ${conv.length} Lot (${conv.map((c) => esc(c.l.lot_code)).join(', ')}) — ระบบจะปรับความสุกในสต็อกให้เองเมื่อยืนยันตีออก</div>` : ''}
      ${over.length ? `<div class="lp-note bad">${allowNeg ? 'จ่ายเกินยอดว่าง' : 'ห้ามจ่ายเกินยอดพร้อมใช้'}: ${over.map((c) => `${esc(c.l.lot_code)} ขาด ${fmtN(Math.min(c.tot, -c.after))} กก.`).join(' · ')}${allowNeg ? ' — ยอด Lot จะติดลบ ผู้จัดการต้องกดยืนยันตอนตีออก' : ' — ให้ลดจำนวนที่จ่าย'}</div>` : ''}
      ${!reedit && !ctx.can.approveAt(st.from) ? '<div class="small muted" style="margin-top:4px">บันทึกเป็นร่างเพื่อจองสต็อก แล้วให้ผู้จัดการกด "ยืนยันตีออก"</div>' : ''}`;
  };
  if (!reedit) $$('#kind button', m.el).forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; header(); }));
  $('#f-var', m.el).onchange = (e) => { st.vr = e.target.value; drawLots(); };
  $('#lq', m.el).oninput = (e) => { st.q = e.target.value; drawLots(); };
  const zc = $('#zero', m.el); if (zc) zc.onchange = () => { st.zero = zc.checked; loadLots(); };
  // แนะนำอัตโนมัติ: สุกก่อน → รับเข้าก่อน ไล่ทีละช่องความสุก ไม่เกินยอดว่างของ Lot
  $('#suggest', m.el).onclick = () => {
    let need = Number($('#need', m.el).value || 0); if (!need) { toast('ระบุจำนวนที่ต้องการ (กก.) ก่อน'); return; }
    st.picks = {}; const free = {}; const q = st.q.trim().toLowerCase(); const vn = st.vr ? M.varieties.find((v) => v.id === Number(st.vr))?.name : null;
    const cand = lots.filter((l) => (!vn || l.variety === vn) && (!q || [l.lot_code, l.variety, l.size, l.supplier].some((x) => (x || '').toLowerCase().includes(q))));
    const rank = (r) => (r === 'na' ? 0 : RIP_ORDER.indexOf(r) + 1);
    cand.flatMap((l) => l.rip.map((x) => ({ l, x }))).filter(({ x }) => Number(x.kg) > 0)
      .sort((a, b) => rank(b.x.ripeness) - rank(a.x.ripeness) || (a.l.received_at < b.l.received_at ? -1 : a.l.received_at > b.l.received_at ? 1 : a.l.lot_id - b.l.lot_id))
      .forEach(({ l, x }) => { if (need <= 0) return; free[l.lot_id] = free[l.lot_id] ?? Number(l.free_kg);
        const take = R2(Math.min(need, Math.max(Number(x.kg) - Number(x.reserved_kg || 0), 0), Math.max(free[l.lot_id], 0))); if (take <= 0) return;
        pick(l.lot_id).kg[x.ripeness] = take; free[l.lot_id] = R2(free[l.lot_id] - take); need = R2(need - take); });
    if (need > 0) toast(`สต็อกพร้อมจ่ายไม่พอ ขาดอีก ${fmtN(need)} กก.`, 'err');
    drawLots(); Object.keys(st.picks).forEach((lot) => { autoUnits(lot); }); sum();
  };
  const buildLines = () => {
    const out = []; const fz = frozen();
    const ids = [...lots.map((l) => String(l.lot_id)), ...Object.keys(st.picks)].filter((v, i, a) => a.indexOf(v) === i);
    ids.forEach((lot) => { const p = st.picks[lot]; if (!p) return;
      const rs = rips().filter((r) => Number(p.kg[r]) > 0); if (!rs.length) return;
      const w = rs.map((r) => Number(p.kg[r])); const us = apportion(w, p.units); const ps = apportion(w, p.pieces);
      rs.forEach((r, i) => out.push({ lot_id: Number(lot), ripeness: r, kg: R2(p.kg[r]), [fz ? 'bags' : 'baskets']: us[i], pieces: ps[i] || null, detail: (p.detail || '').trim() || null })); });
    return out;
  };
  const save = (mode) => (e) => busy(e.currentTarget, async () => {
    const h = { ...formData($('#dh', m.el)), ...formData($('#dx', m.el)) };
    if (reedit) Object.assign(h, { from_site_id: ex.from_site_id, from_zone: ex.from_zone });
    const lines = buildLines();
    if (!lines.length) { toast('กรุณากรอกน้ำหนักที่จ่ายอย่างน้อย 1 Lot', 'err'); return; }
    if (reedit && !h.edit_reason) { toast('กรุณาระบุเหตุผลที่แก้ไข', 'err'); $('[name=edit_reason]', m.el).focus(); return; }
    const res = await withNegConfirm((confirm) => ctx.api.rpc('api_dispatch_save', { id: ex?.id, kind: st.kind, ...h, ship: mode === 'ship', confirm_negative: confirm, lines }));
    if (!res) return;
    m.close();
    done(ctx, mode === 'edit' ? `แก้ไข ${res.doc_no} แล้ว · ตัดสต็อกใหม่ตามตัวเลขที่แก้` : mode === 'ship' ? `ตีออก ${res.doc_no} แล้ว · ${fmtKg(res.total_kg)} อยู่ระหว่างทาง` : `บันทึกร่าง ${res.doc_no} · จองสต็อกแล้ว`);
    dispatchView(ctx, res.id);
  });
  if (reedit) $('#resave', m.el).onclick = save('edit'); else { $('#save', m.el).onclick = save('draft'); $('#ship', m.el).onclick = save('ship'); }
  bindPhotoFields($('#dx', m.el), ctx.api);
  header(); loadLots();
}

export async function dispatchView(ctx, id) {
  const d = await ctx.api.rpc('api_dispatch_get', { id });
  const delivered = d.kind === 'sale' && ['received', 'partial', 'closed'].includes(d.status);
  const canReturn = delivered && ctx.can.returns && (ctx.me.role !== 'branch' || ctx.can.actAt(d.from_site_id));
  const rets = delivered && ctx.can.returns ? await ctx.api.rpc('api_returns', { dispatch_id: d.id }).catch(() => []) : [];
  const isSale = d.kind === 'sale'; const frozen = d.from_zone === 'frozen';
  const canReceive = d.status === 'shipped' && (isSale ? ctx.can.recordDelivery || ctx.can.actAt(d.from_site_id) : ctx.can.actAt(d.to_site_id));
  const canShip = d.status === 'draft' && ctx.can.approveAt(d.from_site_id);
  const canEdit = d.status === 'draft' && ctx.can.dispatch && ctx.can.actAt(d.from_site_id);
  const canReedit = d.status === 'shipped' && ctx.can.approveAt(d.from_site_id);
  const approverCase = ctx.can.approveAt(d.from_site_id) || (d.to_site_id && ctx.can.approveAt(d.to_site_id));
  const allowNeg = ctx.master.settings?.options?.allow_negative_dispatch !== false; const short = d.shortages || [];
  const firstOfLot = (l, i) => d.lines.findIndex((x) => x.lot_id === l.lot_id) === i;
  const m = openModal({ title: `${isSale ? 'ใบตีออกขาย' : 'ใบโอนสินค้า'} ${esc(d.doc_no)}`, sub: `${esc(d.from_site)} (${ZONE[d.from_zone]}) → ${esc(d.destination)}${isSale && d.channel ? ' · ' + (CHANNEL[d.channel] || d.channel) : ''}`, size: 'xl',
    body: `<div>
      <div class="actions" style="margin-bottom:12px;align-items:center">${statusBadge('dispatch', d.status)}${d.open_cases ? ` <span class="badge b-warn">รอตรวจสอบส่วนต่าง ${d.open_cases} รายการ</span>` : ''}${d.edited_at ? ' <span class="badge b-info">แก้ไขหลังตีออก</span>' : ''}</div>
      ${short.length ? `<div class="notice ${allowNeg ? '' : 'danger'}" id="short">ใบนี้ขอจ่ายเกินยอดว่าง: ${short.map((x) => `<b>${esc(x.lot_code)}</b> ขาด ${fmtN(x.short_kg)} กก. (ยอด Lot หลังตีออก ${fmtN(x.after_kg)} กก.)`).join(' · ')}
        — ${allowNeg ? 'ถ้ายืนยันตีออก ยอด Lot จะติดลบ ผู้จัดการต้องกดยืนยันรับทราบ' : 'ตั้งค่าไว้ไม่ให้ตีออกเกินยอด ให้แก้จำนวนในใบก่อน'}</div>` : ''}
      <div class="form-grid g4" style="margin-bottom:14px">
        <div class="kv"><span>วันที่ตีออก</span><span>${d.doc_date ? thDateY(d.doc_date) : thDate(d.created_at)}</span></div>
        <div class="kv"><span>ผู้สร้าง</span><span>${esc(d.created_by_name || '-')}</span></div>
        <div class="kv"><span>ผู้ยืนยันจ่าย</span><span>${esc(d.shipped_by_name || '—')}${d.shipped_at ? '<br><span class="small muted">' + thDateTime(d.shipped_at) + '</span>' : ''}</span></div>
        <div class="kv"><span>ผู้ขนส่ง</span><span>${esc(d.carrier || '—')}${d.vehicle ? '<br><span class="small muted">' + esc(d.vehicle) + '</span>' : ''}</span></div>
        <div class="kv"><span>ผู้รับปลายทาง</span><span>${esc(d.receiver_name || '—')}${d.received_at ? '<br><span class="small muted">' + thDateTime(d.received_at) + '</span>' : ''}</span></div>
        ${d.edited_at ? `<div class="kv span-2"><span>แก้ไขหลังตีออก</span><span>${esc(d.edited_by_name || '-')} · ${thDateTime(d.edited_at)}<br><span class="small muted">เหตุผล: ${esc(d.edit_reason || '-')}</span></span></div>` : ''}
      </div>
      ${table([
        { label: 'Lot', render: (l, i) => `<span class="lot">${esc(l.lot_code)}</span>${l.detail && firstOfLot(l, i) ? `<div class="small muted">${esc(l.detail)}</div>` : ''}` },
        { label: 'สินค้า', render: (l) => `${esc(l.variety || '-')} · ${esc(l.size || '-')}` },
        { label: 'ความสุก', render: (l) => ripBadge(l.ripeness) },
        { label: frozen ? 'ถุง' : 'ตะกร้า', right: true, render: (l) => fmtN(frozen ? l.bags : l.baskets) },
        { label: 'ส่ง (กก.)', right: true, render: (l) => `<b>${fmtN(l.kg)}</b>${l.pieces ? `<div class="small muted">${fmtN(l.pieces)} ลูก</div>` : l.avg_g ? `<div class="small muted">${fmtPcs(l.kg, l.avg_g)}</div>` : ''}` },
        { label: 'รับจริง (กก.)', right: true, render: (l) => (canReceive ? `<input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-rk="${l.id}" value="${l.kg}">` : l.received_kg != null ? fmtN(l.received_kg) : '—') },
        { label: frozen ? 'ถุงที่รับ' : 'ตะกร้าที่รับ', right: true, render: (l) => (canReceive ? `<input class="cell" type="number" min="0" step="1" style="width:70px" data-rb="${l.id}" value="${frozen ? l.bags : l.baskets}">` : l.received_kg != null ? fmtN(frozen ? l.received_bags : l.received_baskets) : '—') },
        { label: 'ส่วนต่าง', right: true, render: (l) => (l.received_kg != null && Number(l.kg) - Number(l.received_kg) > 0 ? `<span style="color:var(--warn-ink)">−${fmtN(l.kg - l.received_kg)}</span>` : canReceive ? `<span data-var="${l.id}">0</span>` : '—') },
        ...(isSale ? [{ label: 'ออกบิลแล้ว', right: true, render: (l) => `${fmtN(l.billed_kg)}${Number(l.returned_kg) ? `<div class="small" style="color:var(--warn-ink)">คืน/เคลม ${fmtN(l.returned_kg)}</div>` : ''}` }] : []),
      ], d.lines, { rowAttr: (l) => `data-lot="${l.lot_id}"`, foot: `<tfoot><tr><td colspan="3">รวม</td><td class="right num">${fmtN(frozen ? d.lines.reduce((a, l) => a + Number(l.bags || 0), 0) : d.total_baskets)}</td><td class="right num">${fmtN(d.total_kg)}</td><td class="right num">${d.total_received_kg != null ? fmtN(d.total_received_kg) : ''}</td><td colspan="${isSale ? 3 : 2}"></td></tr></tfoot>` })}
      ${d.details ? `<div class="doc-details"><div class="small muted">รายละเอียดในใบตีออก</div>${esc(d.details)}</div>` : ''}
      ${d.note ? `<div class="small muted" style="margin-top:8px">หมายเหตุ: ${esc(d.note)}</div>` : ''}
      </div>
      ${canReceive ? `<div class="section-title">ยืนยันรับที่ปลายทาง</div>
        <div class="notice info">ตรวจนับและชั่งจริงภายใน ${esc(ctx.master.settings?.thresholds?.receive_deadline_hours ?? 4)} ชม. หลังสินค้าถึง · ${isSale ? 'ยอดที่ลูกค้ารับจริงจะเป็นยอดออกบิล' : 'สาขาเพิ่มสต็อกเฉพาะที่รับจริง'} · ถ้ารับขาดระบบจะเปิดงานตรวจสอบส่วนต่างให้อัตโนมัติ</div>
        <div class="form-grid g3" id="rcv">
          ${field('ชื่อผู้รับ', `<input class="input" name="receiver_name" value="${esc(isSale ? '' : ctx.me.display_name || '')}">`, { req: true })}
          ${field('เวลารับจริง', `<input class="input" type="datetime-local" name="received_at" value="${toLocalInput()}">`)}
          ${photoField('evidence', 'รูปสภาพสินค้า / ใบส่งของที่เซ็นรับ', ctx.master.settings?.options?.require_receive_photo !== false)}
          ${field('หมายเหตุ / สภาพสินค้า', '<input class="input" name="note" placeholder="เช่น ผลช้ำ 1 ถุง">', { cls: 'span-all' })}
        </div>` : ''}
      ${d.cases.length ? `<div class="section-title">งานตรวจสอบส่วนต่าง</div>${table([
        { label: 'เลขที่', key: 'doc_no' }, { label: 'Lot', render: (c) => esc(d.lines.find((l) => l.id === c.dispatch_line_id)?.lot_code) },
        { label: 'ขาด (กก.)', right: true, render: (c) => fmtN(c.kg) }, { label: 'สถานะ', render: (c) => statusBadge('case', c.status) },
        { label: 'ผลสรุป', render: (c) => (c.outcome ? `${{ loss: 'สูญเสีย', return: 'ส่งคืนต้นทาง', late_delivery: 'ส่งตามภายหลัง' }[c.outcome]} · ${esc(c.resolve_note || '')}` : esc(c.note || '—')) },
        { label: '', render: (c) => (c.status === 'open' && approverCase ? `<button class="btn sm" data-case="${c.id}">สรุปส่วนต่าง</button>` : '') }], d.cases)}` : ''}
      ${rets.length ? `<div class="section-title">รับคืน / เคลมจากลูกค้า</div>${table([{ label: 'เลขที่', key: 'doc_no' }, { label: 'วันที่', render: (x) => thDateTime(x.requested_at) },
        { label: 'กก.', right: true, render: (x) => fmtN(x.total_kg) }, { label: 'เหตุผล', render: (x) => esc(x.reason) }, { label: 'สถานะ', right: true, render: (x) => statusBadge('return', x.status) }], rets, { rowAttr: (x) => `class="click" data-ret="${x.id}"` })}` : ''}
      ${d.ship_evidence ? '<div class="section-title">รูปตอนส่ง</div><div id="ev-ship"></div>' : ''}
      ${d.evidence ? '<div class="section-title">หลักฐานรับปลายทาง</div><div id="ev"></div>' : ''}`,
    foot: `<div class="left">${canEdit ? '<button class="btn" id="edit">แก้ไข</button><button class="btn danger" id="cancel">ยกเลิกใบ</button>' : ''}${canReedit ? '<button class="btn" id="reedit">แก้ไขใบที่ตีออกแล้ว</button>' : ''}<button class="btn" id="slip">ใบตีออก PDF / พิมพ์</button></div>
      ${canReturn ? '<button class="btn" id="ret">รับคืน / เคลม</button>' : ''}
      ${isSale && ['received', 'partial', 'closed'].includes(d.status) && ctx.can.sales && d.lines.some((l) => Number(l.received_kg) - Number(l.returned_kg || 0) > Number(l.billed_kg)) ? '<button class="btn" id="bill">สร้างบิลจากใบนี้</button>' : ''}
      ${canShip ? '<button class="btn primary" id="ship">ยืนยันตีออก · ส่งแล้ว</button>' : ''}
      ${canReceive ? '<button class="btn primary" id="receive">ยืนยันรับ</button>' : ''}` });
  if (d.evidence) showEvidence($('#ev', m.el), d.evidence, ctx.api);
  if (d.ship_evidence) showEvidence($('#ev-ship', m.el), d.ship_evidence, ctx.api);
  bindPhotoFields(m.el, ctx.api);
  $$('[data-rk]', m.el).forEach((i) => (i.oninput = () => { const l = d.lines.find((x) => x.id === Number(i.dataset.rk)); const v = $(`[data-var="${l.id}"]`, m.el); const diff = Number(l.kg) - Number(i.value || 0); v.textContent = diff > 0 ? '−' + fmtN(diff) : '0'; v.style.color = diff > 0 ? 'var(--warn-ink)' : ''; }));
  $$('tr[data-lot]', m.el).forEach((tr) => { if (!canReceive) { tr.classList.add('click'); tr.onclick = () => lotTrace(ctx, Number(tr.dataset.lot)); } });
  const b = (sel, fn) => { const el = $(sel, m.el); if (el) el.onclick = fn; };
  b('#edit', () => { m.close(); dispatchForm(ctx, { existing: d }); });
  b('#reedit', () => { m.close(); dispatchForm(ctx, { existing: d }); });
  b('#slip', async () => (await import('./slip.js')).dispatchSlip(ctx, d));
  b('#cancel', async () => { const why = await confirmBox('ยกเลิกใบตีออก', 'ยกเลิกใบร่างและคืนยอดจอง', { ok: 'ยกเลิกใบ', danger: true, input: { label: 'เหตุผล' } }); if (why === null) return;
    try { await ctx.api.rpc('api_dispatch_cancel', { id: d.id, reason: why }); m.close(); done(ctx, 'ยกเลิกแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  b('#ship', (e) => busy(e.currentTarget, async () => {
    const res = await withNegConfirm((confirm) => ctx.api.rpc('api_dispatch_ship', { id: d.id, confirm_negative: confirm })); if (!res) return;
    m.close(); done(ctx, `ยืนยันตีออก ${d.doc_no} แล้ว`); dispatchView(ctx, d.id); }));
  b('#receive', (e) => busy(e.currentTarget, async () => {
    const h = formData($('#rcv', m.el));
    const lines = d.lines.map((l) => ({ id: l.id, received_kg: Number($(`[data-rk="${l.id}"]`, m.el).value || 0), [frozen ? 'received_bags' : 'received_baskets']: Number($(`[data-rb="${l.id}"]`, m.el).value || 0) }));
    const res = await ctx.api.rpc('api_dispatch_receive', { id: d.id, ...h, received_at: fromLocalInput(h.received_at), lines });
    m.close(); done(ctx, res.status === 'partial' ? 'บันทึกรับบางส่วน · เปิดงานตรวจสอบส่วนต่างแล้ว' : 'ยืนยันรับครบแล้ว', res); if (!res._queued) dispatchView(ctx, d.id);
  }));
  b('#bill', async () => { m.close(); (await import('./salesdocs.js')).invoiceForm(ctx, { customer_id: d.customer_id, dispatch_id: d.id }); });
  b('#ret', () => { m.close(); returnForm(ctx, d); });
  $$('[data-ret]', m.el).forEach((tr) => (tr.onclick = () => returnView(ctx, Number(tr.dataset.ret))));
  $$('[data-case]', m.el).forEach((btn) => (btn.onclick = () => caseResolve(ctx, d.cases.find((c) => c.id === Number(btn.dataset.case)), d, () => { m.close(); dispatchView(ctx, d.id); })));
}

export function caseResolve(ctx, c, d, after) {
  const m = openModal({ title: `สรุปส่วนต่าง ${esc(c.doc_no)}`, sub: `${esc(d?.doc_no || c.dispatch_no)} · ขาด ${fmtKg(c.kg)}`, size: 'sm',
    body: `<div class="grid" id="cf">
      <label class="check"><input type="radio" name="outcome" value="loss" checked> สูญเสีย / เสียหาย (ตัดออกจากระบบ)</label>
      <label class="check"><input type="radio" name="outcome" value="return"> ส่งคืนต้นทาง (คืนเข้าสต็อกต้นทาง)</label>
      <label class="check"><input type="radio" name="outcome" value="late_delivery"> ของค้างส่ง · ส่งถึงภายหลัง</label>
      ${field('เหตุผล / ผู้รับผิดชอบ', '<textarea class="input" name="note" placeholder="เช่น ผลช้ำระหว่างขนส่ง เรียกเก็บผู้ขนส่ง"></textarea>', { req: true })}
      ${photoField('evidence', 'หลักฐาน (ถ้ามี)')}</div>`,
    foot: '<button class="btn primary" id="ok">บันทึกผลสรุป</button>' });
  bindPhotoFields(m.el, ctx.api);
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    await ctx.api.rpc('api_case_resolve', { id: c.id, outcome: $('[name=outcome]:checked', m.el).value, note: $('[name=note]', m.el).value, evidence: $('[name=evidence]', m.el).value || null });
    m.close(); done(ctx, 'ปิดงานส่วนต่างแล้ว'); after && after();
  });
}

// =====================================================================
// สต็อก: ตัวเลือก Lot + ความสุก + งานสาขา
// =====================================================================
async function lotOptions(ctx, site_id, zone, filter = () => true) {
  const rows = (await ctx.api.rpc('api_stock', { site_id, zone })).filter(filter);
  return { rows, html: rows.length ? rows.map((r) => `<option value="${r.lot_id}|${r.ripeness}">${esc(r.lot_code)} · ${esc(r.variety || '')} ${esc(r.size || '')} · ${RIP[r.ripeness]} · ${fmtN(r.kg)} กก.${r.bags ? ' / ' + r.bags + ' ถุง' : r.baskets ? ' / ' + r.baskets + ' ตะกร้า' : ''}</option>`).join('') : '<option value="">— ไม่มีสินค้าในจุดนี้ —</option>' };
}

function stockOpModal(ctx, { title, sub, site_id, zones, zone, extra = '', submitLabel, filter, onSubmit, preset, needPhoto = false, photoLabel = 'รูปหลักฐาน', withNeg = false }) {
  const m = openModal({ title, sub, size: '', body: `<div class="grid" id="op">
      <div class="form-grid">${field('จุดจัดเก็บ', `<select class="input" name="zone">${zones.map((z) => `<option value="${z}" ${z === zone ? 'selected' : ''}>${ZONE[z]}</option>`).join('')}</select>`)}
      ${field('Lot · ความสุก', '<select class="input" name="lot"></select>', { req: true })}</div>
      <div id="lot-info" class="small muted"></div>
      ${extra}
      ${needPhoto !== null ? photoField('evidence', photoLabel, needPhoto) : ''}</div>`,
    foot: `<button class="btn primary" id="ok">${submitLabel}</button>` });
  bindPhotoFields(m.el, ctx.api);
  let rows = [];
  const load = async () => {
    const z = $('[name=zone]', m.el).value; const r = await lotOptions(ctx, site_id, z, (x) => (withNeg || Number(x.kg) >= 0) && (!filter || filter(x))); rows = r.rows;   // ยอดติดลบเลือกได้เฉพาะตอนปรับยอด
    $('[name=lot]', m.el).innerHTML = r.html;
    if (preset) { $('[name=lot]', m.el).value = preset.lot_id + '|' + preset.ripeness;
      ['kg', 'reason'].forEach((k) => { const i = $(`[name=${k}]`, m.el); if (i && preset[k] != null) i.value = preset[k]; }); preset = null; }
    info();
  };
  const info = () => { const [l, rp] = ($('[name=lot]', m.el).value || '').split('|'); const r = rows.find((x) => x.lot_id === Number(l) && x.ripeness === rp);
    $('#lot-info', m.el).innerHTML = r ? `คงเหลือ <b>${fmtKg(r.kg)}</b>${r.baskets ? ` · ${r.baskets} ตะกร้า` : ''}${r.bags ? ` · ${r.bags} ถุง` : ''}${r.est_pieces ? ` · ≈ ${fmtN(r.est_pieces)} ลูก` : ''} · รับเข้า ${thDate(r.received_at)} · ${esc(r.supplier || '')}` : ''; m.current = r; };
  $('[name=zone]', m.el).onchange = load; $('[name=lot]', m.el).onchange = info;
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const f = formData($('#op', m.el)); const [lot_id, ripeness] = (f.lot || '').split('|');
    if (!lot_id) throw new Error('กรุณาเลือก Lot');
    await onSubmit({ ...f, site_id, lot_id: Number(lot_id), ripeness }, m);
  });
  load();
  return m;
}

export function ripenessModal(ctx, { site_id, zone, preset }) {
  const s = site(ctx, site_id);
  const m = stockOpModal(ctx, { title: 'ตรวจ / เปลี่ยนความสุก', sub: `${esc(s?.name)} · อ้างอิงการตรวจจริง ระบบบันทึกผู้ตรวจและเวลาอัตโนมัติ`, site_id, zones: zonesOf(ctx, site_id).filter((z) => z !== 'frozen'), zone: zone || (s?.kind === 'warehouse' ? 'main' : 'back'), preset,
    filter: (r) => r.product === 'fresh',
    extra: `<div class="form-grid">${field('ความสุกใหม่', `<select class="input" name="to">${RIP_ORDER.map((k) => `<option value="${k}">${RIP[k]}</option>`).join('')}</select>`, { req: true })}
      ${field('น้ำหนักที่เปลี่ยน (กก.)', '<input class="input" name="kg" type="number" min="0" step="0.01" inputmode="decimal">', { req: true, hint: 'เปลี่ยนบางส่วนของ Lot ได้' })}
      ${field('ตะกร้า', '<input class="input" name="baskets" type="number" min="0" step="1" inputmode="numeric">')}
      ${field('ผลการตรวจ / หมายเหตุ', '<input class="input" name="note" placeholder="เช่น กดนุ่ม ผิวเริ่มเข้ม">')}</div>`,
    submitLabel: 'บันทึกผลตรวจ',
    onSubmit: async (f, m) => {
      const res = await ctx.api.rpc('api_ripeness_change', { site_id, zone: f.zone, lot_id: f.lot_id, from: f.ripeness, to: f.to, kg: f.kg, baskets: f.baskets || 0, note: f.note, evidence: f.evidence });
      m.close(); done(ctx, `บันทึก ${res.doc_no}: ${RIP[f.ripeness]} → ${RIP[f.to]} ${fmtKg(f.kg)}`, res);
    } });
  const lotSel = $('[name=lot]', m.el); const toSel = $('[name=to]', m.el);
  const sync = () => { const [, rp] = (lotSel.value || '').split('|'); const idx = RIP_ORDER.indexOf(rp); if (idx >= 0 && idx < 3) toSel.value = RIP_ORDER[idx + 1];
    const r = m.current; const kgI = $('[name=kg]', m.el); if (r && !kgI.value) { kgI.placeholder = 'สูงสุด ' + fmtN(r.kg); } };
  lotSel.addEventListener('change', sync); new MutationObserver(() => setTimeout(sync, 0)).observe(lotSel, { childList: true });
}

export function zoneTransferModal(ctx, site_id) {
  stockOpModal(ctx, { title: 'โอนภายในสาขา', sub: 'เช่น ย้ายจากหลังร้านไปหน้าร้าน · สต็อกรวมของสาขาไม่เปลี่ยน', site_id, zones: zonesOf(ctx, site_id), zone: site(ctx, site_id)?.kind === 'warehouse' ? 'main' : 'back', needPhoto: null,
    extra: `<div class="form-grid">${field('ย้ายไปที่', `<select class="input" name="to_zone">${zonesOf(ctx, site_id).map((z) => `<option value="${z}" ${z === 'front' ? 'selected' : ''}>${ZONE[z]}</option>`).join('')}</select>`)}
      ${field('น้ำหนัก (กก.)', '<input class="input" name="kg" type="number" min="0" step="0.01" inputmode="decimal">', { req: true })}
      ${field('ตะกร้า / ถุง', '<input class="input" name="units" type="number" min="0" step="1" inputmode="numeric">')}
      ${field('หมายเหตุ', '<input class="input" name="note">')}</div>`,
    submitLabel: 'บันทึกใบโอนภายใน',
    onSubmit: async (f, m) => {
      const frozen = f.zone === 'frozen';
      const res = await ctx.api.rpc('api_zone_transfer', { site_id, from_zone: f.zone, to_zone: f.to_zone, lot_id: f.lot_id, ripeness: f.ripeness, kg: f.kg, [frozen ? 'bags' : 'baskets']: f.units || 0, note: f.note });
      m.close(); done(ctx, `บันทึก ${res.doc_no}: ${ZONE[f.zone]} → ${ZONE[f.to_zone]} ${fmtKg(f.kg)}`, res);
    } });
}

export function freezeModal(ctx, site_id) {
  const s = site(ctx, site_id);
  const m = stockOpModal(ctx, { title: 'แปรรูปแช่แข็ง', sub: 'บันทึกวัตถุดิบที่ใช้ ผลผลิตที่ได้ และส่วนสูญเสีย (เปลือก/เมล็ด) · ระบบสร้าง Lot แช่แข็งที่อ้างอิง Lot ต้นทาง', site_id,
    zones: s?.kind === 'warehouse' ? ['main'] : ['back', 'front'], zone: s?.kind === 'warehouse' ? 'main' : 'back', needPhoto: null, filter: (r) => r.product === 'fresh',
    extra: `<div class="form-grid">${field('วัตถุดิบที่ใช้ (กก.)', '<input class="input" name="input_kg" type="number" min="0" step="0.01" inputmode="decimal">', { req: true })}
      ${field('ผลผลิตที่ได้ (กก.)', '<input class="input" name="output_kg" type="number" min="0" step="0.01" inputmode="decimal">', { req: true })}
      ${field('จำนวนถุง', '<input class="input" name="bags" type="number" min="1" step="1" inputmode="numeric">', { req: true })}
      ${field('ตะกร้าที่ใช้', '<input class="input" name="input_baskets" type="number" min="0" step="1" inputmode="numeric">')}
      ${field('หมายเหตุ', '<input class="input" name="note" placeholder="เช่น เนื้อบด ถุงละ 400 กรัม">', { cls: 'span-all' })}</div>
      <div class="summary-box" id="yield">กรอกน้ำหนักเพื่อดูสัดส่วนผลผลิต</div>`,
    submitLabel: 'บันทึกการแปรรูป',
    onSubmit: async (f, mm) => {
      const res = await ctx.api.rpc('api_freeze', { site_id, from_zone: f.zone, lot_id: f.lot_id, ripeness: f.ripeness, input_kg: f.input_kg, output_kg: f.output_kg, bags: f.bags, input_baskets: f.input_baskets || 0, note: f.note });
      mm.close(); done(ctx, `บันทึก ${res.doc_no} · Lot แช่แข็ง ${res.lot_code} · สูญเสีย ${fmtKg(res.loss_kg)}`);
    } });
  const y = () => { const i = Number($('[name=input_kg]', m.el).value || 0); const o = Number($('[name=output_kg]', m.el).value || 0); const b = Number($('[name=bags]', m.el).value || 0);
    $('#yield', m.el).innerHTML = i ? `ผลผลิต <b>${fmtN((o / i) * 100)}%</b> · สูญเสีย <b>${fmtKg(i - o)}</b> (${fmtN(((i - o) / i) * 100)}%)${b ? ` · เฉลี่ย ${fmtN((o / b) * 1000)} กรัม/ถุง` : ''}` : 'กรอกน้ำหนักเพื่อดูสัดส่วนผลผลิต'; };
  $$('[name=input_kg],[name=output_kg],[name=bags]', m.el).forEach((i) => (i.oninput = y));
}

export function adjustModal(ctx, site_id, kind, preset = null) {
  const s = site(ctx, site_id);
  const T = { retail_sale: ['ขายหน้าร้าน', 'ตัดสต็อกทันที · บันทึกยอดเงินได้'], internal_use: ['นำไปใช้ / ทำอาหาร', 'ตัดสต็อกทันที'], waste: ['ตัดทิ้ง (เน่าเสีย)', 'ต้องระบุเหตุผลและแนบรูป · ผู้จัดการต้องอนุมัติก่อนลดสต็อก'], count_adjust: ['ปรับยอดตามนับจริง', 'ใส่ค่าบวก = เพิ่ม, ลบ = ลด · ผู้จัดการต้องอนุมัติ'] }[kind];
  const needPhoto = kind === 'waste' ? ctx.master.settings?.options?.require_waste_photo !== false : kind === 'count_adjust' ? false : null;
  stockOpModal(ctx, { title: T[0], sub: `${esc(s?.name)} · ${T[1]}`, site_id, zones: zonesOf(ctx, site_id), zone: preset?.zone || (s?.kind === 'warehouse' ? 'main' : 'front'), preset, needPhoto, photoLabel: 'รูปสินค้า', withNeg: kind === 'count_adjust',
    extra: `<div class="form-grid">${field(kind === 'count_adjust' ? 'ปรับ (กก.) +/−' : 'น้ำหนัก (กก.)', `<input class="input" name="kg" type="number" ${kind === 'count_adjust' ? '' : 'min="0"'} step="0.01" inputmode="decimal">`, { req: true })}
      ${field('ตะกร้า / ถุง', '<input class="input" name="units" type="number" step="1" inputmode="numeric">')}
      ${kind === 'retail_sale' ? field('ยอดเงิน (บาท)', '<input class="input" name="amount" type="number" min="0" step="0.01" inputmode="decimal">') : ''}
      ${field('เหตุผล', `<input class="input" name="reason" placeholder="${kind === 'waste' ? 'เช่น ผลช้ำ เนื้อดำ' : ''}">`, { req: ['waste', 'count_adjust'].includes(kind), cls: kind === 'retail_sale' ? '' : 'span-2' })}</div>`,
    submitLabel: ['waste', 'count_adjust'].includes(kind) ? 'ส่งขออนุมัติ' : 'บันทึก',
    onSubmit: async (f, m) => {
      const frozen = f.zone === 'frozen';
      const res = await ctx.api.rpc('api_adjust_request', { kind, site_id, zone: f.zone, lot_id: f.lot_id, ripeness: f.ripeness, kg: f.kg, [frozen ? 'bags' : 'baskets']: f.units || 0, amount: f.amount, reason: f.reason, evidence: f.evidence });
      m.close(); done(ctx, res.status === 'pending' ? `ส่ง ${res.doc_no} ให้ผู้จัดการอนุมัติแล้ว` : `บันทึก ${res.doc_no} แล้ว`, res);
    } });
}

export async function approvalsModal(ctx, site_id = null) {
  const list = await ctx.api.rpc('api_adjustments', { status: 'pending', site_id });
  const m = openModal({ title: 'รายการรออนุมัติ', sub: 'ตัดทิ้งและปรับยอดต้องได้รับอนุมัติก่อนลดสต็อก · ผู้ขออนุมัติรายการของตัวเองไม่ได้', size: 'lg',
    body: table([
      { label: 'เลขที่', key: 'doc_no' }, { label: 'ประเภท', render: (a) => ADJ_KIND[a.kind] || a.kind }, { label: 'สถานที่', render: (a) => `${esc(a.site)} · ${ZONE[a.zone]}` },
      { label: 'Lot', render: (a) => `<span class="lot">${esc(a.lot_code)}</span> ${ripBadge(a.ripeness)}` }, { label: 'กก.', right: true, render: (a) => fmtN(a.kg) },
      { label: 'เหตุผล', render: (a) => `${esc(a.reason || '—')}<div class="small muted">โดย ${esc(a.requested_by_name)} · ${thDateTime(a.requested_at)}</div>` },
      { label: 'รูป', render: (a) => (a.evidence ? `<button class="link" data-ev="${esc(a.evidence)}">ดูรูป</button>` : '—') },
      { label: '', render: (a) => (ctx.can.approveAt(a.site_id) && (a.requested_by !== ctx.me.id || ctx.me.role === 'admin') ? `<span class="actions"><button class="btn sm primary" data-ok="${a.id}">อนุมัติ</button><button class="btn sm" data-no="${a.id}">ไม่อนุมัติ</button></span>` : '<span class="small muted">รอผู้จัดการ</span>') },
    ], list, { empty: 'ไม่มีรายการรออนุมัติ' }) });
  $$('[data-ev]', m.el).forEach((b) => (b.onclick = () => { const mm = openModal({ title: 'รูปหลักฐาน', body: '<div id="e"></div>' }); showEvidence($('#e', mm.el), b.dataset.ev, ctx.api); }));
  $$('[data-ok],[data-no]', m.el).forEach((b) => (b.onclick = async () => {
    const approve = !!b.dataset.ok; let note = null;
    if (!approve) { note = await confirmBox('ไม่อนุมัติ', 'ระบุเหตุผลให้ผู้ขอทราบ', { ok: 'ไม่อนุมัติ', danger: true, input: { label: 'เหตุผล' } }); if (note === null) return; }
    try { await ctx.api.rpc('api_adjust_decide', { id: Number(b.dataset.ok || b.dataset.no), approve, note }); m.close(); done(ctx, approve ? 'อนุมัติแล้ว' : 'บันทึกไม่อนุมัติแล้ว'); approvalsModal(ctx, site_id); }
    catch (e) { toast(e.message, 'err'); }
  }));
}

// =====================================================================
// สวน / Supplier
// =====================================================================
export function supplierForm(ctx, s = null, after = null) {
  const m = openModal({ title: s ? `แก้ไขสวน ${esc(s.name)}` : 'เพิ่มสวน / Supplier', size: '',
    body: `<div class="form-grid" id="sf">
      ${field('ชื่อสวน', `<input class="input" name="name" value="${esc(s?.name || '')}">`, { req: true })}
      ${field('รหัส', `<input class="input" name="code" value="${esc(s?.code || '')}" placeholder="เว้นว่าง = ออกให้อัตโนมัติ">`)}
      ${field('ผู้ติดต่อ', `<input class="input" name="contact" value="${esc(s?.contact || '')}">`)}
      ${field('โทรศัพท์', `<input class="input" name="phone" type="tel" value="${esc(s?.phone || '')}">`)}
      ${field('จังหวัด', `<input class="input" name="province" value="${esc(s?.province || '')}">`)}
      ${field('ราคาซื้ออ้างอิง (บาท/กก.)', `<input class="input" name="buy_price" type="number" min="0" step="0.01" value="${esc(s?.buy_price ?? '')}">`)}
      ${field('สายพันธุ์ที่ปลูก', `<input class="input" name="varieties" value="${esc(s?.varieties || '')}" placeholder="เช่น Hass, บัคคาเนีย">`, { cls: 'span-2' })}
      ${field('หมายเหตุ', `<textarea class="input" name="note">${esc(s?.note || '')}</textarea>`, { cls: 'span-2' })}
      ${s ? `<label class="check span-2"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> ใช้งานอยู่</label>` : ''}</div>`,
    foot: '<button class="btn primary" id="ok">บันทึก</button>' });
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const res = await ctx.api.rpc('api_supplier_save', { id: s?.id, ...formData($('#sf', m.el)) });
    m.close(); await ctx.reloadMe(); done(ctx, 'บันทึกสวนแล้ว'); after && after(res);
  });
}

// =====================================================================
// ชั่งซ้ำระหว่างบ่ม (Shrinkage)
// =====================================================================
export function reweighModal(ctx, { site_id, zone, preset }) {
  const s = site(ctx, site_id); const lim = ctx.master.settings?.thresholds?.shrink_auto_pct ?? 3;
  const m = stockOpModal(ctx, { title: 'ชั่งซ้ำระหว่างบ่ม', sub: `${esc(s?.name)} · น้ำหนักหายไม่เกิน ${esc(lim)}% บันทึกทันที · เกินเกณฑ์ต้องผู้จัดการอนุมัติ`, site_id,
    zones: zonesOf(ctx, site_id).filter((z) => z !== 'frozen'), zone: zone || (s?.kind === 'warehouse' ? 'main' : 'back'), preset, needPhoto: false, photoLabel: 'รูปตาชั่ง (แนะนำ)',
    filter: (r) => r.product === 'fresh',
    extra: `<div class="form-grid">${field('น้ำหนักที่ชั่งได้ตอนนี้ (กก.)', '<input class="input" name="weighed_kg" type="number" min="0" step="0.01" inputmode="decimal">', { req: true, hint: 'ชั่งทั้งหมดของ Lot/ความสุกนี้ในจุดที่เลือก' })}
      ${field('หมายเหตุ', '<input class="input" name="note" placeholder="เช่น บ่ม 5 วัน ผิวเริ่มเหี่ยว">')}</div>
      <div class="summary-box" id="rw-sum">กรอกน้ำหนักที่ชั่งได้เพื่อดูน้ำหนักที่หาย</div>`,
    submitLabel: 'บันทึกผลชั่ง',
    onSubmit: async (f, mm) => {
      const res = await ctx.api.rpc('api_reweigh', { site_id, zone: f.zone, lot_id: f.lot_id, ripeness: f.ripeness, weighed_kg: f.weighed_kg, note: f.note, evidence: f.evidence });
      mm.close(); done(ctx, res.auto ? `บันทึก ${res.doc_no}: น้ำหนักหาย ${fmtKg(-res.kg)} (${fmtN(res.pct)}%)` : `น้ำหนักหาย ${fmtN(res.pct)}% เกินเกณฑ์ — ส่ง ${res.doc_no} ให้ผู้จัดการอนุมัติแล้ว`, res);
    } });
  const upd = () => { const r = m.current; const w = Number($('[name=weighed_kg]', m.el).value || 0);
    $('#rw-sum', m.el).innerHTML = r && w ? (w >= r.kg ? '<span style="color:var(--danger-ink)">น้ำหนักชั่งซ้ำต้องน้อยกว่ายอดในระบบ</span>'
      : `ยอดระบบ <b>${fmtKg(r.kg)}</b> → ชั่งได้ <b>${fmtKg(w)}</b> · หาย <b>${fmtKg(r.kg - w)}</b> (${fmtN(((r.kg - w) / r.kg) * 100)}%) ${((r.kg - w) / r.kg) * 100 <= lim ? '· บันทึกทันที' : '· <span style="color:var(--warn-ink)">เกินเกณฑ์ ต้องอนุมัติ</span>'}`) : 'กรอกน้ำหนักที่ชั่งได้เพื่อดูน้ำหนักที่หาย'; };
  $('[name=weighed_kg]', m.el).oninput = upd; $('[name=lot]', m.el).addEventListener('change', () => setTimeout(upd, 0));
}

// =====================================================================
// รับคืนสินค้าจากลูกค้า / เคลมเสียหาย
// =====================================================================
export function returnForm(ctx, d) {
  const sites = ctx.master.sites.filter((s) => s.active && (ctx.me.role !== 'branch' || ctx.can.actAt(s.id)));
  const st = { site: d.from_site_id, zone: d.from_zone };
  const m = openModal({ title: `รับคืน / เคลม · ${esc(d.doc_no)}`, sub: `${esc(d.destination)} · ของที่คืนเข้าสต็อกหลังผู้จัดการอนุมัติ · ถ้าส่วนที่คืนเคยออกบิลแล้ว ระบบจะแจ้งให้ออกใบลดหนี้`, size: 'xl',
    body: `<div id="rl">${table([
        { label: 'Lot', render: (l) => `<span class="lot">${esc(l.lot_code)}</span><div class="small muted">${esc(l.variety || '')} · ${esc(l.size || '')}</div>` },
        { label: 'ลูกค้ารับ', right: true, render: (l) => `${fmtN(l.received_kg)}${Number(l.returned_kg) ? `<div class="small muted">คืนแล้ว ${fmtN(l.returned_kg)}</div>` : ''}` },
        { label: 'ออกบิลแล้ว', right: true, render: (l) => fmtN(l.billed_kg) },
        { label: 'คืน/เคลม (กก.)', right: true, render: (l) => `<input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-kg="${l.id}">` },
        { label: 'การจัดการ', render: (l) => `<select class="input" data-disp="${l.id}" style="min-width:150px"><option value="restock">คืนเข้าสต็อก</option><option value="discard">เสียหาย (ไม่เข้าสต็อก)</option></select>` },
        { label: 'ความสุกตอนรับคืน', render: (l) => (l.product === 'frozen' ? 'แช่แข็ง' : `<select class="input" data-rip="${l.id}">${RIP_ORDER.map((k) => `<option value="${k}" ${k === l.ripeness ? 'selected' : ''}>${RIP[k]}</option>`).join('')}</select>`) },
      ], d.lines)}</div>
      <div class="form-grid g4" id="rh" style="margin-top:12px">
        ${field('คืนเข้าที่', `<select class="input" name="site_id">${opt(sites, st.site)}</select>`)}
        ${field('จุดจัดเก็บ', '<select class="input" name="zone"></select>')}
        ${field('เหตุผล / อาการที่ลูกค้าแจ้ง', '<input class="input" name="reason" placeholder="เช่น เนื้อดำ ผลช้ำ ส่งเกิน">', { req: true, cls: 'span-2' })}
        ${photoField('evidence', 'รูปสินค้าที่คืน / เสียหาย', true)}
        ${field('หมายเหตุ', '<input class="input" name="note">', { cls: 'span-3' })}</div>`,
    foot: '<button class="btn primary" id="ok">ส่งขออนุมัติรับคืน</button>' });
  bindPhotoFields(m.el, ctx.api);
  const zs = () => { const sid = Number($('[name=site_id]', m.el).value); const zones = zonesOf(ctx, sid); if (!zones.includes(st.zone)) st.zone = zones[0];
    $('[name=zone]', m.el).innerHTML = zones.map((z) => `<option value="${z}" ${z === st.zone ? 'selected' : ''}>${ZONE[z]}</option>`).join(''); };
  $('[name=site_id]', m.el).onchange = zs; $('[name=zone]', m.el).onchange = (e) => { st.zone = e.target.value; }; zs();
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const h = formData($('#rh', m.el));
    const lines = d.lines.map((l) => ({ dispatch_line_id: l.id, kg: Number($(`[data-kg="${l.id}"]`, m.el).value || 0), disposition: $(`[data-disp="${l.id}"]`, m.el).value, ripeness: $(`[data-rip="${l.id}"]`, m.el)?.value })).filter((x) => x.kg > 0);
    if (!lines.length) throw new Error('กรอกน้ำหนักที่คืนอย่างน้อย 1 รายการ');
    const res = await ctx.api.rpc('api_return_create', { dispatch_id: d.id, site_id: Number(h.site_id), zone: h.zone, reason: h.reason, evidence: h.evidence, note: h.note, lines });
    m.close(); done(ctx, `ส่ง ${res.doc_no} ให้ผู้จัดการอนุมัติแล้ว`); returnView(ctx, res.id);
  });
}

export async function returnView(ctx, id) {
  let r; try { r = await ctx.api.rpc('api_return_get', { id }); } catch (e) { toast(e.message, 'err'); return; }
  const canDecide = r.status === 'pending' && (ctx.can.approveAt(r.site_id) || ctx.can.approveAt(r.from_site_id)) && (r.requested_by !== ctx.me.id || ctx.me.role === 'admin');
  const m = openModal({ title: `ใบรับคืน / เคลม ${esc(r.doc_no)}`, sub: `${esc(r.customer)} · อ้างอิง ${esc(r.dispatch_no)} · คืนเข้า ${esc(r.site)} (${ZONE[r.zone]})`, size: 'lg',
    body: `<div class="actions" style="margin-bottom:12px">${statusBadge('return', r.status)}<span class="small muted">ขอโดย ${esc(r.requested_by_name || '-')} ${thDateTime(r.requested_at)}${r.decided_by_name ? ` · พิจารณาโดย ${esc(r.decided_by_name)} ${thDateTime(r.decided_at)}` : ''}</span></div>
      <div class="notice info">เหตุผล: ${esc(r.reason)}${r.note ? ' · ' + esc(r.note) : ''}${r.decision_note ? `<br>ผลพิจารณา: ${esc(r.decision_note)}` : ''}</div>
      ${table([{ label: 'Lot', render: (l) => `<span class="lot">${esc(l.lot_code)}</span> <span class="small muted">${esc(l.variety || '')} · ${esc(l.size || '')}</span>` },
        { label: 'กก.', right: true, render: (l) => `<b>${fmtN(l.kg)}</b>` }, { label: 'การจัดการ', render: (l) => (l.disposition === 'restock' ? `คืนเข้าสต็อก · ${RIP[l.ripeness]}` : '<span class="badge b-warn">เสียหาย (เคลม)</span>') },
        { label: 'ลูกค้ารับ / ออกบิล', right: true, render: (l) => `${fmtN(l.delivered_kg)} / ${fmtN(l.billed_kg)}` }], r.lines, { rowAttr: (l) => `class="click" data-lot="${l.lot_id}"` })}
      ${Number(r.credit_needed_kg) > 0 ? `<div class="notice" style="margin-top:12px">ของที่คืน/เคลม <b>${fmtKg(r.credit_needed_kg)}</b> เคยออกบิลไปแล้ว — ต้องออกใบลดหนี้อ้างอิงบิล ${esc(r.invoices.filter((i) => i.status === 'issued').map((i) => i.doc_no).join(', '))}</div>` : ''}
      ${r.credit_note_no ? `<div class="notice info" style="margin-top:12px">ออกใบลดหนี้แล้ว: <b>${esc(r.credit_note_no)}</b></div>` : ''}
      <div class="section-title">รูปหลักฐาน</div><div id="ev"></div>`,
    foot: `<div class="left">${r.status === 'pending' && (r.requested_by === ctx.me.id || canDecide) ? '<button class="btn" id="cancel">ยกเลิกใบ</button>' : ''}</div>
      ${Number(r.credit_needed_kg) > 0 && ctx.can.credit ? r.invoices.filter((i) => i.status === 'issued').map((i) => `<button class="btn primary" data-mkcn="${i.id}">ออกใบลดหนี้ · ${esc(i.doc_no)}</button>`).join('') : ''}
      ${canDecide ? '<button class="btn" id="no">ไม่อนุมัติ</button><button class="btn primary" id="yes">อนุมัติรับคืน</button>' : r.status === 'pending' ? '<span class="small muted">รอผู้จัดการอนุมัติ (ผู้ขออนุมัติเองไม่ได้)</span>' : ''}` });
  showEvidence($('#ev', m.el), r.evidence, ctx.api);
  $$('[data-lot]', m.el).forEach((tr) => (tr.onclick = () => lotTrace(ctx, Number(tr.dataset.lot))));
  const b = (sel, fn) => { const el = $(sel, m.el); if (el) el.onclick = fn; };
  b('#yes', (e) => busy(e.currentTarget, async () => { await ctx.api.rpc('api_return_decide', { id: r.id, approve: true }); m.close(); done(ctx, 'อนุมัติรับคืนแล้ว'); returnView(ctx, r.id); }));
  b('#no', async () => { const note = await confirmBox('ไม่อนุมัติรับคืน', 'ระบุเหตุผลให้ผู้ขอทราบ', { ok: 'ไม่อนุมัติ', danger: true, input: { label: 'เหตุผล', required: true } }); if (!note) return;
    try { await ctx.api.rpc('api_return_decide', { id: r.id, approve: false, note }); m.close(); done(ctx, 'บันทึกไม่อนุมัติแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  b('#cancel', async () => { const why = await confirmBox('ยกเลิกใบรับคืน', 'ยกเลิกคำขอนี้', { ok: 'ยกเลิกใบ', danger: true, input: { label: 'เหตุผล' } }); if (why === null) return;
    try { await ctx.api.rpc('api_return_cancel', { id: r.id, reason: why }); m.close(); done(ctx, 'ยกเลิกแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  $$('[data-mkcn]', m.el).forEach((el) => (el.onclick = async () => { m.close(); (await import('./salesdocs.js')).creditNoteForm(ctx, Number(el.dataset.mkcn), { return: r }); }));
}

// =====================================================================
// ตรวจนับสต็อกเป็นรอบ
// =====================================================================
export function stocktakeStart(ctx, site_id = null) {
  const sites = ctx.master.sites.filter((s) => s.active && ctx.can.actAt(s.id));
  if (!sites.length) { toast('ไม่มีสิทธิ์ตรวจนับที่สถานที่ใด', 'err'); return; }
  const sid0 = site_id && sites.some((s) => s.id === Number(site_id)) ? Number(site_id) : sites[0].id;
  const m = openModal({ title: 'เปิดใบตรวจนับสต็อก', sub: 'ระบบถ่ายยอดคงเหลือในระบบ ณ ตอนนี้ไว้ แล้วให้นับจริงทีละรายการ · ผลต่างจะปรับยอดทีเดียวเมื่อผู้จัดการอนุมัติ', size: 'sm',
    body: `<div class="grid" id="sf">${field('สถานที่', `<select class="input" name="site_id">${opt(sites, sid0)}</select>`)}
      ${field('จุดจัดเก็บ', '<select class="input" name="zone"></select>', { hint: 'เลือก "ทุกจุด" เพื่อนับทั้งสถานที่' })}
      ${field('หมายเหตุ', '<input class="input" name="note" placeholder="เช่น นับสิ้นเดือน">')}</div>`,
    foot: '<button class="btn primary" id="ok">เปิดใบนับ</button>' });
  const zs = () => { const sid = Number($('[name=site_id]', m.el).value); $('[name=zone]', m.el).innerHTML = '<option value="">ทุกจุด</option>' + zonesOf(ctx, sid).map((z) => `<option value="${z}">${ZONE[z]}</option>`).join(''); };
  $('[name=site_id]', m.el).onchange = zs; zs();
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const f = formData($('#sf', m.el)); const t = await ctx.api.rpc('api_stocktake_start', { site_id: Number(f.site_id), zone: f.zone, note: f.note });
    m.close(); done(ctx, `เปิด ${t.doc_no} · ${t.line_count} รายการที่ต้องนับ`); stocktakeView(ctx, t.id);
  });
}

export async function stocktakeView(ctx, id) {
  let t; try { t = await ctx.api.rpc('api_stocktake_get', { id }); } catch (e) { toast(e.message, 'err'); return; }
  const edit = t.status === 'draft' && ctx.can.stocktake && ctx.can.actAt(t.site_id);
  const counter = t.submitted_by === ctx.me.id || t.created_by === ctx.me.id || t.lines.some((x) => x.counted_by === ctx.me.id);
  const canDecide = t.status === 'submitted' && ctx.can.approveAt(t.site_id) && (!counter || ctx.me.role === 'admin');
  const cost = t.diff_value != null;
  const m = openModal({ title: `ใบตรวจนับ ${esc(t.doc_no)}`, sub: `${esc(t.site)} · ${t.zone ? ZONE[t.zone] : 'ทุกจุด'} · ยอดระบบ ณ ${thDateTime(t.created_at)}`, size: 'xl',
    body: `<div class="print-area"><div class="actions" style="margin-bottom:10px;align-items:center">${statusBadge('stocktake', t.status)}
        <span class="small muted">เปิดโดย ${esc(t.created_by_name || '-')}${t.submitted_by_name ? ` · ส่งโดย ${esc(t.submitted_by_name)}` : ''}${t.decided_by_name ? ` · พิจารณาโดย ${esc(t.decided_by_name)}` : ''}</span></div>
      ${t.decision_note ? `<div class="notice info">${esc(t.decision_note)}</div>` : ''}
      ${edit ? '<div class="notice info">กรอกน้ำหนักที่นับได้ทุกบรรทัด (ไม่พบของให้กรอก 0) · ปุ่ม "=" ใส่ค่าเท่ายอดระบบปัจจุบัน · <b>นับจุดไหนเสร็จให้กดบันทึกทันที</b> ระบบจะเทียบกับยอด ณ เวลาที่บันทึก (ของที่เข้า-ออกหลังนับไม่ถูกนับซ้ำ) · หลายคนช่วยนับพร้อมกันได้ ระบบบันทึกเฉพาะบรรทัดที่แต่ละคนกรอก · ทำงานต่อได้ตอนสัญญาณหลุด</div>' : ''}
      <div id="stl"></div>
      <div class="summary-box" id="sts" style="margin-top:12px"></div></div>
      ${edit ? `<div class="section-title">พบของที่ไม่มีในใบ</div><div class="form-grid g4" id="add">
        ${field('Lot', '<input class="input" name="code" placeholder="เช่น LOT-2609-001">')}
        ${field('จุด', `<select class="input" name="zone">${(t.zone ? [t.zone] : zonesOf(ctx, t.site_id)).map((z) => `<option value="${z}">${ZONE[z]}</option>`).join('')}</select>`)}
        ${field('ความสุก', `<select class="input" name="ripeness">${RIP_ORDER.map((k) => `<option value="${k}">${RIP[k]}</option>`).join('')}</select>`)}
        ${field('นับได้ (กก.)', '<input class="input" name="counted_kg" type="number" min="0" step="0.01" inputmode="decimal">')}</div>
        <button class="btn sm" id="add-btn" type="button" style="margin-top:8px">+ เพิ่มรายการ</button>` : ''}`,
    foot: `<div class="left">${['draft', 'submitted'].includes(t.status) && ctx.can.stocktake && ctx.can.actAt(t.site_id) ? '<button class="btn danger" id="cancel">ยกเลิกใบ</button>' : ''}<button class="btn" onclick="window.print()">พิมพ์ใบนับ</button></div>
      ${edit ? '<button class="btn" id="fill">นับตรงทั้งหมด</button><button class="btn" id="save">บันทึกผลนับ</button><button class="btn primary" id="submit">ส่งผู้จัดการอนุมัติ</button>' : ''}
      ${canDecide ? '<button class="btn" id="no">ไม่อนุมัติ</button><button class="btn primary" id="yes">อนุมัติ · ปรับยอด</button>' : t.status === 'submitted' ? '<span class="small muted">รอผู้จัดการอนุมัติ (ผู้นับอนุมัติเองไม่ได้)</span>' : ''}` });
  const val = (x) => { const i = $(`[data-c="${x.id}"]`, m.el); return i ? (i.value === '' ? null : Number(i.value)) : x.counted_kg == null ? null : Number(x.counted_kg); };
  const saved = (x) => (x.counted_kg == null ? null : Number(x.counted_kg));
  const changed = (x) => val(x) !== saved(x);
  // ยอดที่ใช้เทียบ: บรรทัดที่บันทึกแล้วใช้ยอดระบบ ณ เวลานับ · บรรทัดที่กำลังกรอกใช้ยอดปัจจุบัน
  const base = (x) => Number(changed(x) || x.count_system_kg == null ? (x.current_kg ?? x.system_kg) : x.count_system_kg);
  const draw = () => {
    $('#stl', m.el).innerHTML = table([
      { label: 'จุด', render: (x) => ZONE[x.zone] }, { label: 'Lot', render: (x) => `<span class="lot">${esc(x.lot_code)}</span>${x.added ? ' <span class="badge b-info">เพิ่ม</span>' : ''}` },
      { label: 'สินค้า', render: (x) => `${esc(x.variety || '-')} · ${esc(x.size || '-')}` }, { label: 'ความสุก', render: (x) => ripBadge(x.ripeness) },
      { label: 'ยอดระบบ', right: true, render: (x) => `<span data-b="${x.id}"></span><div class="small muted">${x.system_bags ? fmtN(x.system_bags) + ' ถุง' : fmtN(x.system_baskets) + ' ตะกร้า'}</div>` },
      { label: 'นับได้ (กก.)', right: true, render: (x) => (edit ? `<span class="actions" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm ghost" data-eq="${x.id}" type="button" title="เท่ายอดระบบปัจจุบัน">=</button><input class="cell" type="number" min="0" step="0.01" inputmode="decimal" data-c="${x.id}" value="${x.counted_kg ?? ''}"></span>` : fmtN(x.counted_kg))
        + (x.counted_by_name ? `<div class="small muted">${esc(x.counted_by_name)}${x.counted_at ? ' · ' + thDateTime(x.counted_at) : ''}</div>` : '') },
      { label: 'ส่วนต่าง', right: true, render: (x) => `<b data-d="${x.id}"></b>` },
      ...(cost ? [{ label: 'มูลค่าต่าง', right: true, render: (x) => `<span data-v="${x.id}"></span>` }] : []),
    ], t.lines, { empty: 'ไม่มีสต็อกในจุดนี้ (เพิ่มรายการที่พบได้ด้านล่าง)' });
    $$('[data-c]', m.el).forEach((i) => (i.oninput = sum));
    $$('[data-eq]', m.el).forEach((b) => (b.onclick = () => { const x = t.lines.find((y) => y.id === Number(b.dataset.eq)); $(`[data-c="${x.id}"]`, m.el).value = Math.max(0, Number(x.current_kg ?? x.system_kg)); sum(); }));
    sum();
  };
  const sum = () => {
    let n = 0; let dk = 0; let dv = 0;
    t.lines.forEach((x) => { const c = val(x); const el = $(`[data-d="${x.id}"]`, m.el); const bEl = $(`[data-b="${x.id}"]`, m.el);
      if (bEl) { const bv = c == null ? Number(x.current_kg ?? x.system_kg) : base(x); bEl.innerHTML = fmtN(bv) + (Math.abs(bv - Number(x.system_kg)) > 0.001 ? `<div class="small muted">ตอนเปิดใบ ${fmtN(x.system_kg)}</div>` : ''); }
      if (c == null) { el.textContent = '—'; el.style.color = ''; return; }
      n++; const d = Math.round((c - base(x)) * 100) / 100; dk += d; dv += d * Number(x.unit_cost || 0);
      el.textContent = d > 0 ? '+' + fmtN(d) : fmtN(d); el.style.color = d < 0 ? 'var(--danger-ink)' : d > 0 ? 'var(--ok-ink)' : '';
      const v = $(`[data-v="${x.id}"]`, m.el); if (v) v.textContent = d ? fmtMoney(d * Number(x.unit_cost || 0)) : ''; });
    $('#sts', m.el).innerHTML = `นับแล้ว <b>${n}/${t.lines.length}</b> รายการ · ยอดระบบ <b>${fmtKg(t.system_kg)}</b> · ส่วนต่างรวม <b style="color:${dk < 0 ? 'var(--danger-ink)' : 'inherit'}">${dk > 0 ? '+' : ''}${fmtKg(Math.round(dk * 100) / 100)}</b>${cost ? ` · มูลค่า ${fmtMoney(dv)} บาท` : ''}`;
  };
  // ส่งเฉพาะบรรทัดที่แก้ไข (ไม่ทับผลนับของคนอื่น) · ลบค่าเดิม = clear
  const payload = () => t.lines.filter((x) => $(`[data-c="${x.id}"]`, m.el) && changed(x))
    .map((x) => (val(x) == null ? { id: x.id, counted_kg: null, clear: true } : { id: x.id, counted_kg: val(x) }));
  const save = async (submit) => { const res = await ctx.api.rpc('api_stocktake_save', { id: t.id, lines: payload(), submit });
    if (res._queued) { done(ctx, '', res); return; }
    t = res; m.close(); done(ctx, submit ? `ส่ง ${t.doc_no} ให้ผู้จัดการอนุมัติแล้ว` : 'บันทึกผลนับแล้ว'); stocktakeView(ctx, t.id); };
  const b = (sel, fn) => { const el = $(sel, m.el); if (el) el.onclick = fn; };
  b('#fill', () => { t.lines.forEach((x) => { const i = $(`[data-c="${x.id}"]`, m.el); if (i && i.value === '') i.value = Math.max(0, Number(x.current_kg ?? x.system_kg)); }); sum(); });
  b('#save', (e) => busy(e.currentTarget, () => save(false)));
  b('#submit', (e) => busy(e.currentTarget, () => save(true)));
  b('#add-btn', (e) => busy(e.currentTarget, async () => {
    const f = formData($('#add', m.el)); if (!f.code || f.counted_kg == null) throw new Error('กรอกเลข Lot และน้ำหนักที่นับได้');
    const lot = await ctx.api.rpc('api_lot_trace', { code: f.code.trim().toUpperCase() });
    const res = await ctx.api.rpc('api_stocktake_save', { id: t.id, lines: payload(), add: [{ lot_id: lot.id, zone: f.zone, ripeness: f.ripeness, counted_kg: Number(f.counted_kg) }] });
    if (res._queued) { done(ctx, '', res); return; }
    m.close(); stocktakeView(ctx, t.id);
  }));
  b('#yes', (e) => busy(e.currentTarget, async () => { await ctx.api.rpc('api_stocktake_decide', { id: t.id, approve: true }); m.close(); done(ctx, `อนุมัติ ${t.doc_no} · ปรับยอดตามนับจริงแล้ว`); }));
  b('#no', async () => { const note = await confirmBox('ไม่อนุมัติผลนับ', 'ระบุเหตุผล เช่น ให้นับใหม่', { ok: 'ไม่อนุมัติ', danger: true, input: { label: 'เหตุผล', required: true } }); if (!note) return;
    try { await ctx.api.rpc('api_stocktake_decide', { id: t.id, approve: false, note }); m.close(); done(ctx, 'บันทึกไม่อนุมัติแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  b('#cancel', async () => { const why = await confirmBox('ยกเลิกใบตรวจนับ', 'ผลนับในใบนี้จะไม่ถูกใช้', { ok: 'ยกเลิกใบ', danger: true, input: { label: 'เหตุผล' } }); if (why === null) return;
    try { await ctx.api.rpc('api_stocktake_cancel', { id: t.id, reason: why }); m.close(); done(ctx, 'ยกเลิกแล้ว'); } catch (e) { toast(e.message, 'err'); } });
  draw();
}

// =====================================================================
// มอบหมายผู้รับผิดชอบ + กำหนดเสร็จ
// =====================================================================
export async function assignModal(ctx, task, after = null) {
  const people = await ctx.api.rpc('api_assignees', {});
  const fit = people.filter((p) => p.role !== 'branch' || !task.site_id || p.site_id === task.site_id);
  const m = openModal({ title: 'มอบหมายผู้รับผิดชอบ', sub: `${esc(task.title)} · ${esc(task.doc_no)}${task.site ? ' · ' + esc(task.site) : ''}`, size: 'sm',
    body: `<div class="grid" id="af"><div class="notice info">${esc(task.missing)}</div>
      ${field('ผู้รับผิดชอบ', `<select class="input" name="assignee_id"><option value="">— ยังไม่ระบุ —</option>${fit.map((p) => `<option value="${p.id}" ${p.id === task.assignee_id ? 'selected' : ''}>${esc(p.name)} · ${esc(ROLE[p.role] || p.role)}${p.is_manager ? ' (ผจก.)' : ''}${p.site ? ' · ' + esc(p.site) : ''}</option>`).join('')}</select>`)}
      ${field('กำหนดเสร็จ', `<input class="input" type="datetime-local" name="due_at" value="${toLocalInput(task.due_at)}">`)}
      ${field('หมายเหตุถึงผู้รับผิดชอบ', `<input class="input" name="note" value="${esc(task.assign_note || '')}">`)}</div>`,
    foot: '<button class="btn primary" id="ok">บันทึก</button>' });
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const f = formData($('#af', m.el));
    await ctx.api.rpc('api_assign', { entity: task.entity, id: task.entity_id, assignee_id: f.assignee_id ? Number(f.assignee_id) : null, due_at: fromLocalInput(f.due_at), note: f.note });
    m.close(); done(ctx, 'มอบหมายงานแล้ว'); after && after();
  });
}

// เปิดเอกสารของงานในคิว
export async function openTask(ctx, t) {
  if (t.entity === 'receipt') return receiptView(ctx, t.entity_id);
  if (['dispatch', 'dispatch_receive', 'bill'].includes(t.entity)) return dispatchView(ctx, t.entity_id);
  if (t.entity === 'case') { const cs = (await ctx.api.rpc('api_cases', { status: 'open' })).find((c) => c.id === t.entity_id); return cs ? dispatchView(ctx, cs.dispatch_id) : null; }
  if (t.entity === 'adjustment') return approvalsModal(ctx);
  if (t.entity === 'return' || t.entity === 'credit') return returnView(ctx, t.entity_id);
  if (t.entity === 'stocktake') return stocktakeView(ctx, t.entity_id);
  if (t.entity === 'po') return (await import('./purchase.js')).poView(ctx, t.entity_id);
  return null;
}

// =====================================================================
// รายการที่บันทึกตอนออฟไลน์ (รอส่ง / ส่งไม่สำเร็จ)
// =====================================================================
const FN_LABEL = { api_ripeness_change: 'ตรวจความสุก', api_adjust_request: 'ขาย/ใช้/ตัดทิ้ง/ปรับยอด', api_reweigh: 'ชั่งซ้ำ', api_stocktake_save: 'ผลตรวจนับ',
  api_zone_transfer: 'โอนภายใน', api_dispatch_receive: 'ยืนยันรับของ', api_receipt_save: 'ใบรับเข้า' };
export function outboxModal(ctx) {
  if (!ctx.api.outbox) { toast('โหมดนี้ไม่มีรายการรอส่ง'); return; }
  const list = ctx.api.outbox();
  const m = openModal({ title: 'รายการที่บันทึกตอนออฟไลน์', sub: ctx.api.offline ? 'ยังออฟไลน์อยู่ — ระบบจะส่งให้อัตโนมัติเมื่อมีสัญญาณ' : 'ระบบส่งให้อัตโนมัติทุก 1 นาที หรือกด "ส่งตอนนี้"', size: 'lg',
    body: table([{ label: 'เวลา', render: (x) => thDateTime(x.at) }, { label: 'รายการ', render: (x) => esc(FN_LABEL[x.fn] || x.fn) },
      { label: 'สถานะ', render: (x) => (x.status === 'failed' ? `<span class="badge b-danger">ส่งไม่สำเร็จ</span><div class="small" style="color:var(--danger-ink)">${esc(x.error || '')}</div>` : '<span class="badge b-warn">รอส่ง</span>') },
      { label: '', render: (x) => `<span class="actions" style="justify-content:flex-end">${x.status === 'failed' ? `<button class="btn sm" data-retry="${x.ref}">ส่งใหม่</button>` : ''}<button class="btn sm ghost" data-del="${x.ref}">ลบ</button></span>` }],
      list, { empty: 'ไม่มีรายการค้างส่ง' }),
    foot: list.length ? '<button class="btn primary" id="flush">ส่งตอนนี้</button>' : '' });
  const re = () => { m.close(); outboxModal(ctx); };
  $$('[data-retry]', m.el).forEach((b) => (b.onclick = async () => { await ctx.api.outboxRetry(b.dataset.retry); re(); }));
  $$('[data-del]', m.el).forEach((b) => (b.onclick = async () => { if (await confirmBox('ลบรายการ', 'รายการนี้จะไม่ถูกส่งเข้าระบบ', { ok: 'ลบ', danger: true })) { ctx.api.outboxDelete(b.dataset.del); re(); } }));
  const f = $('#flush', m.el); if (f) f.onclick = (e) => busy(e.currentTarget, async () => { await ctx.api.flush(); re(); });
}
