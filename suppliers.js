import { $, $$, esc, fmtN, fmtMoney, thDate, statusBadge, table, openModal } from '../ui.js';
import { supplierForm, receiptView, receiptForm, onChange } from '../docs.js';

export async function render(el, ctx) {
  onChange(ctx, () => ctx.page === 'suppliers' && render(el, ctx));
  const rows = await ctx.api.rpc('api_suppliers', {});
  el.innerHTML = `<div class="page-head"><div><h1>จัดซื้อ / สวน</h1><div class="sub">ข้อมูลสวน ผู้ติดต่อ ราคาซื้อ และประวัติรับเข้า · ใช้เลือกจากข้อมูลกลางเมื่อรับสินค้า</div></div>
    <div class="actions">${ctx.can.receive ? '<button class="btn" id="rc">+ รับเข้าสินค้า</button>' : ''}${ctx.can.suppliers ? '<button class="btn primary" id="add">+ เพิ่มสวน</button>' : ''}</div></div>
    <div class="card">${table([
      { label: 'รหัส', key: 'code' },
      { label: 'ชื่อสวน', render: (s) => `<b>${esc(s.name)}</b>${s.active ? '' : ' <span class="badge b-gray">ปิดใช้งาน</span>'}<div class="small muted">${esc(s.contact || '')}</div>` },
      { label: 'โทรศัพท์', render: (s) => esc(s.phone || '—') }, { label: 'จังหวัด', render: (s) => esc(s.province || '—') },
      { label: 'สายพันธุ์', render: (s) => esc(s.varieties || '—') }, { label: 'ราคาซื้อ/กก.', right: true, render: (s) => (s.buy_price != null ? fmtMoney(s.buy_price) : '—') },
      { label: 'รับแล้ว', right: true, render: (s) => `${fmtN(s.received_kg)} กก.<div class="small muted">${s.receipts} ครั้ง</div>` }, { label: 'รับล่าสุด', render: (s) => thDate(s.last_received) },
    ], rows, { rowAttr: (s) => `class="click" data-id="${s.id}"`, empty: 'ยังไม่มีสวน' })}</div>
    <div class="foot-note"><b>ประเมินสวน</b> กดชื่อสวนเพื่อดูอัตราคัดออก/เน่าเสีย ใช้ตัดสินใจว่าควรซื้อจากสวนไหนต่อ</div>`;
  const a = $('#add', el); if (a) a.onclick = () => supplierForm(ctx);
  const r = $('#rc', el); if (r) r.onclick = () => receiptForm(ctx);
  $$('[data-id]', el).forEach((tr) => (tr.onclick = () => view(ctx, Number(tr.dataset.id))));
}

async function view(ctx, id) {
  const s = await ctx.api.rpc('api_supplier_get', { id });
  const m = openModal({ title: esc(s.name), sub: `${esc(s.contact || '')} ${esc(s.phone || '')} · ${esc(s.province || '')}`, size: 'lg',
    body: `<div class="stat-mini" style="grid-template-columns:repeat(4,minmax(0,1fr));margin-bottom:14px">
      <div><div class="l">รับเข้ารวม</div><div class="v num">${fmtN(s.received_kg)} กก.</div></div><div><div class="l">คัดออกตอนรับ</div><div class="v num">${fmtN(s.rejected_kg)} กก.</div></div>
      <div><div class="l">เน่าเสีย/สูญหายภายหลัง</div><div class="v num">${fmtN(s.waste_kg)} กก.</div></div><div><div class="l">อัตราเสีย</div><div class="v num">${fmtN(s.waste_rate)}%</div></div></div>
      ${table([{ label: 'วันที่', render: (h) => thDate(h.received_at) }, { label: 'เลขที่', key: 'doc_no' }, { label: 'Lot', render: (h) => `<span class="lot">${esc(h.lot)}</span>` },
        { label: 'สินค้า', render: (h) => `${esc(h.variety)} · ${esc(h.size)}` }, { label: 'ตะกร้า', right: true, render: (h) => fmtN(h.baskets) }, { label: 'สุทธิ', right: true, render: (h) => fmtN(h.net_kg) },
        { label: 'คัดออก', right: true, render: (h) => fmtN(h.rejected_kg) }, { label: 'ราคา', right: true, render: (h) => fmtMoney(h.unit_cost) }, { label: '', right: true, render: (h) => statusBadge('receipt', h.status) }],
        s.history, { rowAttr: (h) => `class="click" data-r="${h.receipt_id}"`, empty: 'ยังไม่มีประวัติรับเข้า' })}
      ${s.note ? `<div class="small muted" style="margin-top:10px">หมายเหตุ: ${esc(s.note)}</div>` : ''}`,
    foot: ctx.can.suppliers ? '<button class="btn" id="edit">แก้ไขข้อมูลสวน</button>' : '' });
  $$('[data-r]', m.el).forEach((tr) => (tr.onclick = () => receiptView(ctx, Number(tr.dataset.r))));
  const e = $('#edit', m.el); if (e) e.onclick = () => { m.close(); supplierForm(ctx, s); };
}
