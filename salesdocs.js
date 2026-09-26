// =====================================================================
// เอกสารฝ่ายขาย: บิล (สร้างจากใบตีออกที่ส่งมอบแล้ว), ใบเสนอราคา, ลูกค้า
// บิลและใบเสนอราคาไม่ตัดสต็อก — สต็อกลดตอนตีออก/ส่งมอบแล้ว
// =====================================================================
import { $, $$, esc, fmtN, fmtKg, fmtMoney, thDate, thDateY, todayISO, statusBadge, RIP, CHANNEL, DOC_TYPE,
  openModal, confirmBox, toast, busy, opt, field, table, formData } from './ui.js';
import { lotTrace, dispatchView, returnView } from './docs.js';

const calc = (sub, disc, ship, rate) => { const base = sub - (disc || 0) + (ship || 0); const vat = Math.round(base * (rate || 0)) / 100; return { sub, disc: disc || 0, ship: ship || 0, vat, total: Math.round((base + vat) * 100) / 100 }; };
const totalsHtml = (t, rate) => `<div class="kv"><span>ยอดรวมสินค้า</span><span class="num">${fmtMoney(t.sub)}</span></div>
  <div class="kv"><span>ส่วนลด</span><span class="num">${t.disc ? '−' + fmtMoney(t.disc) : '0.00'}</span></div>
  <div class="kv"><span>ค่าขนส่ง</span><span class="num">${fmtMoney(t.ship)}</span></div>
  <div class="kv"><span>VAT ${rate || 0}%</span><span class="num">${fmtMoney(t.vat)}</span></div>
  <div class="total-line"><span class="strong">ยอดสุทธิ</span><span class="v num">${fmtMoney(t.total)} บาท</span></div>`;
const branchTxt = (b) => (!b ? '' : /^\d+$/.test(String(b)) ? `สาขาที่ ${b}` : b);
const band = (r) => r.min_price != null || r.max_price != null;
const bandTxt = (r) => (band(r) ? `กรอบ ${fmtN(r.min_price ?? r.price)}–${fmtN(r.max_price ?? r.price)}` : '');
const done = (ctx, msg) => { toast(msg, 'ok'); ctx.refreshBell(); if (ctx._onChange) ctx._onChange(); };
const company = (ctx) => ctx.master.settings?.company || {};

// ---------- สร้างบิล ----------
export async function invoiceForm(ctx, { customer_id = null, dispatch_id = null } = {}) {
  const M = ctx.master; const canPrice = ['admin', 'executive'].includes(ctx.me.role);
  const st = { cust: customer_id, rows: [], picks: {} };
  const m = openModal({ title: 'สร้างบิลจากใบตีออก', sub: 'อ้างอิงจำนวนที่ส่งมอบ/ตรวจรับจริง · รวมหลายใบตีออกของลูกค้าเดียวกัน หรือออกบิลบางส่วนได้ · ระบบกันบิลซ้ำ', size: 'xl',
    body: `<div class="form-grid g4" id="ih">
        ${field('ลูกค้า', `<select class="input" name="customer_id">${opt(M.customers, st.cust, (c) => `${c.name} (${CHANNEL[c.channel] || c.channel})`, (c) => c.id, '— เลือกลูกค้า —')}</select>`, { req: true })}
        ${field('ประเภทเอกสาร', `<select class="input" name="doc_type">${Object.entries(DOC_TYPE).map(([k, [t, pre]]) => `<option value="${k}">${t} (${pre})</option>`).join('')}</select>`, { hint: 'ใบกำกับภาษีเต็มรูปใช้เลขชุดแยก ต้องคิด VAT 7%' })}
        ${field('วันที่บิล', `<input class="input" type="date" name="doc_date" value="${todayISO()}">`)}
        ${field('หมายเหตุ', '<input class="input" name="note">')}
      </div>
      <div class="section-title">รายการที่ส่งมอบแล้วและยังไม่ได้ออกบิล</div>
      <div id="bl"><div class="muted small">เลือกลูกค้าก่อน</div></div>
      <div class="split" style="margin-top:14px"><div class="form-grid g3" id="it">
        ${field('ส่วนลด (บาท)', '<input class="input" name="discount" type="number" min="0" step="0.01" value="0">', { hint: canPrice ? '' : `ฝ่ายขายให้ได้ไม่เกิน ${M.settings?.options?.max_sales_discount_pct ?? 5}%` })}
        ${field('ค่าขนส่ง (บาท)', '<input class="input" name="shipping" type="number" min="0" step="0.01" value="0">')}
        ${field('VAT', '<select class="input" name="vat_rate"><option value="0">ไม่มี VAT</option><option value="7">VAT 7%</option></select>')}</div>
        <div class="summary-box" id="tot"></div></div>`,
    foot: '<button class="btn primary" id="ok">ออกบิล</button>' });
  const load = async () => {
    st.rows = st.cust ? await ctx.api.rpc('api_billable', { customer_id: st.cust }) : []; st.picks = {};
    st.rows.forEach((r) => { if (!dispatch_id || r.dispatch_id === dispatch_id) st.picks[r.dispatch_line_id] = { kg: Number(r.billable_kg), price: r.price }; });
    draw();
  };
  const draw = () => {
    $('#bl', m.el).innerHTML = st.cust ? table([
      { label: '', render: (r) => `<input type="checkbox" data-pick="${r.dispatch_line_id}" ${st.picks[r.dispatch_line_id] ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--primary)">` },
      { label: 'ใบตีออก', render: (r) => `${esc(r.dispatch_no)}<div class="small muted">ส่งมอบ ${thDate(r.delivered_at)}</div>` },
      { label: 'Lot', render: (r) => `<span class="lot">${esc(r.lot_code)}</span>` },
      { label: 'สินค้า', render: (r) => `${esc(r.variety || '-')} · ${esc(r.size || '-')}${r.product === 'frozen' ? ' <span class="badge b-info">แช่แข็ง</span>' : ''}` },
      { label: 'ส่ง / รับจริง', right: true, render: (r) => `${fmtN(r.shipped_kg)} / <b>${fmtN(r.received_kg)}</b>${Number(r.returned_kg) ? `<div class="small" style="color:var(--warn-ink)">คืน ${fmtN(r.returned_kg)}</div>` : ''}` },
      { label: 'ออกบิลแล้ว', right: true, render: (r) => fmtN(r.billed_kg) },
      { label: 'ออกบิล (กก.)', right: true, render: (r) => `<input class="cell" type="number" min="0" step="0.01" data-kg="${r.dispatch_line_id}" value="${st.picks[r.dispatch_line_id]?.kg ?? ''}" max="${r.billable_kg}">` },
      { label: 'ราคา/กก.', right: true, render: (r) => (r.price == null && !canPrice ? '<span class="badge b-warn">ยังไม่ตั้งราคา</span>' : `<input class="cell" type="number" min="${!canPrice && band(r) ? r.min_price ?? r.price : 0}" ${!canPrice && band(r) ? `max="${r.max_price ?? r.price}"` : ''} step="0.01" data-price="${r.dispatch_line_id}" value="${st.picks[r.dispatch_line_id]?.price ?? r.price ?? ''}" ${canPrice || band(r) ? '' : 'readonly title="ฝ่ายขายแก้ราคาไม่ได้"'}>${band(r) ? `<div class="small muted">${bandTxt(r)}</div>` : ''}`) },
      { label: 'รวม', right: true, render: (r) => `<span data-amt="${r.dispatch_line_id}"></span>` },
    ], st.rows, { empty: 'ไม่มีรายการรอออกบิลของลูกค้านี้ (ต้องตีออกขายและยืนยันส่งมอบก่อน)' }) : '<div class="muted small">เลือกลูกค้าก่อน</div>';
    const upd = (id) => { const kg = Number($(`[data-kg="${id}"]`, m.el)?.value || 0); const pr = Number($(`[data-price="${id}"]`, m.el)?.value || 0);
      if (kg > 0) st.picks[id] = { kg, price: pr }; else delete st.picks[id];
      const cb = $(`[data-pick="${id}"]`, m.el); if (cb) cb.checked = kg > 0; const a = $(`[data-amt="${id}"]`, m.el); if (a) a.textContent = kg > 0 ? fmtMoney(kg * pr) : ''; tot(); };
    $$('[data-kg],[data-price]', m.el).forEach((i) => (i.oninput = () => upd(Number(i.dataset.kg || i.dataset.price))));
    $$('[data-pick]', m.el).forEach((c) => (c.onchange = () => { const id = Number(c.dataset.pick); const r = st.rows.find((x) => x.dispatch_line_id === id); $(`[data-kg="${id}"]`, m.el).value = c.checked ? r.billable_kg : ''; upd(id); }));
    st.rows.forEach((r) => upd(r.dispatch_line_id));
    tot();
  };
  const tot = () => { const f = formData($('#it', m.el)); const sub = Object.values(st.picks).reduce((a, p) => a + Math.round(p.kg * p.price * 100) / 100, 0);
    $('#tot', m.el).innerHTML = totalsHtml(calc(sub, Number(f.discount || 0), Number(f.shipping || 0), Number(f.vat_rate || 0)), Number(f.vat_rate || 0)); };
  $('[name=customer_id]', m.el).onchange = (e) => { st.cust = e.target.value ? Number(e.target.value) : null; load(); };
  $('[name=doc_type]', m.el).onchange = (e) => { const vr = $('[name=vat_rate]', m.el); if (e.target.value === 'tax_invoice') { vr.value = '7'; vr.disabled = true; } else vr.disabled = false; tot(); };
  $$('#it input, #it select', m.el).forEach((i) => (i.oninput = i.onchange = tot));
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const h = formData($('#ih', m.el)); const t = formData($('#it', m.el)); if (h.doc_type === 'tax_invoice') t.vat_rate = 7;
    const lines = Object.entries(st.picks).map(([id, p]) => ({ dispatch_line_id: Number(id), kg: p.kg, price: p.price }));
    const res = await ctx.api.rpc('api_invoice_create', { ...h, ...t, lines });
    m.close(); done(ctx, `ออกบิล ${res.doc_no} แล้ว · ${fmtMoney(res.total)} บาท`); invoiceView(ctx, res.id);
  });
  load();
}

// ---------- ดูบิล ----------
export async function invoiceView(ctx, id, doc_no = null) {
  let i; try { i = await ctx.api.rpc('api_invoice_get', id ? { id } : { doc_no }); } catch (e) { toast(e.message, 'err'); return; }
  if (!i) { toast('ไม่พบบิล', 'err'); return; }
  const co = i.seller || company(ctx); const by = i.buyer || { name: i.customer, address: i.customer_address, tax_id: i.customer_tax_id };
  const isTax = i.doc_type === 'tax_invoice';
  const delivered = [...new Map(i.lines.map((l) => [l.dispatch_line_id, l.delivered_kg])).values()].reduce((a, x) => a + Number(x || 0), 0);
  const billed = i.lines.reduce((a, l) => a + Number(l.kg), 0);
  const first = i.lines[0];
  const m = openModal({ title: `${esc(i.title)} ${esc(i.doc_no)}`, sub: `อ้างอิงใบตีออก ${esc(i.dispatches || '-')} · ลูกค้า ${esc(i.customer)}`, size: 'xl',
    body: `<div class="split">
      <div class="card print-area doc-print">
        <div class="doc-head"><div><h2>${esc(co.name || 'AVO FLOW')}</h2><div class="small muted">${esc(co.address || '')}${co.tax_id ? '<br>เลขประจำตัวผู้เสียภาษี ' + esc(co.tax_id) : ''}${isTax ? ' · ' + esc(branchTxt(co.branch || 'สำนักงานใหญ่')) : ''}${co.phone ? ' · โทร ' + esc(co.phone) : ''}</div></div>
          <div class="right"><div class="strong">${esc(i.title)}</div>${isTax ? '<div class="small">ต้นฉบับ (เอกสารออกเป็นชุด)</div>' : ''}<div>เลขที่ ${esc(i.doc_no)}</div><div class="small muted">วันที่ ${thDateY(i.doc_date)}</div>${i.status === 'cancelled' ? '<div class="badge b-danger">ยกเลิก</div>' : ''}</div></div>
        <div class="small" style="margin-bottom:12px"><b>${isTax ? 'ผู้ซื้อ' : 'ลูกค้า'}</b> ${esc(by.name)}${by.address ? '<br>' + esc(by.address) : ''}${by.tax_id ? '<br>เลขประจำตัวผู้เสียภาษี ' + esc(by.tax_id) : ''}${by.branch ? ' · ' + esc(branchTxt(by.branch)) : ''}</div>
        ${table([{ label: 'สินค้า', render: (l) => `อะโวคาโด ${esc(l.variety || '-')} ${esc(l.size || '')}${l.product === 'frozen' ? ' (แช่แข็ง)' : ''}<div class="small muted">Lot ${esc(l.lot_code)}${Number(l.credited_kg) ? ` · ลดหนี้แล้ว ${fmtN(l.credited_kg)} กก.` : ''}</div>` },
          { label: 'จำนวน (น้ำหนักสุทธิ)', render: (l) => fmtKg(l.kg) }, { label: 'ราคา/กก.', render: (l) => `${fmtMoney(l.price)} บาท` }, { label: 'จำนวนเงิน', right: true, render: (l) => `${fmtMoney(l.amount)} บาท` }], i.lines)}
        <div style="max-width:360px;margin-left:auto;margin-top:8px">${totalsHtml({ sub: Number(i.subtotal), disc: Number(i.discount), ship: Number(i.shipping), vat: Number(i.vat), total: Number(i.total) }, Number(i.vat_rate))}</div>
        ${i.note ? `<div class="small muted" style="margin-top:10px">หมายเหตุ: ${esc(i.note)}</div>` : ''}
        ${i.cancel_reason ? `<div class="notice" style="margin-top:10px">ยกเลิก: ${esc(i.cancel_reason)}</div>` : ''}
        ${isTax ? '<div class="sign-row"><div>ผู้รับสินค้า ................................</div><div>ผู้มีอำนาจลงนาม ................................</div></div>' : ''}
      </div>
      <div class="card"><div class="card-title" style="margin-bottom:6px">ข้อมูลบิล</div>
        <div class="kv"><span>ลูกค้า</span><span>${esc(i.customer)}</span></div>
        <div class="kv"><span>ช่องทาง</span><span>${esc(CHANNEL[i.channel] || i.channel)}</span></div>
        <div class="kv"><span>วันที่</span><span>${thDateY(i.doc_date)}</span></div>
        <div class="kv"><span>ส่งมอบจริง</span><span>${fmtKg(delivered)}</span></div>
        <div class="kv"><span>ออกบิลแล้ว (ใบนี้)</span><span>${fmtKg(billed)}</span></div>
        <div class="kv"><span>ค่าขนส่ง</span><span>${fmtMoney(i.shipping)} บาท</span></div>
        <div class="kv"><span>ส่วนลด / VAT</span><span>${fmtMoney(i.discount)} / ${fmtN(i.vat_rate)}%</span></div>
        ${['admin', 'executive'].includes(ctx.me.role) || ctx.me.role === 'sales' ? `<div class="kv"><span>ต้นทุน / กำไรขั้นต้น</span><span>${fmtMoney(i.cost_total)} / <b>${fmtMoney(i.gross_profit)}</b></span></div>` : ''}
        <div class="kv"><span>สถานะ</span><span>${statusBadge('invoice', i.status)}</span></div>
        <div class="kv"><span>ผู้ออกบิล</span><span>${esc(i.created_by_name || '-')}</span></div>
        ${i.credit_notes.length ? `<div class="section-title">ใบลดหนี้</div>${i.credit_notes.map((n) => `<div class="zone-row"><button class="link" data-cn="${n.id}">${esc(n.doc_no)}</button><span>${n.status === 'cancelled' ? '<span class="badge b-gray">ยกเลิก</span>' : '−' + fmtMoney(n.total)}</span></div>`).join('')}
          <div class="kv"><span>ยอดสุทธิหลังลดหนี้</span><span><b>${fmtMoney(Number(i.total) - Number(i.credited_total))}</b></span></div>` : ''}
      </div></div>
      <div class="foot-note chain"><b>เชื่อมเอกสาร</b> บิล → <a href="javascript:void 0" data-disp="${first?.dispatch_id}">${esc(first?.dispatch_no || 'ใบตีออก')}</a> → <a href="javascript:void 0" data-lot="${first?.lot_id}">${esc(first?.lot_code || 'Lot')}</a> → ${esc(first?.receipt_no || 'ใบรับเข้า')} → <b>${esc(first?.supplier || 'สวน')}</b>
        ${i.lines.length > 1 ? `<span class="muted">(+${i.lines.length - 1} รายการ · กดที่ Lot แต่ละบรรทัดเพื่อย้อนดู)</span>` : ''}</div>`,
    foot: `<div class="left">${i.status === 'issued' && ['admin', 'executive'].includes(ctx.me.role) ? '<button class="btn danger" id="cancel">ยกเลิกบิล</button>' : ''}</div>
      ${i.status === 'issued' && ctx.can.credit && ['admin', 'executive'].includes(ctx.me.role) && i.lines.some((l) => Number(l.credited_kg) < Number(l.kg)) ? '<button class="btn" id="cn">ออกใบลดหนี้</button>' : ''}
      <button class="btn primary" onclick="window.print()">พิมพ์ / บันทึก PDF</button>` });
  $$('[data-cn]', m.el).forEach((b) => (b.onclick = () => creditNoteView(ctx, Number(b.dataset.cn))));
  const cnb = $('#cn', m.el); if (cnb) cnb.onclick = () => { m.close(); creditNoteForm(ctx, i.id); };
  $$('[data-disp]', m.el).forEach((a) => (a.onclick = () => dispatchView(ctx, Number(a.dataset.disp))));
  $$('[data-lot]', m.el).forEach((a) => (a.onclick = () => lotTrace(ctx, Number(a.dataset.lot))));
  $$('.print-area tbody tr', m.el).forEach((tr, idx) => { tr.classList.add('click'); tr.onclick = () => lotTrace(ctx, i.lines[idx].lot_id); });
  const c = $('#cancel', m.el); if (c) c.onclick = async () => {
    const why = await confirmBox('ยกเลิกบิล', 'ยอดที่ออกบิลในใบนี้จะกลับไปเป็น "รอออกบิล" (สต็อกไม่เปลี่ยน)', { ok: 'ยกเลิกบิล', danger: true, input: { label: 'เหตุผล', required: true } }); if (!why) return;
    try { await ctx.api.rpc('api_invoice_cancel', { id: i.id, reason: why }); m.close(); done(ctx, 'ยกเลิกบิลแล้ว'); } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------- ใบเสนอราคา ----------
export function quoteForm(ctx, q = null) {
  const M = ctx.master; const canPrice = ['admin', 'executive'].includes(ctx.me.role);
  let lines = q ? q.lines.map((l) => ({ variety_id: l.variety_id, size_id: l.size_id, product: 'fresh', kg: l.kg, price: l.price })) : [{ variety_id: M.varieties[0]?.id, size_id: '', product: 'fresh', kg: '', price: '' }];
  const m = openModal({ title: q ? `แก้ไข ${esc(q.doc_no)}` : 'ใบเสนอราคา', sub: 'ไม่ตัดสต็อก · ราคาดึงจากราคาที่ผู้บริหารตั้งไว้', size: 'lg',
    body: `<div class="form-grid g4" id="qh">
      ${field('ลูกค้า', `<select class="input" name="customer_id">${opt(M.customers.filter((c) => c.active), q?.customer_id, (c) => c.name, (c) => c.id, '— เลือกลูกค้า —')}</select>`, { req: true })}
      ${field('วันที่', `<input class="input" type="date" name="doc_date" value="${q?.doc_date || todayISO()}">`)}
      ${field('ยืนราคาถึง', `<input class="input" type="date" name="valid_until" value="${q?.valid_until || ''}">`)}
      ${field('สถานะ', `<select class="input" name="status"><option value="draft">ฉบับร่าง</option><option value="sent" ${q?.status === 'sent' ? 'selected' : ''}>ส่งลูกค้าแล้ว</option></select>`)}</div>
      <div class="section-title">รายการ</div><div id="ql"></div><button class="btn sm" id="add" type="button" style="margin-top:8px">+ เพิ่มรายการ</button>
      <div class="split" style="margin-top:14px"><div class="form-grid g3" id="qt">
        ${field('ส่วนลด (บาท)', `<input class="input" name="discount" type="number" min="0" step="0.01" value="${q?.discount ?? 0}">`)}
        ${field('ค่าขนส่ง (บาท)', `<input class="input" name="shipping" type="number" min="0" step="0.01" value="${q?.shipping ?? 0}">`)}
        ${field('VAT', `<select class="input" name="vat_rate"><option value="0">ไม่มี VAT</option><option value="7" ${Number(q?.vat_rate) === 7 ? 'selected' : ''}>VAT 7%</option></select>`)}
        ${field('หมายเหตุ', `<input class="input" name="note" value="${esc(q?.note || '')}">`, { cls: 'span-all' })}</div><div class="summary-box" id="qs"></div></div>`,
    foot: '<button class="btn primary" id="ok">บันทึกใบเสนอราคา</button>' });
  const cust = () => $('[name=customer_id]', m.el).value || null;
  const price = async (l) => { if (!l.variety_id || !l.size_id) return; const r = await ctx.api.rpc('api_price_lookup', { customer_id: cust(), variety_id: l.variety_id, size_id: l.size_id, product: l.product });
    l.band = r.price != null && (r.min_price != null || r.max_price != null) ? { min: r.min_price ?? r.price, max: r.max_price ?? r.price } : null;
    if (r.price != null) l.price = r.price; else if (!canPrice) l.price = ''; };
  const draw = () => {
    $('#ql', m.el).innerHTML = table([
      { label: 'สายพันธุ์', render: (l, i) => `<select class="input" data-i="${i}" data-k="variety_id">${opt(M.varieties.filter((v) => v.active), l.variety_id)}</select>` },
      { label: 'ไซส์', render: (l, i) => `<select class="input" data-i="${i}" data-k="size_id">${opt(M.sizes.filter((v) => v.active), l.size_id, (x) => x.name, (x) => x.id, '—')}</select>` },
      { label: 'ประเภท', render: (l, i) => `<select class="input" data-i="${i}" data-k="product"><option value="fresh">สด</option><option value="frozen" ${l.product === 'frozen' ? 'selected' : ''}>แช่แข็ง</option></select>` },
      { label: 'กก.', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" data-i="${i}" data-k="kg" value="${esc(l.kg)}" style="width:100px">` },
      { label: 'ราคา/กก.', render: (l, i) => `<input class="input num" type="number" min="0" step="0.01" data-i="${i}" data-k="price" value="${esc(l.price)}" style="width:100px" ${canPrice || l.band ? '' : 'readonly'} placeholder="${canPrice ? '' : 'ยังไม่ตั้งราคา'}">${l.band ? `<div class="small muted">กรอบ ${fmtN(l.band.min)}–${fmtN(l.band.max)}</div>` : ''}` },
      { label: 'รวม', right: true, render: (l) => fmtMoney(Number(l.kg || 0) * Number(l.price || 0)) },
      { label: '', render: (l, i) => (lines.length > 1 ? `<button class="btn sm ghost" data-del="${i}">✕</button>` : '') },
    ], lines);
    $$('#ql [data-k]', m.el).forEach((el) => (el.onchange = async () => { const l = lines[el.dataset.i]; l[el.dataset.k] = el.value; if (['variety_id', 'size_id', 'product'].includes(el.dataset.k)) await price(l); draw(); }));
    $$('#ql [data-del]', m.el).forEach((b) => (b.onclick = () => { lines.splice(Number(b.dataset.del), 1); draw(); }));
    tot();
  };
  const tot = () => { const f = formData($('#qt', m.el)); const sub = lines.reduce((a, l) => a + Math.round(Number(l.kg || 0) * Number(l.price || 0) * 100) / 100, 0);
    $('#qs', m.el).innerHTML = totalsHtml(calc(sub, Number(f.discount || 0), Number(f.shipping || 0), Number(f.vat_rate || 0)), Number(f.vat_rate || 0)); };
  $$('#qt input, #qt select', m.el).forEach((i) => (i.oninput = i.onchange = tot));
  $('[name=customer_id]', m.el).onchange = async () => { for (const l of lines) await price(l); draw(); };
  $('#add', m.el).onclick = () => { lines.push({ variety_id: M.varieties[0]?.id, size_id: '', product: 'fresh', kg: '', price: '' }); draw(); };
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const res = await ctx.api.rpc('api_quote_save', { id: q?.id, ...formData($('#qh', m.el)), ...formData($('#qt', m.el)), lines: lines.map((l) => ({ ...l, kg: Number(l.kg), price: l.price === '' ? null : Number(l.price) })) });
    m.close(); done(ctx, `บันทึก ${res.doc_no} แล้ว`); quoteView(ctx, res.id);
  });
  (async () => { if (q) { for (const l of lines) { const keep = l.price; await price(l); l.price = keep; } } draw(); })();
}

export async function quoteView(ctx, id) {
  const q = await ctx.api.rpc('api_quote_get', { id }); const co = company(ctx);
  const m = openModal({ title: `ใบเสนอราคา ${esc(q.doc_no)}`, sub: esc(q.customer), size: 'lg',
    body: `<div class="card print-area doc-print"><div class="doc-head"><div><h2>${esc(co.name || 'AVO FLOW')}</h2><div class="small muted">${esc(co.address || '')}${co.phone ? ' · โทร ' + esc(co.phone) : ''}</div></div>
      <div class="right"><div class="strong">ใบเสนอราคา</div><div>${esc(q.doc_no)}</div><div class="small muted">${thDateY(q.doc_date)}${q.valid_until ? '<br>ยืนราคาถึง ' + thDateY(q.valid_until) : ''}</div></div></div>
      <div class="small" style="margin-bottom:12px"><b>เรียน</b> ${esc(q.customer)}${q.customer_address ? '<br>' + esc(q.customer_address) : ''}</div>
      ${table([{ label: 'สินค้า', render: (l) => `${esc(l.variety)} ${esc(l.size)}` }, { label: 'จำนวน', render: (l) => fmtKg(l.kg) }, { label: 'ราคา/กก.', render: (l) => fmtMoney(l.price) }, { label: 'รวม', right: true, render: (l) => fmtMoney(l.amount) }], q.lines)}
      <div style="max-width:360px;margin-left:auto;margin-top:8px">${totalsHtml({ sub: Number(q.subtotal), disc: Number(q.discount), ship: Number(q.shipping), vat: Number(q.vat), total: Number(q.total) }, Number(q.vat_rate))}</div>
      ${q.note ? `<div class="small muted" style="margin-top:10px">หมายเหตุ: ${esc(q.note)}</div>` : ''}
      <div class="small muted" style="margin-top:10px">ใบเสนอราคาไม่ใช่การจองสินค้า · ราคาอาจเปลี่ยนตามฤดูกาล</div></div>`,
    foot: `<div class="left">${statusBadge('quote', q.status)}</div>
      ${ctx.can.sales && ['draft', 'sent'].includes(q.status) ? '<button class="btn" id="edit">แก้ไข</button><button class="btn" data-st="accepted">ลูกค้าตกลง</button><button class="btn" data-st="cancelled">ยกเลิก</button>' : ''}
      <button class="btn primary" onclick="window.print()">พิมพ์ / PDF</button>` });
  const e = $('#edit', m.el); if (e) e.onclick = () => { m.close(); quoteForm(ctx, q); };
  $$('[data-st]', m.el).forEach((b) => (b.onclick = async () => { await ctx.api.rpc('api_quote_status', { id: q.id, status: b.dataset.st }); m.close(); done(ctx, 'อัปเดตสถานะแล้ว'); }));
}

// ---------- ลูกค้า ----------
export function customerForm(ctx, c = null, after = null) {
  const m = openModal({ title: c ? `แก้ไขลูกค้า ${esc(c.name)}` : 'เพิ่มลูกค้า / ช่องทางขาย',
    body: `<div class="form-grid" id="cf">
      ${field('ชื่อลูกค้า', `<input class="input" name="name" value="${esc(c?.name || '')}">`, { req: true })}
      ${field('รหัส', `<input class="input" name="code" value="${esc(c?.code || '')}" placeholder="เว้นว่าง = ออกให้อัตโนมัติ">`)}
      ${field('ช่องทาง', `<select class="input" name="channel">${Object.entries(CHANNEL).map(([k, v]) => `<option value="${k}" ${c?.channel === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`, { hint: 'สาขา/DC/ONLINE/TIKTOK — การโอนภายในกิจการให้ใช้ "โอนไปสาขา" ไม่ใช่ลูกค้า' })}
      ${field('ประเภท', `<select class="input" name="ctype"><option value="company">นิติบุคคล</option><option value="person" ${c?.ctype === 'person' ? 'selected' : ''}>บุคคล</option></select>`)}
      ${field('โทรศัพท์', `<input class="input" name="phone" value="${esc(c?.phone || '')}">`)}
      ${field('เลขผู้เสียภาษี (13 หลัก)', `<input class="input" name="tax_id" value="${esc(c?.tax_id || '')}" inputmode="numeric">`)}
      ${field('สาขาของผู้ซื้อ', `<input class="input" name="branch_no" value="${esc(c?.branch_no || '')}" placeholder="สำนักงานใหญ่ หรือ 00001">`, { hint: 'ใช้พิมพ์ในใบกำกับภาษีเต็มรูป (นิติบุคคล)' })}
      ${field('ที่อยู่ (ออกบิล)', `<textarea class="input" name="address">${esc(c?.address || '')}</textarea>`, { cls: 'span-2' })}
      ${field('หมายเหตุ / ความชอบ', `<textarea class="input" name="note" placeholder="เช่น ชอบ Hass 220+ ห่าม">${esc(c?.note || '')}</textarea>`, { cls: 'span-2' })}
      ${c ? `<label class="check span-2"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> ใช้งานอยู่</label>` : ''}</div>`,
    foot: '<button class="btn primary" id="ok">บันทึก</button>' });
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const res = await ctx.api.rpc('api_customer_save', { id: c?.id, ...formData($('#cf', m.el)) });
    m.close(); await ctx.reloadMe(); done(ctx, 'บันทึกลูกค้าแล้ว'); after && after(res);
  });
}

export async function customerView(ctx, id) {
  const c = await ctx.api.rpc('api_customer_get', { id });
  const m = openModal({ title: esc(c.name), sub: `${esc(CHANNEL[c.channel] || c.channel)} · ${esc(c.phone || '')}`, size: 'lg',
    body: `<div class="split"><div>${c.address ? `<div class="small muted" style="margin-bottom:10px">${esc(c.address)}</div>` : ''}
        <div class="section-title" style="margin-top:0">ประวัติซื้อ</div>
        ${table([{ label: 'วันที่', render: (h) => thDate(h.doc_date) }, { label: 'บิล', key: 'doc_no' }, { label: 'สินค้า', render: (h) => `${esc(h.variety || '')} · ${esc(h.size || '')}` }, { label: 'กก.', right: true, render: (h) => fmtN(h.kg) }, { label: 'ราคา', right: true, render: (h) => fmtMoney(h.price) }, { label: '', render: (h) => (h.status === 'cancelled' ? '<span class="badge b-gray">ยกเลิก</span>' : '') }], c.history, { empty: 'ยังไม่มีประวัติซื้อ', rowAttr: (h) => `class="click" data-inv="${h.invoice_id}"` })}</div>
      <div><div class="section-title" style="margin-top:0">สินค้าที่ซื้อบ่อย</div>
        ${c.favorites.length ? c.favorites.map((f) => `<div class="zone-row"><span>${esc(f.variety)} · ${esc(f.size)}</span><span>${fmtKg(f.kg)}</span></div>`).join('') : '<div class="muted small">—</div>'}
        <div class="section-title">ราคาเฉพาะลูกค้า</div>
        ${c.prices.length ? c.prices.map((p) => `<div class="zone-row"><span>${esc(p.variety)} · ${esc(p.size)}${p.product === 'frozen' ? ' (แช่แข็ง)' : ''}</span><span>${fmtMoney(p.sell_price)}</span></div>`).join('') : '<div class="muted small">ใช้ราคามาตรฐาน</div>'}
        ${c.note ? `<div class="section-title">หมายเหตุ</div><div class="small">${esc(c.note)}</div>` : ''}</div></div>`,
    foot: ctx.can.customers ? '<button class="btn" id="edit">แก้ไขข้อมูล</button>' : '' });
  $$('[data-inv]', m.el).forEach((tr) => (tr.onclick = () => invoiceView(ctx, Number(tr.dataset.inv))));
  const e = $('#edit', m.el); if (e) e.onclick = () => { m.close(); customerForm(ctx, c); };
}

// ---------- ใบลดหนี้ ----------
export async function creditNoteForm(ctx, invoiceId, { return: rt = null } = {}) {
  let i; try { i = await ctx.api.rpc('api_invoice_get', { id: invoiceId }); } catch (e) { toast(e.message, 'err'); return; }
  const pre = {}; // prefill จากใบรับคืน: ส่วนที่คืนและเคยออกบิลแล้ว
  if (rt) { let need = Number(rt.credit_needed_kg || 0);
    rt.lines.forEach((x) => { i.lines.filter((l) => l.dispatch_line_id === x.dispatch_line_id).forEach((l) => { if (need <= 0) return;
      const room = Number(l.kg) - Number(l.credited_kg); const take = Math.min(room, Number(x.kg), need); if (take > 0) { pre[l.id] = (pre[l.id] || 0) + take; need -= take; } }); }); }
  const m = openModal({ title: `ออกใบลดหนี้ · อ้างอิง ${esc(i.doc_no)}`, sub: `${esc(i.customer)} · บิลลงวันที่ ${thDateY(i.doc_date)} · VAT ${fmtN(i.vat_rate)}% ตามบิลเดิม · ไม่เปลี่ยนสต็อก (สต็อกเปลี่ยนที่ใบรับคืน)`, size: 'xl',
    body: `<div class="form-grid g3" id="ch">
        ${field('เหตุผลการลดหนี้', `<input class="input" name="reason" value="${esc(rt?.reason || '')}" placeholder="เช่น สินค้าเสียหาย ลดราคา คืนสินค้า">`, { req: true, cls: 'span-2' })}
        ${field('วันที่', `<input class="input" type="date" name="doc_date" value="${todayISO()}">`)}</div>
      ${rt ? `<div class="notice info">อ้างอิงใบรับคืน ${esc(rt.doc_no)} · ต้องลดหนี้ ${fmtKg(rt.credit_needed_kg)}</div>` : ''}
      <div id="cl">${table([
        { label: 'สินค้า', render: (l) => `${esc(l.variety || '-')} ${esc(l.size || '')}<div class="small muted">Lot ${esc(l.lot_code)}</div>` },
        { label: 'ในบิล', right: true, render: (l) => `${fmtN(l.kg)} กก. × ${fmtMoney(l.price)}` },
        { label: 'ลดหนี้แล้ว', right: true, render: (l) => fmtN(l.credited_kg) },
        { label: 'ลดหนี้ (กก.)', right: true, render: (l) => `<input class="cell" type="number" min="0" max="${Number(l.kg) - Number(l.credited_kg)}" step="0.01" data-kg="${l.id}" value="${pre[l.id] ?? ''}">` },
        { label: 'ราคา/กก.', right: true, render: (l) => `<input class="cell" type="number" min="0" max="${l.price}" step="0.01" data-pr="${l.id}" value="${l.price}" title="ลดบางส่วนของราคาได้ ไม่เกินราคาในบิล">` },
        { label: 'มูลค่า', right: true, render: (l) => `<span data-am="${l.id}"></span>` }], i.lines)}</div>
      <div class="summary-box" id="ct" style="margin-top:12px;max-width:420px;margin-left:auto"></div>`,
    foot: '<button class="btn primary" id="ok">ออกใบลดหนี้</button>' });
  const tot = () => { let sub = 0;
    i.lines.forEach((l) => { const kg = Number($(`[data-kg="${l.id}"]`, m.el).value || 0); const pr = Number($(`[data-pr="${l.id}"]`, m.el).value || 0); const a = Math.round(kg * pr * 100) / 100; sub += a; $(`[data-am="${l.id}"]`, m.el).textContent = a ? fmtMoney(a) : ''; });
    const vat = Math.round(sub * Number(i.vat_rate)) / 100;
    $('#ct', m.el).innerHTML = `<div class="kv"><span>มูลค่าตามบิลเดิม</span><span class="num">${fmtMoney(Number(i.subtotal) - Number(i.discount))}</span></div>
      <div class="kv"><span>ลดหนี้ (ก่อน VAT)</span><span class="num">${fmtMoney(sub)}</span></div><div class="kv"><span>VAT ${fmtN(i.vat_rate)}%</span><span class="num">${fmtMoney(vat)}</span></div>
      <div class="total-line"><span class="strong">รวมลดหนี้</span><span class="v num">${fmtMoney(sub + vat)} บาท</span></div>`; };
  $$('[data-kg],[data-pr]', m.el).forEach((x) => (x.oninput = tot)); tot();
  $('#ok', m.el).onclick = (e) => busy(e.currentTarget, async () => {
    const h = formData($('#ch', m.el));
    const lines = i.lines.map((l) => ({ invoice_line_id: l.id, kg: Number($(`[data-kg="${l.id}"]`, m.el).value || 0), price: Number($(`[data-pr="${l.id}"]`, m.el).value || 0) })).filter((x) => x.kg > 0);
    if (!lines.length) throw new Error('กรอก กก. ที่ลดหนี้อย่างน้อย 1 รายการ');
    const res = await ctx.api.rpc('api_credit_note_create', { invoice_id: i.id, return_id: rt?.id || null, reason: h.reason, doc_date: h.doc_date, lines });
    m.close(); done(ctx, `ออกใบลดหนี้ ${res.doc_no} แล้ว · ${fmtMoney(res.total)} บาท`); creditNoteView(ctx, res.id);
  });
}

export async function creditNoteView(ctx, id) {
  let n; try { n = await ctx.api.rpc('api_credit_note_get', { id }); } catch (e) { toast(e.message, 'err'); return; }
  const co = n.seller || company(ctx); const by = n.buyer || { name: n.customer }; const isTax = n.invoice_type === 'tax_invoice';
  const orig = Number(n.invoice_total) / (1 + Number(n.vat_rate) / 100);
  const m = openModal({ title: `ใบลดหนี้ ${esc(n.doc_no)}`, sub: `อ้างอิง ${esc(n.invoice_no)} · ${esc(n.customer)}`, size: 'lg',
    body: `<div class="card print-area doc-print"><div class="doc-head"><div><h2>${esc(co.name || 'AVO FLOW')}</h2><div class="small muted">${esc(co.address || '')}${co.tax_id ? '<br>เลขประจำตัวผู้เสียภาษี ' + esc(co.tax_id) : ''}${isTax ? ' · ' + esc(branchTxt(co.branch || 'สำนักงานใหญ่')) : ''}</div></div>
        <div class="right"><div class="strong">ใบลดหนี้${isTax ? ' / ใบกำกับภาษี' : ''}</div><div>เลขที่ ${esc(n.doc_no)}</div><div class="small muted">วันที่ ${thDateY(n.doc_date)}</div>${n.status === 'cancelled' ? '<div class="badge b-danger">ยกเลิก</div>' : ''}</div></div>
      <div class="small" style="margin-bottom:10px"><b>ผู้ซื้อ</b> ${esc(by.name)}${by.address ? '<br>' + esc(by.address) : ''}${by.tax_id ? '<br>เลขประจำตัวผู้เสียภาษี ' + esc(by.tax_id) : ''}${by.branch ? ' · ' + esc(branchTxt(by.branch)) : ''}</div>
      <div class="small" style="margin-bottom:10px"><b>อ้างอิง${isTax ? 'ใบกำกับภาษี' : 'บิล'}เลขที่</b> ${esc(n.invoice_no)} ลงวันที่ ${thDateY(n.invoice_date)}${n.return_no ? ` · ใบรับคืน ${esc(n.return_no)}` : ''}<br><b>เหตุผล</b> ${esc(n.reason)}</div>
      ${table([{ label: 'สินค้า', render: (l) => `อะโวคาโด ${esc(l.variety || '-')} ${esc(l.size || '')}<div class="small muted">Lot ${esc(l.lot_code)}</div>` },
        { label: 'จำนวน', render: (l) => fmtKg(l.kg) }, { label: 'ราคา/กก.', render: (l) => fmtMoney(l.price) }, { label: 'จำนวนเงิน', right: true, render: (l) => fmtMoney(l.amount) }], n.lines)}
      <div style="max-width:380px;margin-left:auto;margin-top:8px">
        <div class="kv"><span>มูลค่าตามเอกสารเดิม</span><span class="num">${fmtMoney(orig)}</span></div>
        <div class="kv"><span>มูลค่าที่ถูกต้อง</span><span class="num">${fmtMoney(orig - Number(n.subtotal))}</span></div>
        <div class="kv"><span>ผลต่าง</span><span class="num">${fmtMoney(n.subtotal)}</span></div>
        <div class="kv"><span>VAT ${fmtN(n.vat_rate)}%</span><span class="num">${fmtMoney(n.vat)}</span></div>
        <div class="total-line"><span class="strong">รวมลดหนี้</span><span class="v num">${fmtMoney(n.total)} บาท</span></div></div>
      ${n.cancel_reason ? `<div class="notice" style="margin-top:10px">ยกเลิก: ${esc(n.cancel_reason)}</div>` : ''}
      <div class="sign-row"><div>ผู้รับเอกสาร ................................</div><div>ผู้มีอำนาจลงนาม ................................</div></div></div>`,
    foot: `<div class="left">${n.status === 'issued' && ['admin', 'executive'].includes(ctx.me.role) ? '<button class="btn danger" id="cancel">ยกเลิกใบลดหนี้</button>' : ''}<button class="btn" id="inv">เปิดบิลเดิม</button></div><button class="btn primary" onclick="window.print()">พิมพ์ / บันทึก PDF</button>` });
  $('#inv', m.el).onclick = () => invoiceView(ctx, n.invoice_id);
  const c = $('#cancel', m.el); if (c) c.onclick = async () => {
    const why = await confirmBox('ยกเลิกใบลดหนี้', 'ยอดที่ลดหนี้จะกลับไปเป็นของบิลเดิม', { ok: 'ยกเลิกใบลดหนี้', danger: true, input: { label: 'เหตุผล', required: true } }); if (!why) return;
    try { await ctx.api.rpc('api_credit_note_cancel', { id: n.id, reason: why }); m.close(); done(ctx, 'ยกเลิกใบลดหนี้แล้ว'); } catch (e) { toast(e.message, 'err'); }
  };
}
export { returnView };
