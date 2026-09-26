import { $, $$, esc, fmtN, fmtKg, fmtMoney, thDate, thDateY, thDateTime, statusBadge, CHANNEL, DOC_TYPE, table, daysAgoISO, todayISO, PAGE, moreBtn } from './ui.js';
import { lotTrace, dispatchView, returnView, onChange } from './docs.js';
import { invoiceForm, invoiceView, quoteForm, quoteView, customerForm, customerView, creditNoteView } from './salesdocs.js';

const TABS = [['invoices', 'บิล'], ['billable', 'รอออกบิล'], ['returns', 'รับคืน / เคลม'], ['credit', 'ใบลดหนี้'], ['quotes', 'ใบเสนอราคา'], ['customers', 'ลูกค้า']];
const st = { from: daysAgoISO(30), to: todayISO(), q: '', sel: null };

export async function render(el, ctx, params) {
  const tab = TABS.find((t) => t[0] === params[0]) ? params[0] : 'invoices';
  onChange(ctx, () => ctx.page === 'sales' && render(el, ctx, params));
  const billable = await ctx.api.rpc('api_billable', {});
  el.innerHTML = `<div class="page-head"><div><h1>การขายและบิล</h1><div class="sub">สร้างบิลจากใบตีออกและจำนวนที่ส่งมอบจริง</div></div>
    <div class="actions">${ctx.can.sales ? '<button class="btn" id="qt">ใบเสนอราคา</button><button class="btn primary" id="inv">+ สร้างบิล</button>' : ''}</div></div>
    <div class="tabs">${TABS.map(([k, v]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/sales/${k}">${v}${k === 'billable' && billable.length ? ` <span class="badge-count">${billable.length}</span>` : ''}</a>`).join('')}</div><div id="tab"><div class="spinner"></div></div>`;
  const q = $('#qt', el); if (q) q.onclick = () => quoteForm(ctx);
  const i = $('#inv', el); if (i) i.onclick = () => invoiceForm(ctx);
  const t = $('#tab', el);
  if (tab === 'invoices') await invoicesTab(t, ctx);
  if (tab === 'billable') billableTab(t, ctx, billable);
  if (tab === 'returns') await returnsTab(t, ctx);
  if (tab === 'credit') await creditTab(t, ctx);
  if (tab === 'quotes') await quotesTab(t, ctx);
  if (tab === 'customers') await customersTab(t, ctx);
}

async function invoicesTab(el, ctx, prev = null) {
  const rows = prev || await ctx.api.rpc('api_invoices', { from: st.from, to: st.to, q: st.q || null, doc_type: st.type || null, limit: PAGE });
  const issued = rows.filter((r) => r.status === 'issued');
  const sel = rows.find((r) => r.id === st.sel) || rows[0];
  let preview = '';
  if (sel) {
    const inv = await ctx.api.rpc('api_invoice_get', { id: sel.id });
    const delivered = [...new Map(inv.lines.map((l) => [l.dispatch_line_id, l.delivered_kg])).values()].reduce((a, x) => a + Number(x || 0), 0);
    preview = `<div class="split" style="margin-bottom:14px">
      <div class="card"><div class="card-head"><div><div class="card-title">${inv.status === 'issued' ? 'ใบขาย' : 'ใบขาย (ยกเลิก)'} ${esc(inv.doc_no)}</div><div class="card-sub">อ้างอิงใบตีออก ${esc(inv.dispatches || '-')} · ลูกค้า ${esc(inv.customer)}</div></div>${statusBadge('invoice', inv.status)}</div>
        ${table([{ label: 'สินค้า', render: (l) => `${esc(l.variety)} ${esc(l.size)}` }, { label: 'จำนวน', render: (l) => fmtKg(l.kg) }, { label: 'ราคา/กก.', render: (l) => fmtN(l.price) + ' บาท' }, { label: 'รวม', right: true, render: (l) => fmtMoney(l.amount) + ' บาท' }], inv.lines, { rowAttr: (l) => `class="click" data-lot="${l.lot_id}"` })}
        <div class="total-line"><span class="strong" style="font-size:15px">ยอดรวมสุทธิ</span><span class="v num">${fmtMoney(inv.total)} บาท</span></div>
        <div style="margin-top:12px"><button class="btn sm" id="open-inv">เปิดบิล / พิมพ์</button></div></div>
      <div class="card"><div class="card-title" style="margin-bottom:6px">ข้อมูลบิล</div>
        <div class="kv"><span>ลูกค้า</span><span>${esc(inv.customer)}</span></div><div class="kv"><span>วันที่</span><span>${thDateY(inv.doc_date)}</span></div>
        <div class="kv"><span>ส่งมอบจริง</span><span>${fmtKg(delivered)}</span></div><div class="kv"><span>ออกบิลแล้ว</span><span>${fmtKg(inv.lines.reduce((a, l) => a + Number(l.kg), 0))}</span></div>
        <div class="kv"><span>ค่าขนส่ง</span><span>${fmtMoney(inv.shipping)} บาท</span></div><div class="kv"><span>ส่วนลด / VAT</span><span>${fmtMoney(inv.discount)} / ${fmtN(inv.vat_rate)}%</span></div>
        <div class="kv"><span>กำไรขั้นต้น</span><span>${fmtMoney(inv.gross_profit)} บาท</span></div></div></div>
      <div class="foot-note chain" style="margin:-4px 0 18px"><b>เชื่อมเอกสาร</b> บิล → <a href="javascript:void 0" id="c-d">${esc(inv.lines[0]?.dispatch_no || 'ใบตีออก')}</a> → <a href="javascript:void 0" id="c-l">${esc(inv.lines[0]?.lot_code || 'Lot')}</a> → ${esc(inv.lines[0]?.receipt_no || 'ใบรับเข้า')} → <b>${esc(inv.lines[0]?.supplier || 'สวน')}</b></div>`;
    st._inv = inv;
  }
  el.innerHTML = `${preview}<div class="toolbar"><input class="input" type="date" id="f" value="${st.from}" style="width:auto"><input class="input" type="date" id="t" value="${st.to}" style="width:auto">
      <select class="input" id="ty" style="width:auto"><option value="">ทุกประเภทเอกสาร</option>${Object.entries(DOC_TYPE).map(([k, [t]]) => `<option value="${k}" ${st.type === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input class="input grow" id="q" placeholder="ค้นหาเลขบิลหรือลูกค้า" value="${esc(st.q)}"><button class="btn" id="go">ค้นหา</button></div>
    <div class="card">${table([
      { label: 'เลขที่บิล', render: (r) => `<b>${esc(r.doc_no)}</b><div class="small muted">${esc(DOC_TYPE[r.doc_type]?.[0] || '')}</div>` }, { label: 'วันที่', render: (r) => thDate(r.doc_date) }, { label: 'ลูกค้า', key: 'customer' },
      { label: 'ช่องทาง', render: (r) => esc(CHANNEL[r.channel] || r.channel) }, { label: 'อ้างอิงใบตีออก', render: (r) => `<span class="small">${esc(r.dispatches || '')}</span>` },
      { label: 'ยอดสุทธิ', right: true, render: (r) => `${fmtMoney(r.total)}${Number(r.credited_total) ? `<div class="small" style="color:var(--warn-ink)">ลดหนี้ −${fmtMoney(r.credited_total)}</div>` : ''}` }, { label: 'สถานะ', right: true, render: (r) => statusBadge('invoice', r.status) },
    ], rows, { rowAttr: (r) => `class="click" data-id="${r.id}"`, empty: 'ไม่มีบิลในช่วงนี้',
      foot: issued.length ? `<tfoot><tr><td colspan="5">รวมบิลที่ออก ${issued.length} ใบ</td><td class="right num">${fmtMoney(issued.reduce((a, r) => a + Number(r.total) - Number(r.credited_total || 0), 0))}</td><td></td></tr></tfoot>` : '' })}${moreBtn(rows.length)}</div>`;
  $('#go', el).onclick = () => { st.from = $('#f', el).value; st.to = $('#t', el).value; st.q = $('#q', el).value; st.type = $('#ty', el).value; invoicesTab(el, ctx); };
  const mb = $('[data-more]', el); if (mb) mb.onclick = async () => { const more = await ctx.api.rpc('api_invoices', { from: st.from, to: st.to, q: st.q || null, doc_type: st.type || null, limit: PAGE, offset: rows.length }); invoicesTab(el, ctx, rows.concat(more)); };
  $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => { st.sel = Number(tr.dataset.id); invoicesTab(el, ctx, rows); window.scrollTo(0, 0); }));
  $$('tr[data-lot]', el).forEach((tr) => (tr.onclick = () => lotTrace(ctx, Number(tr.dataset.lot))));
  const o = $('#open-inv', el); if (o) o.onclick = () => invoiceView(ctx, st._inv.id);
  const cd = $('#c-d', el); if (cd) cd.onclick = () => dispatchView(ctx, st._inv.lines[0].dispatch_id);
  const cl = $('#c-l', el); if (cl) cl.onclick = () => lotTrace(ctx, st._inv.lines[0].lot_id);
}

function billableTab(el, ctx, rows) {
  const byCust = {}; rows.forEach((r) => { (byCust[r.customer_id] = byCust[r.customer_id] || { name: r.customer, channel: r.channel, rows: [] }).rows.push(r); });
  el.innerHTML = `<div class="notice info">รายการที่ตีออกขายและลูกค้ายืนยันรับแล้ว แต่ยังออกบิลไม่ครบ · ออกบิลบางส่วนหรือรวมหลายใบตีออกของลูกค้าเดียวกันได้</div>
    ${Object.entries(byCust).map(([cid, c]) => `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">${esc(c.name)}</div><div class="card-sub">${esc(CHANNEL[c.channel] || c.channel)} · รอออกบิล ${fmtKg(c.rows.reduce((a, r) => a + Number(r.billable_kg), 0))}</div></div>
      ${ctx.can.sales ? `<button class="btn primary sm" data-bill="${cid}">สร้างบิล</button>` : ''}</div>
      ${table([{ label: 'ใบตีออก', key: 'dispatch_no' }, { label: 'ส่งมอบ', render: (r) => thDate(r.delivered_at) }, { label: 'Lot', render: (r) => `<span class="lot">${esc(r.lot_code)}</span>` },
        { label: 'สินค้า', render: (r) => `${esc(r.variety)} · ${esc(r.size)}` }, { label: 'ส่ง', right: true, render: (r) => fmtN(r.shipped_kg) }, { label: 'รับจริง', right: true, render: (r) => fmtN(r.received_kg) },
        { label: 'ออกบิลแล้ว', right: true, render: (r) => fmtN(r.billed_kg) }, { label: 'คงเหลือออกบิล', right: true, render: (r) => `<b>${fmtN(r.billable_kg)}</b>` },
        { label: 'ราคาตั้ง', right: true, render: (r) => (r.price != null ? fmtMoney(r.price) : '<span class="badge b-warn">ยังไม่ตั้ง</span>') }], c.rows, { rowAttr: (r) => `class="click" data-d="${r.dispatch_id}"` })}</div>`).join('') || '<div class="card empty">ไม่มีรายการรอออกบิล</div>'}`;
  $$('[data-bill]', el).forEach((b) => (b.onclick = () => invoiceForm(ctx, { customer_id: Number(b.dataset.bill) })));
  $$('tr[data-d]', el).forEach((tr) => (tr.onclick = () => dispatchView(ctx, Number(tr.dataset.d))));
}

async function returnsTab(el, ctx) {
  const rows = await ctx.api.rpc('api_returns', { status: st.rst || null, limit: PAGE });
  el.innerHTML = `<div class="notice info">ลูกค้าคืนสินค้าหรือเคลมของเสียหาย: เปิดจากใบตีออกขายที่ส่งมอบแล้ว → "รับคืน / เคลม" · ต้องแนบรูปและผู้จัดการอนุมัติ · ถ้าของที่คืนเคยออกบิลแล้ว ต้องออกใบลดหนี้</div>
    <div class="seg">${[['', 'ทั้งหมด'], ['pending', 'รออนุมัติ'], ['applied', 'อนุมัติแล้ว'], ['rejected,cancelled', 'ไม่อนุมัติ/ยกเลิก']].map(([k, v]) => `<button data-s="${k}" class="${(st.rst || '') === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="card">${table([{ label: 'เลขที่', render: (r) => `<b>${esc(r.doc_no)}</b>` }, { label: 'วันที่', render: (r) => thDateTime(r.requested_at) }, { label: 'ลูกค้า', key: 'customer' },
      { label: 'ใบตีออก', key: 'dispatch_no' }, { label: 'กก.', right: true, render: (r) => fmtN(r.total_kg) }, { label: 'เหตุผล', render: (r) => `<span class="small">${esc(r.reason)}</span>` },
      { label: 'ลดหนี้', render: (r) => (r.credit_note_no ? esc(r.credit_note_no) : Number(r.credit_needed_kg) > 0 ? '<span class="badge b-warn">ต้องออก</span>' : '—') },
      { label: 'สถานะ', right: true, render: (r) => statusBadge('return', r.status) }], rows, { rowAttr: (r) => `class="click" data-id="${r.id}"`, empty: 'ยังไม่มีการรับคืน/เคลม' })}</div>`;
  $$('[data-s]', el).forEach((b) => (b.onclick = () => { st.rst = b.dataset.s; returnsTab(el, ctx); }));
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => returnView(ctx, Number(tr.dataset.id))));
}

async function creditTab(el, ctx) {
  const rows = await ctx.api.rpc('api_credit_notes', { limit: PAGE });
  el.innerHTML = `<div class="card">${table([{ label: 'เลขที่', render: (n) => `<b>${esc(n.doc_no)}</b>` }, { label: 'วันที่', render: (n) => thDate(n.doc_date) }, { label: 'ลูกค้า', key: 'customer' },
    { label: 'อ้างอิงบิล', key: 'invoice_no' }, { label: 'เหตุผล', render: (n) => `<span class="small">${esc(n.reason)}</span>` }, { label: 'ยอดลดหนี้', right: true, render: (n) => fmtMoney(n.total) },
    { label: 'สถานะ', right: true, render: (n) => statusBadge('credit', n.status) }], rows, { rowAttr: (n) => `class="click" data-id="${n.id}"`, empty: 'ยังไม่มีใบลดหนี้' })}</div>
    <div class="foot-note">ใบลดหนี้ลดยอดขายในรายงาน · ออกจากหน้าบิล ("ออกใบลดหนี้") หรือจากใบรับคืนที่ต้องลดหนี้ · ยกเลิกได้โดยผู้บริหาร</div>`;
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => creditNoteView(ctx, Number(tr.dataset.id))));
}

async function quotesTab(el, ctx) {
  const rows = await ctx.api.rpc('api_quotes', {});
  el.innerHTML = `<div class="card">${table([{ label: 'เลขที่', render: (q) => `<b>${esc(q.doc_no)}</b>` }, { label: 'วันที่', render: (q) => thDate(q.doc_date) }, { label: 'ลูกค้า', key: 'customer' },
    { label: 'ยืนราคาถึง', render: (q) => thDate(q.valid_until) }, { label: 'ยอดสุทธิ', right: true, render: (q) => fmtMoney(q.total) }, { label: 'สถานะ', right: true, render: (q) => statusBadge('quote', q.status) }],
    rows, { rowAttr: (q) => `class="click" data-id="${q.id}"`, empty: 'ยังไม่มีใบเสนอราคา' })}</div><div class="foot-note">ใบเสนอราคาไม่ตัดสต็อกและไม่จองสินค้า</div>`;
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => quoteView(ctx, Number(tr.dataset.id))));
}

async function customersTab(el, ctx) {
  const rows = await ctx.api.rpc('api_customers', {});
  el.innerHTML = `${ctx.can.customers ? '<div class="toolbar"><button class="btn primary" id="add">+ เพิ่มลูกค้า / ช่องทาง</button></div>' : ''}
    <div class="card">${table([{ label: 'รหัส', key: 'code' }, { label: 'ชื่อลูกค้า', render: (c) => `<b>${esc(c.name)}</b>${c.active ? '' : ' <span class="badge b-gray">ปิดใช้งาน</span>'}` },
      { label: 'ช่องทาง', render: (c) => esc(CHANNEL[c.channel] || c.channel) }, { label: 'โทรศัพท์', render: (c) => esc(c.phone || '—') },
      { label: 'บิล', right: true, render: (c) => fmtN(c.invoices) }, { label: 'ยอดซื้อรวม', right: true, render: (c) => fmtMoney(c.sales_total) }, { label: 'ซื้อล่าสุด', render: (c) => thDate(c.last_sale) }],
    rows, { rowAttr: (c) => `class="click" data-id="${c.id}"`, empty: 'ยังไม่มีลูกค้า' })}</div>`;
  const a = $('#add', el); if (a) a.onclick = () => customerForm(ctx);
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => customerView(ctx, Number(tr.dataset.id))));
}
