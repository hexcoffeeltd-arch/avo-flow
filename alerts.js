import { $$, esc, table } from './ui.js';
import { lotTrace, dispatchView, receiptView, approvalsModal, returnView, stocktakeView, openTask, onChange } from './docs.js';

const LV = { danger: ['b-danger', 'ด่วน'], warn: ['b-warn', 'ควรจัดการ'], info: ['b-info', 'ติดตาม'] };

export async function render(el, ctx) {
  onChange(ctx, () => ctx.page === 'alerts' && render(el, ctx));
  const a = await ctx.api.rpc('api_alerts', {});
  const order = { danger: 0, warn: 1, info: 2 };
  a.sort((x, y) => order[x.level] - order[y.level]);
  const t = ctx.master.settings?.thresholds || {};
  el.innerHTML = `<div class="page-head"><div><h1>แจ้งเตือนและงานรอตรวจ</h1><div class="sub">สต็อกต่ำ ใกล้สุก สุกมาก ค้างคลัง น้ำหนักไม่ตรง และรายการรอรับ/รอตรวจสอบ · กดรายการเพื่อจัดการ</div></div>
    ${ctx.can.settings ? '<div class="actions"><a class="btn" href="#/settings/general">ตั้งเกณฑ์แจ้งเตือน</a></div>' : ''}</div>
    <div class="card">${table([
      { label: 'ระดับ', render: (x) => `<span class="badge ${LV[x.level][0]}">${LV[x.level][1]}</span>` },
      { label: 'เรื่อง', render: (x) => `<b>${esc(x.title)}</b>` },
      { label: 'รายละเอียด', render: (x) => esc(x.detail) },
      { label: '', right: true, render: () => '<span class="link">เปิด →</span>' },
    ], a, { rowAttr: (x, i) => `class="click" data-i="${i}"`, empty: 'ไม่มีแจ้งเตือน 🎉' })}</div>
    <div class="foot-note"><b>เกณฑ์ปัจจุบัน</b> สต็อกต่ำ &lt; ${esc(t.low_stock_kg ?? 200)} กก. · ใกล้สุกเมื่ออายุ ${esc(t.near_ripe_days ?? 5)} วัน · ค้างคลัง ${esc(t.aging_days ?? 7)} วัน · ยืนยันรับภายใน ${esc(t.receive_deadline_hours ?? 4)} ชม. · น้ำหนักต่าง &gt; ${esc(t.weight_variance_pct ?? 5)}% · งานทั่วไปกำหนดเสร็จ ${esc(t.task_due_hours ?? 24)} ชม.</div>`;
  $$('tr[data-i]', el).forEach((tr) => (tr.onclick = () => {
    const x = a[Number(tr.dataset.i)];
    if (x.dispatch_id) dispatchView(ctx, x.dispatch_id);
    else if (x.receipt_id) receiptView(ctx, x.receipt_id);
    else if (x.adjustment_id) approvalsModal(ctx);
    else if (x.return_id) returnView(ctx, x.return_id);
    else if (x.stocktake_id) stocktakeView(ctx, x.stocktake_id);
    else if (x.task_entity) openTask(ctx, { entity: x.task_entity, entity_id: x.task_id });
    else if (x.lot_id) lotTrace(ctx, x.lot_id);
    else if (x.kind === 'low_stock') ctx.go('warehouse');
  }));
}
