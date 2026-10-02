import { $, $$, esc, fmtN, fmtKg, thDate, thDateTime, thTime, ripBadge, statusBadge, RIP, RIP_ORDER, ZONE, MTYPE, CHANNEL, table, opt, exportExcel, daysAgoISO, todayISO, PAGE, moreBtn } from './ui.js';
import { lotTrace, askLot, receiptForm, receiptView, dispatchForm, dispatchView, ripenessModal, reweighModal, adjustModal, caseResolve, stocktakeStart, stocktakeView, onChange } from './docs.js';

const TABS = [['stock', 'คงคลัง'], ['receipts', 'รับเข้า'], ['dispatch', 'ตีออก / โอน'], ['ripeness', 'ติดตามความสุก'], ['stocktake', 'ตรวจนับ'], ['history', 'ประวัติเคลื่อนไหว']];
const state = { q: '', f: {}, showFilter: false, sort: 'rip', rstatus: '', dstatus: '', hfrom: daysAgoISO(7), hto: todayISO(), htype: '', hq: '' };

export async function render(el, ctx, params) {
  const tab = TABS.find((t) => t[0] === params[0]) ? params[0] : 'stock';
  if (tab === 'stock' && params[1] === 'neg') { state.f.neg = true; state.f.site_id = 'all'; }   // มาจากแจ้งเตือน "ยอด Lot ติดลบ"
  onChange(ctx, () => ctx.page === 'warehouse' && render(el, ctx, params));
  el.innerHTML = `<div class="page-head"><div><h1>คลังสินค้า</h1><div class="sub">รับเข้า · คงคลัง · ตีออก · ประวัติการเคลื่อนไหว</div></div>
    <div class="actions"><button class="btn" id="chk">ตรวจสอบ Lot</button>${ctx.can.dispatch ? '<button class="btn" id="new-d">ตีออก / โอน</button>' : ''}${ctx.can.receive ? '<button class="btn primary" id="new-r">+ รับเข้าสินค้า</button>' : ''}</div></div>
    <div class="tabs">${TABS.map(([k, v]) => `<a class="tab ${k === tab ? 'active' : ''}" href="#/warehouse/${k}">${v}</a>`).join('')}</div>
    <div id="tab"><div class="spinner"></div></div>`;
  $('#chk', el).onclick = () => askLot(ctx);
  const nr = $('#new-r', el); if (nr) nr.onclick = () => receiptForm(ctx);
  const nd = $('#new-d', el); if (nd) nd.onclick = () => dispatchForm(ctx, {});
  const t = $('#tab', el);
  if (tab === 'stock') await stockTab(t, ctx);
  if (tab === 'receipts') await receiptsTab(t, ctx);
  if (tab === 'dispatch') await dispatchTab(t, ctx);
  if (tab === 'ripeness') await ripenessTab(t, ctx);
  if (tab === 'stocktake') await stocktakeTab(t, ctx);
  if (tab === 'history') await historyTab(t, ctx);
}

// ---------------- คงคลัง ----------------
async function stockTab(el, ctx) {
  const M = ctx.master;
  const [dash, rows] = await Promise.all([ctx.api.rpc('api_dashboard', {}), ctx.api.rpc('api_stock', {})]);
  const whLots = new Set(rows.filter((r) => r.site_kind === 'warehouse').map((r) => r.lot_id)).size;
  const last = rows.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), '');
  const negRows = rows.filter((r) => Number(r.kg) < 0); const negLots = new Set(negRows.map((r) => `${r.site_id}|${r.zone}|${r.lot_id}`)).size;
  if (!negRows.length) state.f.neg = false;
  el.innerHTML = `<div class="kpis k3">
      <div class="card kpi"><div class="label">พร้อมจ่ายในคลัง</div><div class="value num">${fmtN(dash.ready_kg)} กก.</div></div>
      <div class="card kpi"><div class="label">จองเพื่อส่ง</div><div class="value num">${fmtN(dash.reserved_kg)} กก.</div></div>
      <div class="card kpi"><div class="label">Lot ทั้งหมด</div><div class="value num">${whLots} Lot</div></div></div>
    ${negRows.length ? `<div class="notice danger" id="neg-bar">มี <b>${negLots}</b> Lot ที่ยอดติดลบ รวม <b>${fmtN(-negRows.reduce((a, r) => a + Number(r.kg), 0))}</b> กก. (ตีออกเกินยอดที่บันทึกไว้) · เคลียร์โดยกด "ปรับยอด" ตามที่นับได้จริง หรือแก้ใบตีออกให้ตัดจาก Lot ที่ถูกต้อง
      <button class="link" id="neg-only" type="button">${state.f.neg ? 'แสดงสต็อกทั้งหมด' : 'แสดงเฉพาะยอดติดลบ'}</button></div>` : ''}
    <div class="card"><div class="card-head"><div><div class="card-title">สต็อกคงคลัง</div><div class="card-sub">เลือก Lot เพื่อตรวจย้อนกลับถึงสวนและเอกสาร</div></div><span class="small muted">อัปเดตล่าสุด ${last ? thTime(last) : '—'}</span></div>
      <div class="toolbar"><input class="input grow" id="q" placeholder="ค้นหาสายพันธุ์, Lot หรือสวน" value="${esc(state.q)}">
        <select class="input" id="sort" style="width:auto"><option value="rip">เรียง: สุกก่อน</option><option value="date">เรียง: รับเข้าก่อน</option><option value="kg">เรียง: คงเหลือมาก</option><option value="lot">เรียง: เลข Lot</option></select>
        <button class="btn" id="ft">ตัวกรอง</button><button class="btn" id="xl">Export Excel</button></div>
      <div class="filters ${state.showFilter ? '' : 'hidden'}" id="fl">
        <select class="input" data-f="site_id">${opt(M.sites, state.f.site_id, (s) => s.name, (s) => s.id, 'คลังทั้งหมด')}<option value="all" ${state.f.site_id === 'all' ? 'selected' : ''}>ทุกสถานที่ (รวมสาขา)</option></select>
        <select class="input" data-f="zone"><option value="">ทุกจุดจัดเก็บ</option>${['main', 'front', 'back', 'frozen'].map((z) => `<option value="${z}" ${state.f.zone === z ? 'selected' : ''}>${ZONE[z]}</option>`).join('')}</select>
        <select class="input" data-f="variety_id">${opt(M.varieties, state.f.variety_id, (x) => x.name, (x) => x.id, 'ทุกสายพันธุ์')}</select>
        <select class="input" data-f="size_id">${opt(M.sizes, state.f.size_id, (x) => x.name, (x) => x.id, 'ทุกไซส์')}</select>
        <select class="input" data-f="ripeness"><option value="">ทุกความสุก</option>${[...RIP_ORDER, 'na'].map((k) => `<option value="${k}" ${state.f.ripeness === k ? 'selected' : ''}>${RIP[k]}</option>`).join('')}</select>
        <select class="input" data-f="supplier_id">${opt(M.suppliers, state.f.supplier_id, (x) => x.name, (x) => x.id, 'ทุกสวน')}</select>
      </div><div id="tbl"></div></div>
    <div class="foot-note"><b>เมื่อยืนยันรับเข้า</b> เพิ่มสต็อก · บันทึก Lot · เก็บผู้รับและหลักฐาน</div>`;
  $('#sort', el).value = state.sort;
  const filt = () => {
    const q = state.q.toLowerCase(); const f = state.f;
    let r = rows.filter((x) => (f.site_id === 'all' ? true : f.site_id ? x.site_id === Number(f.site_id) : x.site_kind === 'warehouse')
      && (!f.zone || x.zone === f.zone) && (!f.variety_id || x.variety_id === Number(f.variety_id)) && (!f.size_id || x.size_id === Number(f.size_id)) && (!f.ripeness || x.ripeness === f.ripeness)
      && (!f.supplier_id || x.supplier_id === Number(f.supplier_id)) && (!f.neg || Number(x.kg) < 0)
      && (!q || [x.lot_code, x.variety, x.supplier, x.size].some((s) => (s || '').toLowerCase().includes(q))));
    const cmp = { rip: (a, b) => b.rip_rank - a.rip_rank || (a.received_at < b.received_at ? -1 : 1), date: (a, b) => (a.received_at < b.received_at ? -1 : 1), kg: (a, b) => b.kg - a.kg, lot: (a, b) => a.lot_code.localeCompare(b.lot_code) }[state.sort];
    return r.sort(cmp);
  };
  const cols = [
    { label: 'Lot', render: (r) => `<span class="lot">${esc(r.lot_code)}</span>` },
    { label: 'สายพันธุ์ / ไซส์', render: (r) => `${esc(r.variety || '-')} · ${esc(r.size || '-')}` },
    { label: 'ความสุก', render: (r) => ripBadge(r.ripeness) },
    { label: 'สวน', render: (r) => esc(r.supplier || '-') },
    { label: 'รับเข้า', render: (r) => `${thDate(r.received_at)}<div class="small muted">${r.age_days} วัน</div>` },
    { label: 'ที่เก็บ', render: (r) => `${esc(r.site)} · ${ZONE[r.zone]}` },
    { label: 'คงเหลือ', right: true, render: (r) => (Number(r.kg) < 0 ? `<b class="bad">${fmtN(r.kg)} กก.</b><div class="small bad">ติดลบ · รอเคลียร์</div>`
      : `<b>${fmtN(r.kg)} กก.</b><div class="small muted">${r.bags ? fmtN(r.bags) + ' ถุง' : fmtN(r.baskets) + ' ตะกร้า'}${r.est_pieces ? ' · ≈' + fmtN(r.est_pieces) + ' ลูก' : ''}${Number(r.reserved_kg) ? ' · จอง ' + fmtN(r.reserved_kg) : ''}</div>`) },
    { label: '', render: (r) => (!ctx.can.actAt(r.site_id) ? '' : Number(r.kg) < 0 ? `<span class="actions" style="justify-content:flex-end"><button class="btn sm" data-adj="${r.lot_id}|${r.ripeness}|${r.site_id}|${r.zone}|${-Number(r.kg)}">ปรับยอด</button></span>`
      : r.product === 'fresh' ? `<span class="actions" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-rip="${r.lot_id}|${r.ripeness}|${r.site_id}|${r.zone}">ตรวจความสุก</button><button class="btn sm" data-rw="${r.lot_id}|${r.ripeness}|${r.site_id}|${r.zone}">ชั่งซ้ำ</button></span>` : '') },
  ];
  const draw = () => {
    const r = filt();
    $('#tbl', el).innerHTML = table(cols, r, { rowAttr: (x) => `class="click" data-lot="${x.lot_id}"`, empty: 'ไม่พบสต็อกตามเงื่อนไข',
      foot: r.length ? `<tfoot><tr><td colspan="6">รวม ${r.length} รายการ</td><td class="right num">${fmtN(r.reduce((a, x) => a + Number(x.kg), 0))} กก.</td><td></td></tr></tfoot>` : '' });
    $$('[data-lot]', el).forEach((tr) => (tr.onclick = (e) => { if (e.target.closest('button')) return; lotTrace(ctx, Number(tr.dataset.lot)); }));
    $$('[data-rip]', el).forEach((b) => (b.onclick = () => { const [lot_id, ripeness, site_id, zone] = b.dataset.rip.split('|'); ripenessModal(ctx, { site_id: Number(site_id), zone, preset: { lot_id, ripeness } }); }));
    $$('[data-rw]', el).forEach((b) => (b.onclick = () => { const [lot_id, ripeness, site_id, zone] = b.dataset.rw.split('|'); reweighModal(ctx, { site_id: Number(site_id), zone, preset: { lot_id, ripeness } }); }));
    $$('[data-adj]', el).forEach((b) => (b.onclick = () => { const [lot_id, ripeness, site_id, zone, kg] = b.dataset.adj.split('|');
      adjustModal(ctx, Number(site_id), 'count_adjust', { zone, lot_id, ripeness, kg: Number(kg), reason: 'เคลียร์ยอดติดลบ: ' }); }));
  };
  const nb = $('#neg-only', el); if (nb) nb.onclick = () => { state.f.neg = !state.f.neg; if (state.f.neg) state.f.site_id = 'all'; stockTab(el, ctx); };
  $('#q', el).oninput = (e) => { state.q = e.target.value; draw(); };
  $('#sort', el).onchange = (e) => { state.sort = e.target.value; draw(); };
  $('#ft', el).onclick = () => { state.showFilter = !state.showFilter; $('#fl', el).classList.toggle('hidden'); };
  $$('[data-f]', el).forEach((s) => (s.onchange = () => { state.f[s.dataset.f] = s.value; draw(); }));
  $('#xl', el).onclick = () => exportExcel('สต็อกคงคลัง-' + todayISO(), [
    { key: 'lot_code', label: 'Lot' }, { key: 'variety', label: 'สายพันธุ์' }, { key: 'size', label: 'ไซส์' }, { key: 'rip', label: 'ความสุก' }, { key: 'supplier', label: 'สวน' },
    { key: 'received', label: 'วันที่รับเข้า' }, { key: 'age_days', label: 'อายุ (วัน)', type: 'num' }, { key: 'site', label: 'สถานที่' }, { key: 'zonel', label: 'จุดจัดเก็บ' },
    { key: 'kg', label: 'คงเหลือ (กก.)', type: 'num' }, { key: 'baskets', label: 'ตะกร้า', type: 'num' }, { key: 'bags', label: 'ถุง', type: 'num' }, { key: 'est_pieces', label: 'จำนวนลูก (ประมาณ)', type: 'num' }, { key: 'reserved_kg', label: 'จอง (กก.)', type: 'num' },
    ...(ctx.can.seeWarehouse ? [{ key: 'value', label: 'มูลค่าทุน (บาท)', type: 'money' }] : [])],
    filt().map((r) => ({ ...r, rip: RIP[r.ripeness], received: r.received_at.slice(0, 10), zonel: ZONE[r.zone] })));
  draw();
}

// ---------------- รับเข้า ----------------
async function receiptsTab(el, ctx, rows = null) {
  rows = rows || await ctx.api.rpc('api_receipts', { status: state.rstatus || null, limit: PAGE });
  el.innerHTML = `<div class="seg" id="st">${[['', 'ทั้งหมด'], ['pending_check', 'รอตรวจรับ'], ['draft', 'ร่าง'], ['confirmed', 'ยืนยันแล้ว'], ['cancelled', 'ยกเลิก']].map(([k, v]) => `<button data-s="${k}" class="${state.rstatus === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="card">${table([
      { label: 'เลขที่รับเข้า', render: (r) => `<b>${esc(r.doc_no)}</b>` },
      { label: 'วันที่รับ', render: (r) => thDateTime(r.received_at) },
      { label: 'สวน', key: 'supplier' },
      { label: 'Lot', render: (r) => `<span class="small">${esc(r.lots || '')}</span>` },
      { label: 'ตะกร้า', right: true, render: (r) => fmtN(r.total_baskets) },
      { label: 'ชั่งสุทธิ', right: true, render: (r) => fmtN(r.total_net) },
      { label: 'รับจริง', right: true, render: (r) => (r.status === 'confirmed' ? `<b>${fmtN(r.total_accepted)}</b>` : '—') },
      { label: 'สถานะ', right: true, render: (r) => `${r.estimated ? '<span class="badge b-warn">ประมาณ · รอชั่ง</span> ' : ''}${statusBadge('receipt', r.status)}` },
    ], rows, { rowAttr: (r) => `class="click" data-id="${r.id}"`, empty: 'ไม่มีใบรับเข้า' })}${moreBtn(rows.length)}</div>
    <div class="foot-note"><b>ขั้นตอน</b> ร่าง → รอตรวจรับ → ยืนยันรับเข้า · สต็อกเพิ่มตามน้ำหนักที่ตรวจรับจริงเท่านั้น · แยก Lot ทุกรอบรับ</div>`;
  $$('[data-s]', el).forEach((b) => (b.onclick = () => { state.rstatus = b.dataset.s; receiptsTab(el, ctx); }));
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => receiptView(ctx, Number(tr.dataset.id))));
  const mb = $('[data-more]', el); if (mb) mb.onclick = async () => { const more = await ctx.api.rpc('api_receipts', { status: state.rstatus || null, limit: PAGE, offset: rows.length }); receiptsTab(el, ctx, rows.concat(more)); };
}

// ---------------- ตีออก ----------------
async function dispatchTab(el, ctx, prev = null) {
  const [rows, cases] = prev || await Promise.all([ctx.api.rpc('api_dispatches', { status: state.dstatus || null, limit: PAGE }), ctx.api.rpc('api_cases', { status: 'open' })]);
  el.innerHTML = `<div class="seg">${[['', 'ทั้งหมด'], ['draft', 'ร่าง · รอยืนยัน'], ['shipped', 'ส่งแล้ว รอรับ'], ['partial', 'รับบางส่วน'], ['received,closed', 'รับแล้ว'], ['cancelled', 'ยกเลิก']].map(([k, v]) => `<button data-s="${k}" class="${state.dstatus === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    ${cases.length ? `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">งานตรวจสอบส่วนต่าง</div><div class="card-sub">รับไม่ครบ/น้ำหนักต่าง ต้องสรุปว่าเป็นของค้างส่ง ส่งคืน หรือสูญเสีย</div></div><span class="badge b-warn">${cases.length} รายการ</span></div>
      ${table([{ label: 'เลขที่', key: 'doc_no' }, { label: 'ใบส่ง', key: 'dispatch_no' }, { label: 'Lot', render: (c) => `<span class="lot">${esc(c.lot_code)}</span>` }, { label: 'ปลายทาง', key: 'destination' },
        { label: 'ส่ง / รับ', right: true, render: (c) => `${fmtN(c.shipped_kg)} / ${fmtN(c.received_kg)}` }, { label: 'ขาด', right: true, render: (c) => `<b style="color:var(--warn-ink)">${fmtN(c.kg)} กก.</b>` },
        { label: 'ผู้รับผิดชอบ / กำหนด', render: (c) => `${esc(c.assignee || '—')}<div class="small ${new Date(c.due_at) < new Date() ? '' : 'muted'}" style="${new Date(c.due_at) < new Date() ? 'color:var(--danger-ink)' : ''}">${thDateTime(c.due_at)}</div>` },
        { label: '', render: (c) => `<button class="btn sm" data-case="${c.id}">สรุป</button>` }], cases)}</div>` : ''}
    <div class="card">${table([
      { label: 'เลขที่', render: (d) => `<b>${esc(d.doc_no)}</b>` },
      { label: 'วันที่', render: (d) => (d.doc_date ? thDate(d.doc_date) + (d.shipped_at ? `<div class="small muted">ส่ง ${thDateTime(d.shipped_at)}</div>` : '') : thDateTime(d.shipped_at || d.created_at)) },
      { label: 'ประเภท', render: (d) => (d.kind === 'sale' ? `ขาย · ${CHANNEL[d.channel] || ''}` : 'โอนสาขา') },
      { label: 'ต้นทาง', render: (d) => `${esc(d.from_site)} · ${ZONE[d.from_zone]}` },
      { label: 'ปลายทาง', render: (d) => esc(d.destination) },
      { label: 'ส่ง (กก.)', right: true, render: (d) => fmtN(d.total_kg) },
      { label: 'รับจริง', right: true, render: (d) => (d.total_received_kg != null ? fmtN(d.total_received_kg) : '—') },
      { label: 'สถานะ', right: true, render: (d) => statusBadge('dispatch', d.status) },
    ], rows, { rowAttr: (d) => `class="click" data-id="${d.id}"`, empty: 'ไม่มีใบตีออก' })}${moreBtn(rows.length)}</div>
    <div class="foot-note"><b>กฎสต็อก</b> ยืนยันตีออก = ลดคลังและย้ายเป็นระหว่างทาง · ปลายทางรับจริงเท่าไรเพิ่มเท่านั้น · การโอนไปสาขาไม่ถือเป็นยอดขาย</div>`;
  $$('[data-s]', el).forEach((b) => (b.onclick = () => { state.dstatus = b.dataset.s; dispatchTab(el, ctx); }));
  $$('tr[data-id]', el).forEach((tr) => (tr.onclick = () => dispatchView(ctx, Number(tr.dataset.id))));
  $$('[data-case]', el).forEach((b) => (b.onclick = () => { const c = cases.find((x) => x.id === Number(b.dataset.case)); caseResolve(ctx, c, null); }));
  const mb = $('[data-more]', el); if (mb) mb.onclick = async () => { const more = await ctx.api.rpc('api_dispatches', { status: state.dstatus || null, limit: PAGE, offset: rows.length }); dispatchTab(el, ctx, [rows.concat(more), cases]); };
}

// ---------------- ตรวจนับ ----------------
async function stocktakeTab(el, ctx) {
  const rows = await ctx.api.rpc('api_stocktakes', { limit: PAGE });
  el.innerHTML = `<div class="toolbar">${ctx.can.stocktake ? '<button class="btn primary" id="st-new">+ เปิดใบตรวจนับ</button>' : ''}
      <span class="small muted" style="align-self:center">ถ่ายยอดระบบ → นับจริงทีละรายการ → ผู้จัดการอนุมัติ → ปรับยอดทีเดียว (บันทึกเป็นรายการ "ปรับยอดจากตรวจนับ" ในสมุดเคลื่อนไหว)</span></div>
    <div class="card">${table([
      { label: 'เลขที่', render: (t) => `<b>${esc(t.doc_no)}</b>` }, { label: 'สถานที่', render: (t) => `${esc(t.site)} · ${t.zone ? ZONE[t.zone] : 'ทุกจุด'}` },
      { label: 'เปิดเมื่อ', render: (t) => thDateTime(t.created_at) }, { label: 'นับแล้ว', right: true, render: (t) => `${t.counted_count}/${t.line_count}` },
      { label: 'ส่วนต่าง (กก.)', right: true, render: (t) => (t.counted_count ? `<b style="color:${Number(t.diff_kg) < 0 ? 'var(--danger-ink)' : 'inherit'}">${Number(t.diff_kg) > 0 ? '+' : ''}${fmtN(t.diff_kg)}</b>` : '—') },
      { label: 'สถานะ', right: true, render: (t) => statusBadge('stocktake', t.status) }], rows, { rowAttr: (t) => `class="click" data-id="${t.id}"`, empty: 'ยังไม่มีใบตรวจนับ' })}</div>`;
  const n = $('#st-new', el); if (n) n.onclick = () => stocktakeStart(ctx, ctx.me.site_id);
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => stocktakeView(ctx, Number(tr.dataset.id))));
}

// ---------------- ความสุก ----------------
async function ripenessTab(el, ctx) {
  const M = ctx.master;
  const whs = M.sites.filter((s) => s.kind === 'warehouse');
  state.rsite = state.rsite || whs[0]?.id;
  const rows = (await ctx.api.rpc('api_stock', { site_id: state.rsite })).filter((r) => r.product === 'fresh');
  el.innerHTML = `<div class="toolbar"><select class="input" id="rs" style="max-width:260px">${opt(M.sites, state.rsite)}</select>
      <span class="small muted" style="align-self:center">อายุ Lot ใช้ช่วยแจ้งเตือน แต่การเปลี่ยนความสุกต้องอ้างอิงการตรวจจริง · กดที่ Lot เพื่อบันทึกผลตรวจ</span></div>
    <div class="cols-4">${RIP_ORDER.map((k) => { const list = rows.filter((r) => r.ripeness === k); return `<div class="card" style="padding:14px">
      <div class="col-head">${ripBadge(k)}<span class="small muted">${fmtN(list.reduce((a, r) => a + Number(r.kg), 0))} กก.</span></div>
      ${list.map((r) => `<div class="lot-card" data-r="${r.lot_id}|${r.ripeness}|${r.zone}"><div class="top"><span class="lot" style="color:var(--primary);font-weight:700">${esc(r.lot_code)}</span><b>${fmtN(r.kg)} กก.</b></div>
        <div class="meta">${esc(r.variety)} · ${esc(r.size)} · ${ZONE[r.zone]} · อายุ ${r.age_days} วัน</div></div>`).join('') || '<div class="small muted">—</div>'}</div>`; }).join('')}</div>`;
  $('#rs', el).onchange = (e) => { state.rsite = Number(e.target.value); ripenessTab(el, ctx); };
  $$('[data-r]', el).forEach((c) => (c.onclick = () => { const [lot_id, ripeness, zone] = c.dataset.r.split('|');
    if (ctx.can.actAt(state.rsite)) ripenessModal(ctx, { site_id: state.rsite, zone, preset: { lot_id, ripeness } }); else lotTrace(ctx, Number(lot_id)); }));
}

// ---------------- ประวัติ ----------------
async function historyTab(el, ctx, prevRows = null) {
  const rows = prevRows || await ctx.api.rpc('api_movements', { from: state.hfrom, to: state.hto, mtype: state.htype || null, q: state.hq || null, limit: 300 });
  el.innerHTML = `<div class="toolbar"><input class="input" type="date" id="hf" value="${state.hfrom}" style="width:auto"><input class="input" type="date" id="ht" value="${state.hto}" style="width:auto">
      <select class="input" id="hty" style="width:auto"><option value="">ทุกประเภท</option>${Object.entries(MTYPE).map(([k, v]) => `<option value="${k}" ${state.htype === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <input class="input grow" id="hq" placeholder="ค้นหา Lot หรือเลขเอกสาร" value="${esc(state.hq)}"><button class="btn" id="go">ค้นหา</button><button class="btn" id="xl">Export Excel</button></div>
    <div class="card">${table([
      { label: 'เวลาเกิดจริง', render: (m) => thDateTime(m.occurred_at) },
      { label: 'ประเภท', render: (m) => esc(MTYPE[m.mtype] || m.mtype) },
      { label: 'เอกสาร', render: (m) => esc(m.doc_no || '-') },
      { label: 'Lot', render: (m) => `<span class="lot">${esc(m.lot_code)}</span>` },
      { label: 'ที่', render: (m) => `${esc(m.site)} · ${ZONE[m.zone]}` },
      { label: 'ความสุก', render: (m) => RIP[m.ripeness] },
      { label: 'เปลี่ยน (กก.)', right: true, render: (m) => `<b style="color:${m.d_kg < 0 ? 'var(--danger-ink)' : 'var(--ok-ink)'}">${m.d_kg > 0 ? '+' : ''}${fmtN(m.d_kg)}</b>` },
      { label: 'ก่อน → หลัง', right: true, render: (m) => `${fmtN(m.before_kg)} → ${fmtN(m.after_kg)}` },
      { label: 'ผู้ทำ / ผู้อนุมัติ', render: (m) => `${esc(m.actor || '-')}${m.approver && m.approver !== m.actor ? `<div class="small muted">อนุมัติ: ${esc(m.approver)}</div>` : ''}` },
      { label: 'เหตุผล / คู่ค้า', render: (m) => `<span class="small">${esc(m.reason || m.counterparty || '')}</span>` },
    ], rows, { rowAttr: (m) => `class="click" data-lot="${m.lot_id}"`, empty: 'ไม่มีการเคลื่อนไหวในช่วงนี้' })}${moreBtn(rows.length, 300)}</div>
    <div class="foot-note"><b>สมุดเคลื่อนไหว</b> เพิ่มได้อย่างเดียว ห้ามแก้ไข/ลบ · รายการผิดแก้ด้วยการกลับรายการหรือปรับยอดที่อ้างอิงของเดิม</div>`;
  $('#go', el).onclick = () => { state.hfrom = $('#hf', el).value; state.hto = $('#ht', el).value; state.htype = $('#hty', el).value; state.hq = $('#hq', el).value; historyTab(el, ctx); };
  $('#xl', el).onclick = () => exportExcel('ประวัติเคลื่อนไหว-' + state.hfrom + '_' + state.hto, [
    { key: 'time', label: 'เวลาเกิดจริง' }, { key: 'type', label: 'ประเภท' }, { key: 'doc_no', label: 'เอกสาร' }, { key: 'lot_code', label: 'Lot' }, { key: 'site', label: 'สถานที่' }, { key: 'zonel', label: 'จุด' },
    { key: 'rip', label: 'ความสุก' }, { key: 'd_kg', label: 'เปลี่ยน (กก.)', type: 'num' }, { key: 'before_kg', label: 'ก่อน', type: 'num' }, { key: 'after_kg', label: 'หลัง', type: 'num' },
    { key: 'actor', label: 'ผู้ทำ' }, { key: 'approver', label: 'ผู้อนุมัติ' }, { key: 'reason', label: 'เหตุผล' }],
    rows.map((m) => ({ ...m, time: thDateTime(m.occurred_at), type: MTYPE[m.mtype] || m.mtype, zonel: ZONE[m.zone], rip: RIP[m.ripeness] })));
  $$('[data-lot]', el).forEach((tr) => (tr.onclick = () => lotTrace(ctx, Number(tr.dataset.lot))));
  const mb = $('[data-more]', el); if (mb) mb.onclick = async () => { const more = await ctx.api.rpc('api_movements', { from: state.hfrom, to: state.hto, mtype: state.htype || null, q: state.hq || null, limit: 300, offset: rows.length }); historyTab(el, ctx, rows.concat(more)); };
}
