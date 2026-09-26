import { $, $$, esc, thDateTime, table } from './ui.js';
import { assignModal, openTask, onChange } from './docs.js';

const st = { f: 'all' };
const ENT = { receipt: 'รับเข้า', dispatch: 'ตีออก', dispatch_receive: 'รับปลายทาง', case: 'ส่วนต่าง', adjustment: 'อนุมัติ', return: 'รับคืน', credit: 'ลดหนี้', stocktake: 'ตรวจนับ', bill: 'ออกบิล' };

// เวลาที่เหลือก่อนถึงกำหนด (ข้อความสั้น)
const left = (iso) => {
  const ms = new Date(iso) - Date.now(); const h = Math.round(Math.abs(ms) / 3600e3);
  const txt = h >= 48 ? `${Math.round(h / 24)} วัน` : h >= 1 ? `${h} ชม.` : `${Math.max(1, Math.round(Math.abs(ms) / 60e3))} นาที`;
  return ms < 0 ? `เกิน ${txt}` : `อีก ${txt}`;
};

export async function render(el, ctx) {
  onChange(ctx, () => ctx.page === 'tasks' && render(el, ctx));
  const all = await ctx.api.rpc('api_tasks', {});
  const mine = all.filter((t) => t.assignee_id === ctx.me.id); const over = all.filter((t) => t.overdue); const none = all.filter((t) => !t.assignee_id);
  const rows = { all, mine, over, none }[st.f] || all;
  el.innerHTML = `<div class="page-head"><div><h1>คิวงานส่งต่อ</h1><div class="sub">ทุกงานที่ยังไม่จบ: อยู่ที่ใคร ขาดอะไร และต้องเสร็จเมื่อไร · ผู้จัดการมอบหมายผู้รับผิดชอบและกำหนดเสร็จได้</div></div></div>
    <div class="kpis">
      <div class="card kpi click" data-f="all"><div class="label">งานค้างทั้งหมด</div><div class="value num">${all.length}</div><div class="foot">ที่คุณมองเห็น</div></div>
      <div class="card kpi click ${over.length ? 'warn' : ''}" data-f="over"><div class="label">เกินกำหนด</div><div class="value num" style="${over.length ? 'color:var(--danger-ink)' : ''}">${over.length}</div><div class="foot">ต้องตามทันที</div></div>
      <div class="card kpi click" data-f="mine"><div class="label">งานของฉัน</div><div class="value num">${mine.length}</div><div class="foot">มอบหมายให้คุณ</div></div>
      <div class="card kpi click" data-f="none"><div class="label">ยังไม่มีผู้รับผิดชอบ</div><div class="value num">${none.length}</div><div class="foot">ใช้บทบาทตามขั้นตอน</div></div></div>
    <div class="seg">${[['all', 'ทั้งหมด'], ['over', 'เกินกำหนด'], ['mine', 'งานของฉัน'], ['none', 'ยังไม่มอบหมาย']].map(([k, v]) => `<button data-f="${k}" class="${st.f === k ? 'active' : ''}">${v}</button>`).join('')}</div>
    <div class="card">${table([
      { label: 'งาน', render: (t) => `<span class="badge b-gray">${esc(ENT[t.entity] || t.entity)}</span> <b>${esc(t.title)}</b><div class="small muted">${esc(t.doc_no)}${t.site ? ' · ' + esc(t.site) : ''}</div>` },
      { label: 'ขาดอะไร / ต้องทำ', render: (t) => `<span class="small">${esc(t.missing)}</span>${t.assign_note ? `<div class="small" style="color:var(--primary)">📌 ${esc(t.assign_note)}</div>` : ''}` },
      { label: 'อยู่ที่ใคร', render: (t) => (t.assignee ? `<b>${esc(t.assignee)}</b>` : `<span class="muted">${esc(t.who || '—')}</span>`) },
      { label: 'กำหนดเสร็จ', render: (t) => `${thDateTime(t.due_at)}<div class="small" style="color:${t.overdue ? 'var(--danger-ink)' : 'var(--muted)'}">${t.overdue ? '⚠ ' : ''}${left(t.due_at)}</div>` },
      { label: '', render: (t, i) => `<span class="actions" style="justify-content:flex-end;flex-wrap:nowrap"><button class="btn sm" data-open="${i}">เปิด</button>${t.can_assign ? `<button class="btn sm" data-as="${i}">มอบหมาย</button>` : ''}</span>` },
    ], rows, { empty: 'ไม่มีงานค้าง 🎉', rowAttr: (t) => (t.overdue ? 'class="row-danger"' : '') })}</div>
    <div class="foot-note"><b>กำหนดเสร็จเริ่มต้น</b> ตรวจรับ ${esc(ctx.master.settings?.thresholds?.receipt_check_hours ?? 4)} ชม. · ปลายทางรับ ${esc(ctx.master.settings?.thresholds?.receive_deadline_hours ?? 4)} ชม. · งานอนุมัติ/ส่วนต่าง/รับคืน/ตรวจนับ ${esc(ctx.master.settings?.thresholds?.task_due_hours ?? 24)} ชม. · ออกบิล ${esc(ctx.master.settings?.thresholds?.bill_due_hours ?? 48)} ชม. (แก้ได้ที่ ตั้งค่า)</div>`;
  $$('[data-f]', el).forEach((b) => (b.onclick = () => { st.f = b.dataset.f; render(el, ctx); }));
  $$('[data-open]', el).forEach((b) => (b.onclick = () => openTask(ctx, rows[Number(b.dataset.open)])));
  $$('[data-as]', el).forEach((b) => (b.onclick = () => assignModal(ctx, rows[Number(b.dataset.as)], () => render(el, ctx))));
}
