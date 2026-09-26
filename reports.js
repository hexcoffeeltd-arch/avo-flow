import { $, $$, esc, fmtN, fmtMoney, thDate, thDateTime, table, exportExcel, daysAgoISO, todayISO, CHANNEL } from './ui.js';

const KINDS = [
  ['stock', 'สต็อกคงคลัง', 'ยอดปัจจุบันทุกสถานที่ (ไม่ใช้ช่วงวันที่)'],
  ['receipts', 'รับเข้า', 'รับเข้าจากสวนตามช่วงวันที่ · แยกสวน/สายพันธุ์'],
  ['dispatches', 'ตีออก / โอน', 'ตีออก โอนสาขา และส่วนต่างการรับ'],
  ['branch', 'สต็อกสาขา', 'ยอดปัจจุบันเฉพาะสาขา'],
  ['aging', 'สินค้าค้างคลัง', 'เรียงตามอายุ Lot มากไปน้อย'],
  ['sales', 'ยอดขาย', 'จากบิลที่ออกแล้ว · แยกลูกค้า/ช่องทาง/สวน'],
  ['waste', 'สูญเสีย & Shrinkage', 'ตัดทิ้ง สูญหายระหว่างขนส่ง แปรรูป คัดออก น้ำหนักหาย ตรวจนับขาด เคลม · ประเมินสวน'],
  ['shrinkage', 'น้ำหนักหายต่อ Lot', 'จากการชั่งซ้ำระหว่างบ่ม · % หายเทียบน้ำหนักรับเข้า'],
  ['returns', 'รับคืน / เคลม', 'ลูกค้าคืนสินค้าและเคลมเสียหาย · ใบลดหนี้ที่เกี่ยวข้อง'],
  ['movements', 'Stock Card', 'สมุดเคลื่อนไหวทุกรายการพร้อมยอดก่อน-หลัง'],
];
const st = { kind: 'stock', from: daysAgoISO(30), to: todayISO(), group: '' };

export async function render(el, ctx) {
  const kinds = KINDS.filter(([k]) => k !== 'sales' || ctx.can.invoices);
  el.innerHTML = `<div class="page-head"><div><h1>รายงาน</h1><div class="sub">เลือกช่วงวันที่ แยกตามสวน สายพันธุ์ ลูกค้า และช่องทาง · ส่งออก Excel ได้ทุกรายงาน</div></div></div>
    <div class="seg">${kinds.map(([k, v]) => `<button data-k="${k}" class="${st.kind === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="card"><div id="rep"><div class="spinner"></div></div></div>`;
  $$('[data-k]', el).forEach((b) => (b.onclick = () => { st.kind = b.dataset.k; st.group = ''; render(el, ctx); }));
  await load($('#rep', el), ctx);
}

async function load(el, ctx) {
  const r = await ctx.api.rpc('api_report', { kind: st.kind, from: st.from, to: st.to });
  const info = KINDS.find((k) => k[0] === st.kind);
  const dims = r.columns.filter((c) => c.dim);
  const nums = r.columns.filter((c) => (c.type === 'num' || c.type === 'money') && !c.nosum);
  const noDate = ['stock', 'branch', 'aging'].includes(st.kind);
  const val = (c, v) => (v == null ? '—' : c.type === 'money' ? fmtMoney(v) : c.type === 'num' ? fmtN(v) : c.type === 'date' ? thDate(v) : c.type === 'datetime' ? thDateTime(v) : c.key === 'channel' ? esc(CHANNEL[v] || v) : esc(v));
  let cols = r.columns; let rows = r.rows;
  if (st.group) {
    const g = {}; r.rows.forEach((x) => { const k = x[st.group] ?? '—'; g[k] = g[k] || { [st.group]: k, _n: 0 }; g[k]._n++; nums.forEach((c) => { g[k][c.key] = (g[k][c.key] || 0) + Number(x[c.key] || 0); }); });
    rows = Object.values(g).sort((a, b) => (nums[0] ? b[nums[0].key] - a[nums[0].key] : 0));
    cols = [r.columns.find((c) => c.key === st.group), { key: '_n', label: 'จำนวนรายการ', type: 'num' }, ...nums];
    if (st.kind === 'waste' || (st.kind === 'receipts' && nums.some((c) => c.key === 'rejected_kg'))) { /* keep */ }
  }
  const totals = nums.reduce((a, c) => ({ ...a, [c.key]: rows.reduce((s, x) => s + Number(x[c.key] || 0), 0) }), {});
  el.innerHTML = `<div class="card-head"><div><div class="card-title">${esc(info[1])}</div><div class="card-sub">${esc(info[2])}</div></div><span class="small muted">${rows.length} แถว</span></div>
    <div class="toolbar">${noDate ? '' : `<input class="input" type="date" id="f" value="${st.from}" style="width:auto"><input class="input" type="date" id="t" value="${st.to}" style="width:auto">`}
      <select class="input" id="g" style="width:auto"><option value="">แสดงรายละเอียด</option>${dims.map((d) => `<option value="${d.key}" ${st.group === d.key ? 'selected' : ''}>สรุปตาม${esc(d.label)}</option>`).join('')}</select>
      ${noDate ? '' : '<button class="btn" id="go">แสดงรายงาน</button>'}<span class="grow"></span><button class="btn" id="xl">Export Excel</button></div>
    ${table(cols.map((c) => ({ label: esc(c.label), right: c.type === 'num' || c.type === 'money', render: (x) => val(c, x[c.key]) })), rows, {
      empty: 'ไม่มีข้อมูลในช่วงนี้',
      foot: rows.length && nums.length ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.type === 'num' || c.type === 'money' ? 'right num' : ''}">${i === 0 ? 'รวม' : totals[c.key] != null ? val(c, totals[c.key]) : ''}</td>`).join('')}</tr></tfoot>` : '' })}
    ${st.kind === 'waste' && st.group === 'supplier' ? '<div class="foot-note">ดูอัตราเสียเทียบกับยอดรับเข้าของแต่ละสวนได้ที่เมนู จัดซื้อ / สวน</div>' : ''}`;
  const go = $('#go', el); if (go) go.onclick = () => { st.from = $('#f', el).value; st.to = $('#t', el).value; load(el, ctx); };
  $('#g', el).onchange = (e) => { st.group = e.target.value; load(el, ctx); };
  $('#xl', el).onclick = () => exportExcel(`รายงาน-${info[1]}-${noDate ? todayISO() : st.from + '_' + st.to}`, cols.map((c) => ({ ...c, label: c.label })),
    rows.map((x) => Object.fromEntries(cols.map((c) => [c.key, c.type === 'datetime' ? thDateTime(x[c.key]) : c.key === 'channel' ? CHANNEL[x[c.key]] || x[c.key] : x[c.key]]))));
}
