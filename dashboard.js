import { $, $$, esc, fmtN, fmtMoney, thDate, ripBadge, RIP, RIP_ORDER, RIP_COLOR, ZONE, table } from '../ui.js';
import { lotTrace, receiptForm, approvalsModal, onChange } from '../docs.js';

const watchStatus = (w) => {
  if (w.ripeness === 'overripe') return '<span class="badge b-danger">สุกมาก เร่งระบาย</span>';
  if (w.ripeness === 'ripe') return '<span class="badge b-warn">ใกล้ต้องจ่าย</span>';
  if (w.ripeness === 'breaking') return '<span class="badge b-gray">กำลังติดตาม</span>';
  return '<span class="badge b-ok">พร้อมจ่าย</span>';
};

export async function render(el, ctx) {
  onChange(ctx, () => ctx.page === 'dashboard' && render(el, ctx));
  const d = await ctx.api.rpc('api_dashboard', {});
  const alerts = await ctx.api.rpc('api_alerts', {});
  const low = alerts.filter((a) => a.kind === 'low_stock');
  const lowSet = new Set(low.map((a) => a.detail.split(' เหลือ')[0]));
  const isBranch = ctx.me.role === 'branch';
  let br = null; if (isBranch) br = await ctx.api.rpc('api_branch_stock', { site_id: ctx.me.site_id });
  const pending = d.queue.filter((q) => q.key !== 'to_bill').reduce((a, q) => a + q.count, 0);
  const partial = d.queue.find((q) => q.key === 'partial')?.count || 0;
  const ripTotal = RIP_ORDER.reduce((a, k) => a + Number(d.by_ripeness[k] || 0), 0);
  const zoneKg = (z) => (br?.zones?.[z] || []).reduce((a, r) => a + Number(r.kg), 0);
  const zoneUnits = (z, k) => (br?.zones?.[z] || []).reduce((a, r) => a + Number(r[k]), 0);

  el.innerHTML = `
  <div class="page-head"><div><h1>${isBranch ? esc(ctx.me.site?.name || 'สาขา') : 'ภาพรวมสต็อก'}</h1><div class="sub">เห็นของพร้อมขาย งานรอรับ และ Lot ที่ต้องดูแลในหน้าเดียว</div></div>
    <div class="actions">${isBranch ? '<a class="btn primary" href="#/branches">ไปหน้าสาขา</a>' : `<a class="btn" href="#/warehouse">ดูสต็อก</a>${ctx.can.receive ? '<button class="btn primary" id="new-rc">+ รับเข้าสินค้า</button>' : ''}`}</div></div>

  <div class="kpis">${isBranch ? `
    <div class="card kpi"><div class="label">หน้าร้าน</div><div class="value num">${fmtN(zoneKg('front'))} <small>กก.</small></div><div class="foot">${fmtN(zoneUnits('front', 'baskets'))} ตะกร้า</div></div>
    <div class="card kpi"><div class="label">หลังร้าน</div><div class="value num">${fmtN(zoneKg('back'))} <small>กก.</small></div><div class="foot">${fmtN(zoneUnits('back', 'baskets'))} ตะกร้า</div></div>
    <div class="card kpi"><div class="label">แช่แข็ง</div><div class="value num">${fmtN(zoneUnits('frozen', 'bags'))} <small>ถุง</small></div><div class="foot">${fmtN(zoneKg('frozen'))} กก.</div></div>
    <div class="card kpi ${br.incoming.length ? 'warn' : ''}"><div class="label">รอยืนยันรับ</div><div class="value num">${br.incoming.length} <small>ใบ</small></div><div class="foot">รออนุมัติ ${br.pending_adjustments} รายการ</div></div>`
  : `
    <div class="card kpi"><div class="label">สต็อกในคลัง</div><div class="value num">${fmtN(d.warehouse_kg)} <small>กก.</small></div><div class="foot">พร้อมจ่าย ${fmtN(d.ready_kg)} กก.${low.length ? ` · <span style="color:var(--warn-ink)">ใกล้หมด ${low.length} สายพันธุ์</span>` : ''}</div></div>
    <div class="card kpi"><div class="label">จำนวนตะกร้า</div><div class="value num">${fmtN(d.baskets)} <small>ตะกร้า</small></div><div class="foot">รวมทุกสายพันธุ์ · แช่แข็ง ${fmtN(d.frozen_bags)} ถุง</div></div>
    <div class="card kpi"><div class="label">สต็อกระหว่างทาง</div><div class="value num">${fmtN(d.transit_kg)} <small>กก.</small></div><div class="foot">รอสาขา/ลูกค้ายืนยันรับ</div></div>
    <div class="card kpi ${pending ? 'warn' : ''}"><div class="label">งานรอตรวจสอบ</div><div class="value num">${pending} <small>รายการ</small></div><div class="foot">รับไม่ครบ ${partial} รายการ</div></div>`}
  </div>

  <div class="row-2">
    <div class="card">${isBranch ? `
      <div class="card-head"><div><div class="card-title">สต็อกสาขาตามความสุก</div><div class="card-sub">หน้าร้าน + หลังร้าน · กิโลกรัม</div></div></div>
      <div class="bars">${RIP_ORDER.map((k) => { const kg = ['front', 'back'].reduce((a, z) => a + Number((br.zones[z] || []).find((r) => r.ripeness === k)?.kg || 0), 0); const tot = zoneKg('front') + zoneKg('back');
        return `<div class="bar-row"><span>${RIP[k]}</span><div class="bar-track"><div class="bar-fill" style="width:${tot ? (kg / tot) * 100 : 0}%;background:${RIP_COLOR[k]}"></div></div><span class="right num">${fmtN(kg)}</span></div>`; }).join('')}</div>`
    : `
      <div class="card-head"><div><div class="card-title">สต็อกตามความสุก</div><div class="card-sub">รวมเฉพาะคลัง · กิโลกรัม</div></div><span class="small muted">รวม ${fmtN(ripTotal)} กก.</span></div>
      <div class="bars">${RIP_ORDER.map((k) => `<div class="bar-row"><span>${RIP[k]}</span><div class="bar-track"><div class="bar-fill" style="width:${ripTotal ? (Number(d.by_ripeness[k] || 0) / ripTotal) * 100 : 0}%;background:${RIP_COLOR[k]}"></div></div><span class="right num">${fmtN(d.by_ripeness[k] || 0)}</span></div>`).join('')}</div>`}
      <div class="legend"><span><i></i>ค้นจาก Lot ได้</span><span>อัปเดตจากการตรวจจริง</span></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">งานที่ต้องส่งต่อ</div><a class="link" href="#/alerts">ดูทั้งหมด →</a></div>
      <div class="queue">${d.queue.filter((q) => !(isBranch && ['to_bill', 'pending_receipt', 'draft_dispatch'].includes(q.key))).map((q, i) => `<div class="queue-item ${q.count ? '' : 'zero'}" data-q="${q.key}"><span class="n">${i + 1}</span><div><div class="t">${esc(q.title)}</div><div class="s">${esc(q.sub)}</div></div><span class="c num">${q.count}</span></div>`).join('')}</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">Lot ที่ควรติดตาม</div><div class="card-sub">กดเลข Lot เพื่อดูที่มาและประวัติการส่ง</div></div><a class="link" href="#/${isBranch ? 'branches' : 'warehouse'}">ดูคลัง →</a></div>
    ${table([
      { label: 'Lot', render: (w) => `<span class="lot">${esc(w.lot_code)}</span>` },
      { label: 'สินค้า', render: (w) => `${esc(w.variety || '-')} · ${esc(w.size || '-')}` },
      { label: 'รับเข้า', render: (w) => thDate(w.received_at) },
      { label: 'ที่อยู่', render: (w) => `${esc(w.site)} · ${ZONE[w.zone]}` },
      { label: 'ความสุก', render: (w) => RIP[w.ripeness] },
      { label: 'คงเหลือ', render: (w) => `${fmtN(w.kg)} กก.` },
      { label: 'สถานะ', right: true, render: watchStatus },
    ], d.watch_lots, { rowAttr: (w) => `class="click" data-lot="${w.lot_id}"`, empty: 'ยังไม่มีสต็อก' })}
  </div>

  ${isBranch ? '' : `<div class="row-2">
    <div class="card"><div class="card-head"><div class="card-title">วันนี้</div><span class="small muted">อัปเดตทันทีเมื่อยืนยันรายการ</span></div>
      <div class="stat-mini"><div><div class="l">รับเข้า</div><div class="v num">${fmtN(d.today.in_kg)} กก.</div></div><div><div class="l">ตีออก</div><div class="v num">${fmtN(d.today.out_kg)} กก.</div></div>
        <div><div class="l">ยอดขาย (บิล)</div><div class="v num">${fmtMoney(d.today.sales)}</div></div><div><div class="l">กำไรขั้นต้น</div><div class="v num">${fmtMoney(d.today.gross_profit)}</div></div>
        <div><div class="l">สูญเสีย</div><div class="v num">${fmtN(d.today.waste_kg)} กก.</div></div></div></div>
    <div class="card"><div class="card-head"><div class="card-title">สต็อกแยกสถานที่</div></div>
      ${d.by_site.map((s) => `<div class="zone-row"><span>${esc(s.site)}</span><span class="num">${fmtN(s.kg)} กก. · ${fmtN(s.baskets)} ตะกร้า${s.bags ? ' · ' + fmtN(s.bags) + ' ถุง' : ''}</span></div>`).join('')}
      <div class="section-title">แยกสายพันธุ์ (คลัง)</div>
      ${d.by_variety.map((v) => `<div class="zone-row"><span>${esc(v.variety)}${lowSet.has(v.variety) ? ' <span class="badge b-warn">ใกล้หมด</span>' : ''}</span><span class="num">${fmtN(v.kg)} กก. · ${fmtN(v.baskets)} ตะกร้า</span></div>`).join('') || '<div class="muted small">—</div>'}
      <div class="section-title">แยกไซส์ (คลัง)</div>
      ${d.by_size.map((z) => `<div class="zone-row"><span>${esc(z.size)}</span><span class="num">${fmtN(z.kg)} กก.</span></div>`).join('') || '<div class="muted small">—</div>'}
    </div></div>`}
  <div class="foot-note"><b>กฎสต็อก</b> คลัง → ระหว่างทาง → สาขา · ไม่นับยอดซ้ำ · สต็อกเพิ่มเมื่อยืนยันตรวจรับเท่านั้น</div>`;

  const b = $('#new-rc', el); if (b) b.onclick = () => receiptForm(ctx);
  $$('[data-lot]', el).forEach((tr) => (tr.onclick = () => lotTrace(ctx, Number(tr.dataset.lot))));
  $$('[data-q]', el).forEach((q) => (q.onclick = () => {
    const k = q.dataset.q;
    if (k === 'pending_receipt') ctx.go('warehouse/receipts');
    else if (k === 'draft_dispatch') ctx.go('warehouse/dispatch');
    else if (k === 'in_transit' || k === 'partial') ctx.go(isBranch || !ctx.can.seeWarehouse ? 'branches' : 'warehouse/dispatch');
    else if (k === 'pending_adjust') approvalsModal(ctx);
    else if (k === 'to_bill') ctx.go('sales/billable');
  }));
}
