// =====================================================================
// แผนจัดส่ง — ปฏิทินรายเดือนสำหรับผู้จัดส่ง/หัวหน้างาน (รุ่น 2.4)
//  · ลากสาขา/ลูกค้าจากรายการด้านขวาไปวางในวันที่ต้องส่ง (มือถือ: แตะเลือก แล้วแตะวันที่)
//  · ยอดจริงมาจากใบตีออกที่ส่งถึงปลายทางเดียวกันในวันเดียวกัน (จับคู่ให้อัตโนมัติ)
//  · สรุปวันที่เลือก (ค่าเริ่มต้น = วันนี้) · สรุปรายสาขา · สัดส่วน · รายสัปดาห์
// =====================================================================
import { $, $$, esc, fmtN, thDate, toast, busy, openModal, confirmBox, field, opt, formData, statusBadge, CHANNEL } from './ui.js';
import { dispatchForm, dispatchView, onChange } from './docs.js';

const TH_MONTH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_DOW = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];
const TH_DOW_FULL = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
// สีเริ่มต้น 8 สี (ตรวจแล้วว่าแยกกันออก รวมผู้ที่ตาบอดสี) → สีคู่ที่ปรับสำหรับโหมดมืด
const DARK = { '#2a78d6': '#3987e5', '#eb6834': '#d95926', '#1baf7a': '#199e70', '#eda100': '#c98500', '#e87ba4': '#d55181', '#008300': '#008300', '#4a3aa7': '#9085e9', '#e34948': '#e66767' };
const TOP_SEG = 5; // กราฟวงกลม: 5 อันดับแรก + อื่น ๆ
const ST = {
  planned: ['วางแผนแล้ว', 'b-gray', ''], preparing: ['กำลังจัดของ', 'b-warn', '…'], transit: ['กำลังส่ง', 'b-info', '→'],
  done: ['ส่งถึงแล้ว', 'b-ok', '✓'], problem: ['มีปัญหา', 'b-danger', '!'],
};

const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const dow = (iso) => (new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7; // 0 = จันทร์
const monthAdd = (m, n) => { const [y, mo] = m.split('-').map(Number); const t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };
const monthLabel = (m) => `${TH_MONTH[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;
const dayLabel = (iso) => `วัน${TH_DOW_FULL[dow(iso)]}ที่ ${Number(iso.slice(8))} ${TH_MONTH[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(0, 4)) + 543}`;
const colorVars = (c) => `--c:${c};--cd:${DARK[c] || c}`;
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const sum = (arr, f) => r2(arr.reduce((a, x) => a + Number(f(x) || 0), 0));
const kgbk = (kg, bk) => `${fmtN(kg)} กก.${bk ? ` · ${fmtN(bk)} ตะกร้า` : ''}`;
// ชื่อสั้นของปลายทาง: สาขาใช้รหัส (NWW) · ลูกค้าใช้ชื่อ (รหัสลูกค้าออกอัตโนมัติ ไม่มีความหมาย)
export const lab = (d) => (d.kind === 'customer' ? d.name : d.code || d.name);
const full = (d) => (d.kind === 'customer' ? d.name : `${d.code ? d.code + ' · ' : ''}${d.name}`);
const kindTxt = (d) => (d.kind === 'customer' ? `ลูกค้า${d.channel && CHANNEL[d.channel] ? ' · ' + CHANNEL[d.channel] : ''}` : d.name);

// ---------- ส่วนคำนวณ (ไม่แตะหน้าจอ) ----------
// สถานะของปลายทางในวันหนึ่ง: วางแผน → กำลังจัดของ → กำลังส่ง → ส่งถึงแล้ว / มีปัญหา
export function entryStatus(e, today, hours, now = Date.now()) {
  const docs = e.docs || [];
  const s = (key, why = '') => ({ key, label: ST[key][0], why });
  if (docs.some((d) => d.status === 'partial' || Number(d.open_cases) > 0)) return s('problem', 'ปลายทางรับไม่ครบ · รอสรุปส่วนต่าง');
  const late = docs.find((d) => d.status === 'shipped' && d.shipped_at && now - Date.parse(d.shipped_at) > Number(hours || 4) * 3600e3);
  if (late) return s('problem', `ส่งแล้วเกิน ${fmtN(hours)} ชม. ปลายทางยังไม่ยืนยันรับ (${late.doc_no})`);
  if (docs.length && docs.every((d) => ['received', 'closed'].includes(d.status))) return s('done');
  if (docs.some((d) => d.status === 'shipped')) return s('transit');
  if (docs.some((d) => d.status === 'draft')) return e.date < today ? s('problem', 'เลยวันส่งแล้ว ใบตีออกยังเป็นร่าง') : s('preparing');
  if (e.date < today) return s('problem', 'เลยวันส่งตามแผนแล้ว ยังไม่มีใบตีออก');
  return s('planned');
}

// รวมแผนกับใบตีออกเป็นรายการ "ปลายทาง × วัน"
export function buildEntries(data, now = Date.now()) {
  const dests = new Map(data.dests.map((d, i) => [d.id, { ...d, order: i }]));
  const map = new Map(); const key = (date, dest) => `${date}|${dest}`;
  for (const p of data.plans) map.set(key(p.plan_date, p.dest_id), { key: key(p.plan_date, p.dest_id), date: p.plan_date, dest: dests.get(p.dest_id), plan: p, docs: [] });
  for (const d of data.docs) {
    const k = key(d.date, d.dest_id);
    if (!map.has(k)) map.set(k, { key: k, date: d.date, dest: dests.get(d.dest_id), plan: null, docs: [] });
    map.get(k).docs.push(d);
  }
  const out = [...map.values()].filter((e) => e.dest);
  for (const e of out) {
    const shipped = e.docs.filter((d) => d.status !== 'draft');
    e.planKg = e.plan?.planned_kg != null ? Number(e.plan.planned_kg) : 0;
    e.planBk = e.plan?.planned_baskets != null ? Number(e.plan.planned_baskets) : 0;
    e.actKg = sum(shipped, (d) => d.kg); e.actBk = sum(shipped, (d) => d.baskets);
    e.recKg = sum(shipped, (d) => d.received_kg);
    // ยอดที่ "ต้องส่ง" ของรายการ: ตามแผน ถ้าไม่มีแผน (ส่งนอกแผน) ใช้ยอดส่งจริง
    e.dueKg = e.plan ? e.planKg : e.actKg; e.dueBk = e.plan ? e.planBk : e.actBk;
    e.st = entryStatus(e, data.today, data.receive_deadline_hours, now);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.dest.order - b.dest.order);
}

// สรุปทั้งเดือน: รายปลายทาง · สัดส่วน (5 อันดับ + อื่น ๆ) · รายสัปดาห์ (ตามแถวของปฏิทิน)
export function summarize(data, entries, basis = 'plan') {
  const inMonth = entries.filter((e) => e.date >= data.month_start && e.date <= data.month_end);
  const val = (e) => (basis === 'plan' ? (e.plan ? e.planKg : 0) : e.actKg);
  const per = new Map();
  for (const e of inMonth) {
    const g = per.get(e.dest.id) || { dest: e.dest, days: 0, planKg: 0, planBk: 0, actKg: 0, actBk: 0, done: 0, bad: 0, v: 0 };
    if (e.plan) g.days += 1;
    g.planKg = r2(g.planKg + e.planKg); g.planBk += e.planBk; g.actKg = r2(g.actKg + e.actKg); g.actBk += e.actBk;
    if (e.st.key === 'done') g.done += 1; if (e.st.key === 'problem') g.bad += 1; g.v = r2(g.v + val(e));
    per.set(e.dest.id, g);
  }
  const rows = [...per.values()].sort((a, b) => a.dest.order - b.dest.order);
  const total = r2(rows.reduce((a, g) => a + g.v, 0));
  const ranked = rows.filter((g) => g.v > 0).sort((a, b) => b.v - a.v || a.dest.order - b.dest.order);
  const top = ranked.slice(0, ranked.length > TOP_SEG + 1 ? TOP_SEG : TOP_SEG + 1).map((g) => ({ name: lab(g.dest), full: full(g.dest), color: g.dest.color, v: g.v }));
  const rest = ranked.slice(top.length);
  if (rest.length) top.push({ name: `อื่น ๆ (${rest.length})`, full: rest.map((g) => lab(g.dest)).join(', '), color: null, v: r2(rest.reduce((a, g) => a + g.v, 0)) });
  const weeks = [];
  for (let w0 = data.from; w0 <= data.to; w0 = addDays(w0, 7)) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(w0, i)).filter((d) => d >= data.month_start && d <= data.month_end);
    if (!days.length) continue;
    const es = inMonth.filter((e) => e.date >= days[0] && e.date <= days[days.length - 1]);
    weeks.push({ from: days[0], to: days[days.length - 1], v: r2(es.reduce((a, e) => a + val(e), 0)), plan: sum(es, (e) => (e.plan ? e.planKg : 0)), act: sum(es, (e) => e.actKg), n: es.length });
  }
  return { rows, total, donut: top, weeks,
    tot: { days: rows.reduce((a, g) => a + g.days, 0), planKg: sum(rows, (g) => g.planKg), planBk: sum(rows, (g) => g.planBk), actKg: sum(rows, (g) => g.actKg), actBk: sum(rows, (g) => g.actBk) } };
}

// ---------- หน้าจอ ----------
let S = null; // { el, ctx, month, sel, armed, basis, basisSet, data, entries }

export async function render(el, ctx, params = []) {
  const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(params[0] || '') ? params[0] : null;
  S = { el, ctx, month: m, sel: null, wantSel: null, armed: null, basis: 'plan', basisSet: false, data: null, entries: [] };
  const mine = S;
  onChange(ctx, () => { if (ctx.page === 'plan' && S === mine) load(); });
  await load();
}

async function load() {
  const st = S;
  const data = await st.ctx.api.rpc('api_plan_month', st.month ? { month: st.month } : {});
  if (S !== st) return; // ออกจากหน้านี้ไปแล้ว
  const changed = st.data?.month !== data.month; const want = st.wantSel; st.wantSel = null;
  st.data = data; st.month = data.month; st.entries = buildEntries(data);
  if (want && want >= data.from && want <= data.to) st.sel = want;
  else if (changed || !st.sel || st.sel < data.from || st.sel > data.to) st.sel = data.today >= data.from && data.today <= data.to ? data.today : data.month_start;
  if (!st.basisSet) st.basis = data.plans.some((p) => p.plan_date >= data.month_start && p.plan_date <= data.month_end) || !data.docs.length ? 'plan' : 'actual';
  if (st.armed && !data.dests.some((d) => d.id === st.armed && d.active)) st.armed = null;
  draw();
}

function goMonth(m) {
  S.month = m;
  try { history.replaceState(null, '', location.pathname + location.search + '#/plan/' + m); } catch (e) { /* ignore */ }
  load().catch((e) => toast(e.message, 'err'));
}

function draw() {
  const { el, data } = S;
  el.innerHTML = `
  <div class="page-head"><div><h1>แผนจัดส่ง</h1><div class="sub">วางแผนส่งอะโวคาโดให้สาขาและลูกค้า · เทียบกับใบตีออกจริงให้อัตโนมัติ</div></div>
    <div class="plan-bar"><button class="btn sm" data-mon="-1" aria-label="เดือนก่อน">‹</button><div class="mlabel">${esc(monthLabel(data.month))}</div>
      <button class="btn sm" data-mon="1" aria-label="เดือนถัดไป">›</button><button class="btn sm" data-mon="0">เดือนนี้</button></div></div>
  <div id="plan-armed">${armedBar()}</div>
  <div id="plan-kpi">${kpiBlock()}</div>
  <div class="plan-layout">
    <div class="card plan-cal" id="plan-cal">${calendar()}</div>
    <div class="card plan-pal" id="plan-pal">${palette()}</div>
    <div class="card plan-day" id="plan-day">${dayPanel()}</div>
  </div>
  <div id="plan-sum">${summary()}</div>
  <div class="foot-note"><b>วิธีนับยอดจริง</b> ใบตีออกที่ส่งถึงปลายทางเดียวกันใน "วันที่ตีออก" เดียวกับแผน นับเป็นยอดส่งจริงของแผนนั้น · ใบตีออกที่ไม่มีแผนแสดงเป็นกรอบเส้นประ (นอกแผน)
    · ⚠️ มีปัญหา = รับไม่ครบ / ส่งแล้วเกิน ${fmtN(data.receive_deadline_hours)} ชม. ยังไม่ยืนยันรับ / เลยวันส่งแล้วยังไม่ตีออก</div>`;
  bind();
}

function armedBar() {
  const d = S.armed && S.data.dests.find((x) => x.id === S.armed);
  if (!d) return '';
  return `<div class="notice info armed-bar"><span class="swatch pc" style="${colorVars(d.color)}"></span><span>กำลังวางแผนส่ง <b>${esc(lab(d))}</b> — แตะวันที่ในปฏิทินเพื่อเพิ่ม (แตะได้หลายวัน)</span>
    <button class="link" data-disarm>เสร็จแล้ว</button></div>`;
}

function kpiBlock() {
  const { data } = S; const es = S.entries.filter((e) => e.date === S.sel); const isToday = S.sel === data.today;
  const docs = es.reduce((a, e) => a + e.docs.length, 0); const done = es.filter((e) => e.st.key === 'done').length;
  const bad = es.filter((e) => e.st.key === 'problem'); const dests = [...new Set(es.map((e) => lab(e.dest)))];
  const why = [...new Set(bad.map((e) => e.st.why.split(' (')[0]))];
  return `<div class="plan-dayhead"><span>สรุป${isToday ? 'วันนี้' : 'วันที่เลือก'} · <b>${esc(dayLabel(S.sel))}</b></span>${isToday ? '' : '<button class="link" data-today>กลับไปวันนี้</button>'}</div>
  <div class="kpis k6">
    <div class="card kpi"><div class="label">🚚 จัดส่ง</div><div class="value num">${es.length} <small>รายการ</small></div><div class="foot">ใบตีออก ${docs} ใบ${es.some((e) => !e.plan) ? ` · นอกแผน ${es.filter((e) => !e.plan).length}` : ''}</div></div>
    <div class="card kpi"><div class="label">⚖️ น้ำหนักรวม</div><div class="value num">${fmtN(sum(es, (e) => e.dueKg))} <small>กก.</small></div><div class="foot">ส่งออกแล้ว ${fmtN(sum(es, (e) => e.actKg))} กก.</div></div>
    <div class="card kpi"><div class="label">🧺 ตะกร้ารวม</div><div class="value num">${fmtN(sum(es, (e) => e.dueBk))} <small>ตะกร้า</small></div><div class="foot">ส่งออกแล้ว ${fmtN(sum(es, (e) => e.actBk))} ตะกร้า</div></div>
    <div class="card kpi"><div class="label">📍 สาขา</div><div class="value num">${dests.length} <small>แห่ง</small></div><div class="foot" title="${esc(dests.join(', '))}">${esc(dests.slice(0, 4).join(' · ') || 'ไม่มีการส่ง')}${dests.length > 4 ? ' …' : ''}</div></div>
    <div class="card kpi ${done ? 'good' : ''}"><div class="label">✅ เสร็จแล้ว</div><div class="value num">${done} <small>/ ${es.length}</small></div><div class="foot">ปลายทางยืนยันรับครบ</div></div>
    <div class="card kpi ${bad.length ? 'bad click' : ''}" ${bad.length ? 'data-badday' : ''}><div class="label">⚠️ มีปัญหา</div><div class="value num">${bad.length} <small>รายการ</small></div><div class="foot">${esc(why.join(' · ') || 'ไม่มีเรื่องต้องติดตาม')}</div></div>
  </div>`;
}

const stIcon = (st) => `<span class="st-ic st-${st.key}" aria-hidden="true">${ST[st.key][2]}</span>`;
const stBadge = (st) => `<span class="badge ${ST[st.key][1]}">${esc(st.label)}</span>`;
const chipTitle = (e) => `${full(e.dest)} · ${e.plan ? `แผน ${kgbk(e.planKg, e.planBk)}` : 'นอกแผน'} · ส่งจริง ${e.docs.length ? kgbk(e.actKg, e.actBk) : '—'} · ${e.st.label}`;

function calendar() {
  const { data } = S; const can = data.can_edit; const byDay = new Map();
  for (const e of S.entries) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
  const cells = [];
  for (let d = data.from; d <= data.to; d = addDays(d, 1)) {
    const es = byDay.get(d) || []; const out = d < data.month_start || d > data.month_end;
    const tot = sum(es, (e) => e.dueKg); const shown = es.length > 4 ? es.slice(0, 3) : es;
    cells.push(`<div class="cal-cell ${out ? 'out' : ''} ${d === data.today ? 'today' : ''} ${d === S.sel ? 'sel' : ''}" data-day="${d}" tabindex="0" role="gridcell"
      aria-label="${esc(dayLabel(d))} · ${es.length} รายการ"><div class="cal-top"><span class="cal-day">${Number(d.slice(8))}</span>${tot ? `<span class="cal-sum">${fmtN(tot)} กก.</span>` : ''}</div>
      <div class="cal-items">${shown.map((e) => `<button type="button" class="pchip pc ${e.plan ? '' : 'unplanned'} s-${e.st.key}" style="${colorVars(e.dest.color)}" data-entry="${esc(e.key)}"
        ${can && e.plan ? 'draggable="true"' : ''} title="${esc(chipTitle(e))}"><span class="nm">${esc(lab(e.dest))}</span><span class="kg">${e.dueKg ? fmtN(e.dueKg) : '—'}</span>${stIcon(e.st)}</button>`).join('')}
        ${es.length > shown.length ? `<button type="button" class="pchip more" data-more="${d}" title="ดูทั้งหมด ${es.length} รายการ"><span>+${es.length - shown.length}</span></button>` : ''}</div></div>`);
  }
  return `<div class="cal-dow">${TH_DOW.map((x) => `<div>${x}</div>`).join('')}</div>
    <div class="cal-grid" role="grid" aria-label="ปฏิทินแผนจัดส่ง ${esc(monthLabel(data.month))}">${cells.join('')}</div>
    <div class="cal-legend">${['planned', 'preparing', 'transit', 'done', 'problem'].map((k) => `<span>${stIcon({ key: k })}${ST[k][0]}</span>`).join('')}<span><span class="st-ic" style="border:1.5px dashed var(--line-strong)"></span>นอกแผน</span></div>`;
}

function palette() {
  const { data } = S; const can = data.can_edit; const list = data.dests.filter((d) => d.active);
  return `<div class="card-head"><div><div class="card-title">${can ? 'สาขา / ปลายทาง' : 'ปลายทาง'}</div>${can ? '' : '<div class="card-sub">สีประจำปลายทางในปฏิทิน</div>'}</div>
      ${can ? '<button class="btn sm" id="add-dest">+ ปลายทาง</button>' : ''}</div>
    ${can ? '<div class="pal-hint">ลากไปวางในวันที่ต้องส่ง · หรือแตะชื่อแล้วแตะวันที่ (มือถือ)</div>' : ''}
    <div class="pal-list">${list.map((d) => `<div class="pal-item pc ${S.armed === d.id ? 'armed' : ''}" style="${colorVars(d.color)}" data-dest="${d.id}" ${can ? 'draggable="true"' : ''}>
      <span class="swatch">${can ? `<input type="color" value="${esc(d.color)}" data-color="${d.id}" aria-label="เปลี่ยนสี ${esc(d.name)}" title="เปลี่ยนสี">` : ''}</span>
      <button type="button" class="pal-name" ${can ? `data-arm="${d.id}" aria-pressed="${S.armed === d.id}"` : 'tabindex="-1"'}><b>${esc(lab(d))}</b><small>${esc(kindTxt(d))}</small></button>
      ${can ? `<button type="button" class="x" data-rm="${d.id}" aria-label="นำ ${esc(d.name)} ออกจากแผน" title="นำออกจากแผน">×</button>` : ''}</div>`).join('')
      || `<div class="muted small">${can ? 'ยังไม่มีปลายทาง กด + ปลายทาง' : 'ยังไม่มีแผนส่งของสาขานี้'}</div>`}</div>`;
}

function dayPanel() {
  const { data } = S; const can = data.can_edit; const es = S.entries.filter((e) => e.date === S.sel);
  return `<div class="card-head"><div><div class="card-title">${esc(dayLabel(S.sel))}</div><div class="card-sub">${es.length ? `${es.length} ปลายทาง` : 'ยังไม่มีการส่งของ'}</div></div>
      ${can ? '<button class="btn sm" id="add-day">+ เพิ่มแผน</button>' : ''}</div>
    ${es.map((e) => `<div class="day-item pc" style="${colorVars(e.dest.color)}" data-entry="${esc(e.key)}" tabindex="0" role="button">
      <span class="bar"></span><span class="t">${esc(full(e.dest))}</span>${stBadge(e.st)}
      <span class="s">${e.plan ? `แผน ${e.plan.planned_kg != null ? kgbk(e.planKg, e.planBk) : 'ยังไม่ระบุยอด'}` : 'นอกแผน'} · ส่งจริง ${e.docs.length ? kgbk(e.actKg, e.actBk) : '—'}</span></div>`).join('')
      || `<div class="muted small">${can ? 'ลากสาขามาวางในปฏิทิน หรือกด + เพิ่มแผน' : 'วันนี้ไม่มีรายการส่งของ'}</div>`}`;
}

function summary() {
  const { data } = S; const sm = summarize(data, S.entries, S.basis); const bl = S.basis === 'plan' ? 'ตามแผน' : 'ส่งจริง';
  const can = data.can_edit;
  const rows = sm.rows.map((g) => `<tr ${can && g.dest.active ? `class="click" data-sumdest="${g.dest.id}" title="แตะเพื่อวางแผนส่ง ${esc(lab(g.dest))} เพิ่ม"` : ''}><td><span class="dot pc" style="${colorVars(g.dest.color)}"></span><b>${esc(lab(g.dest))}</b>
        <div class="small muted" style="margin-left:17px">${esc(kindTxt(g.dest))}${g.done ? ` · <span style="color:var(--ok-ink)">✓ ส่งถึง ${g.done}</span>` : ''}${g.bad ? ` · <span style="color:var(--danger-ink)">! ปัญหา ${g.bad}</span>` : ''}</div></td>
      <td class="right num">${g.days || '—'}</td><td class="right num">${fmtN(g.planKg)}<div class="small muted">${fmtN(g.planBk)} ตะกร้า</div></td>
      <td class="right num">${fmtN(g.actKg)}<div class="small muted">${fmtN(g.actBk)} ตะกร้า</div></td></tr>`).join('');
  const tbl = `<div class="table-wrap"><table class="tbl sum-dest"><thead><tr><th>ปลายทาง</th><th class="right">วันส่ง</th><th class="right">แผน (กก.)</th><th class="right">ส่งจริง (กก.)</th></tr></thead>
    <tbody>${rows || '<tr><td class="empty" colspan="4">ยังไม่มีแผนหรือการส่งในเดือนนี้</td></tr>'}</tbody>
    ${rows ? `<tfoot><tr><td><b>รวม</b></td><td class="right num">${sm.tot.days}</td><td class="right num"><b>${fmtN(sm.tot.planKg)}</b><div class="small muted">${fmtN(sm.tot.planBk)} ตะกร้า</div></td>
      <td class="right num"><b>${fmtN(sm.tot.actKg)}</b><div class="small muted">${fmtN(sm.tot.actBk)} ตะกร้า</div></td></tr></tfoot>` : ''}</table></div>`;
  return `<div class="plan-sumhead"><h2>สรุปเดือน${esc(monthLabel(data.month))}</h2>
      <div class="seg" id="basis" role="group" aria-label="ยอดที่ใช้ในกราฟ"><button type="button" data-b="plan" class="${S.basis === 'plan' ? 'active' : ''}">ตามแผน</button><button type="button" data-b="actual" class="${S.basis === 'actual' ? 'active' : ''}">ส่งจริง</button></div></div>
    <div class="row-3">
      <div class="card"><div class="card-head"><div><div class="card-title">สรุปยอดจัดส่งรายสาขา</div><div class="card-sub">ส่งให้ใคร · กิโลกรัม / ตะกร้า</div></div></div>${tbl}</div>
      <div class="card"><div class="card-head"><div><div class="card-title">สัดส่วนการจัดส่ง</div><div class="card-sub">ส่งที่ไหนเยอะที่สุด · ${bl}</div></div></div>${donut(sm.donut, sm.total, bl)}</div>
      <div class="card"><div class="card-head"><div><div class="card-title">สรุปยอดรายสัปดาห์</div><div class="card-sub">ช่วงไหนส่งเยอะที่สุด · ${bl} (กก.)</div></div></div>${weeks(sm.weeks)}</div>
    </div>`;
}

function donut(items, total, bl) {
  if (!(total > 0)) return `<div class="muted small" style="padding:36px 0;text-align:center">ยังไม่มียอด${bl}ในเดือนนี้</div>`;
  const R = 70; const W = 22; const C = 2 * Math.PI * R; const gap = items.length > 1 ? 2 : 0; let acc = 0;
  const style = (it) => (it.color ? colorVars(it.color) : '--c:var(--muted);--cd:var(--muted)');
  const segs = items.map((it, i) => {
    const len = (it.v / total) * C; const dash = Math.max(len - gap, 0.5);
    const s = `<circle class="seg pc" data-di="${i}" style="${style(it)};stroke:var(--cc)" cx="95" cy="95" r="${R}" stroke-width="${W}" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" transform="rotate(-90 95 95)"></circle>`;
    acc += len; return s;
  }).join('');
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 190 190" role="img" aria-label="สัดส่วนการจัดส่ง${esc(bl)} รวม ${fmtN(total)} กิโลกรัม">${segs}
      <text class="c1" x="95" y="97" text-anchor="middle">${fmtN(Math.round(total))}</text><text class="c2" x="95" y="116" text-anchor="middle">กก. · ${esc(bl)}</text></svg>
    <div class="donut-legend">${items.map((it, i) => `<div data-di="${i}" tabindex="0"><span class="dot pc" style="${style(it)}"></span><span class="nm" title="${esc(it.full)}">${esc(it.name)}</span>
      <span class="v">${fmtN(it.v)} กก.</span><span class="p">${fmtN(Math.round((it.v / total) * 1000) / 10)}%</span></div>`).join('')}</div></div>`;
}

function weeks(ws) {
  const max = Math.max(0, ...ws.map((w) => w.v));
  return `<div>${ws.map((w, i) => `<div class="wk-row" data-wi="${i}" tabindex="0"><div class="l"><b>สัปดาห์ ${i + 1}</b><span>${esc(w.from === w.to ? thDate(w.from) : `${Number(w.from.slice(8))}–${thDate(w.to)}`)}</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${max ? Math.max((w.v / max) * 100, w.v ? 2 : 0) : 0}%"></div></div><div class="v">${fmtN(w.v)}</div></div>`).join('')}</div>`;
}

// ---------- tooltip (ค่าอยู่บน · ชื่ออยู่ล่าง · ใส่ข้อความด้วย textContent) ----------
function tipEl() { let t = document.querySelector('.plan-tip'); if (!t) { t = document.createElement('div'); t.className = 'plan-tip'; t.hidden = true; document.body.appendChild(t); } return t; }
function showTip(ev, value, lines, color = null) {
  const t = tipEl(); t.replaceChildren(); const b = document.createElement('b'); b.textContent = value; t.appendChild(b);
  lines.forEach((ln, i) => { const s = document.createElement('div'); if (i === 0 && color !== null) { const k = document.createElement('i'); k.className = 'pc'; k.setAttribute('style', color); s.appendChild(k); } s.appendChild(document.createTextNode(ln)); t.appendChild(s); });
  t.hidden = false; moveTip(ev);
}
function moveTip(ev) {
  const t = tipEl(); if (t.hidden) return; const r = ev.target.getBoundingClientRect?.() || { left: 0, top: 0, width: 0 };
  const x = ev.clientX ?? r.left + r.width / 2; const y = ev.clientY ?? r.top;
  t.style.left = Math.min(Math.max(8, x + 12), window.innerWidth - t.offsetWidth - 8) + 'px';
  t.style.top = Math.max(8, y - t.offsetHeight - 10) + 'px';
}
const hideTip = () => { const t = document.querySelector('.plan-tip'); if (t) t.hidden = true; };

// ---------- การกระทำ ----------
function bind() {
  const { el, ctx, data } = S; const can = data.can_edit;
  $$('[data-mon]', el).forEach((b) => (b.onclick = () => goMonth(b.dataset.mon === '0' ? data.today.slice(0, 7) : monthAdd(data.month, Number(b.dataset.mon)))));
  const td = $('[data-today]', el); if (td) td.onclick = () => (data.today >= data.from && data.today <= data.to ? select(data.today) : goMonth(data.today.slice(0, 7)));
  const dis = $('[data-disarm]', el); if (dis) dis.onclick = () => arm(null);
  const bd = $('[data-badday]', el); if (bd) bd.onclick = () => $('#plan-day', el)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // ปฏิทิน: แตะวัน = เลือกวัน (หรือวางปลายทางที่เลือกไว้) · แตะชิป = ดูรายละเอียด
  const grid = $('.cal-grid', el);
  grid.addEventListener('click', (ev) => {
    const more = ev.target.closest('[data-more]'); if (more) { ev.stopPropagation(); select(more.dataset.more); $('#plan-day', el)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const chip = ev.target.closest('[data-entry]'); if (chip) { ev.stopPropagation(); openEntry(chip.dataset.entry); return; }
    const cell = ev.target.closest('.cal-cell'); if (!cell) return;
    if (S.armed) newPlan(cell.dataset.day, S.armed); else select(cell.dataset.day);
  });
  grid.addEventListener('keydown', (ev) => {
    const cell = ev.target.closest('.cal-cell'); if (!cell || ev.target !== cell) return;
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (S.armed) newPlan(cell.dataset.day, S.armed); else select(cell.dataset.day); }
    const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[ev.key];
    if (mv) { ev.preventDefault(); const to = addDays(cell.dataset.day, mv); const n = $(`.cal-cell[data-day="${to}"]`, el); if (n) n.focus(); }
  });

  // ลากวาง (คอมพิวเตอร์): ปลายทาง → วันที่ = เพิ่มแผน · ชิปแผน → วันอื่น = ย้ายแผน
  if (can) {
    $$('.pal-item[draggable]', el).forEach((it) => it.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', 'dest:' + it.dataset.dest); ev.dataTransfer.effectAllowed = 'copy'; }));
    $$('.pchip[draggable]', grid).forEach((ch) => {
      ch.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', 'entry:' + ch.dataset.entry); ev.dataTransfer.effectAllowed = 'move'; ch.classList.add('dragging'); });
      ch.addEventListener('dragend', () => ch.classList.remove('dragging'));
    });
    $$('.cal-cell', grid).forEach((cell) => {
      cell.addEventListener('dragover', (ev) => { ev.preventDefault(); cell.classList.add('drop'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop'));
      cell.addEventListener('drop', (ev) => {
        ev.preventDefault(); cell.classList.remove('drop'); const v = ev.dataTransfer.getData('text/plain') || '';
        if (v.startsWith('dest:')) newPlan(cell.dataset.day, Number(v.slice(5)));
        else if (v.startsWith('entry:')) movePlan(v.slice(6), cell.dataset.day);
      });
    });
  }

  // รายการปลายทาง
  $$('[data-arm]', el).forEach((b) => (b.onclick = () => arm(S.armed === Number(b.dataset.arm) ? null : Number(b.dataset.arm))));
  $$('[data-color]', el).forEach((inp) => inp.addEventListener('change', async () => {
    try { await ctx.api.rpc('api_plan_dest_save', { id: Number(inp.dataset.color), color: inp.value }); toast('เปลี่ยนสีแล้ว', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); }
  }));
  $$('[data-rm]', el).forEach((b) => (b.onclick = async () => {
    const d = data.dests.find((x) => x.id === Number(b.dataset.rm));
    if (!(await confirmBox('นำออกจากแผน', `นำ <b>${esc(d.name)}</b> ออกจากรายการปลายทาง? แผนที่ผ่านมาแล้วยังเก็บไว้ และเพิ่มกลับได้ภายหลัง`, { ok: 'นำออก', danger: true }))) return;
    try { await ctx.api.rpc('api_plan_dest_remove', { id: d.id }); if (S.armed === d.id) S.armed = null; toast(`นำ ${lab(d)} ออกจากแผนแล้ว`, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); }
  }));
  const ad = $('#add-dest', el); if (ad) ad.onclick = () => addDestModal();
  const ay = $('#add-day', el); if (ay) ay.onclick = () => newPlan(S.sel, S.armed);
  $$('#plan-day [data-entry]', el).forEach((it) => { it.onclick = () => openEntry(it.dataset.entry); it.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEntry(it.dataset.entry); } }; });

  bindSummary();
}

function bindSummary() {
  const { el } = S; const sm = summarize(S.data, S.entries, S.basis); const bl = S.basis === 'plan' ? 'ตามแผน' : 'ส่งจริง';
  $$('#basis [data-b]', el).forEach((b) => (b.onclick = () => { S.basis = b.dataset.b; S.basisSet = true; $('#plan-sum', el).innerHTML = summary(); bindSummary(); }));
  $$('[data-sumdest]', el).forEach((tr) => (tr.onclick = () => {
    const id = Number(tr.dataset.sumdest); const d = S.data.dests.find((x) => x.id === id);
    if (S.data.can_edit && d?.active) { arm(id); $('#plan-cal', el)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  }));
  const segs = $$('.donut [data-di]', el); const legs = $$('.donut-legend [data-di]', el);
  const hi = (i, on) => segs.forEach((s) => s.classList.toggle('dim', on && s.dataset.di !== String(i)));
  [...segs, ...legs].forEach((n) => {
    const i = Number(n.dataset.di); const it = sm.donut[i]; if (!it) return;
    const style = it.color ? colorVars(it.color) : '--c:var(--muted);--cd:var(--muted)';
    const enter = (ev) => { hi(i, true); showTip(ev, `${fmtN(it.v)} กก. · ${fmtN(Math.round((it.v / sm.total) * 1000) / 10)}%`, [it.name === it.full ? it.name : `${it.name} — ${it.full}`, bl], style); };
    n.addEventListener('pointerenter', enter); n.addEventListener('pointermove', moveTip); n.addEventListener('focus', enter);
    n.addEventListener('pointerleave', () => { hi(i, false); hideTip(); }); n.addEventListener('blur', () => { hi(i, false); hideTip(); });
  });
  $$('[data-wi]', el).forEach((n) => {
    const w = sm.weeks[Number(n.dataset.wi)]; if (!w) return;
    const enter = (ev) => showTip(ev, `${fmtN(w.v)} กก.`, [`สัปดาห์ ${Number(n.dataset.wi) + 1} · ${w.from === w.to ? thDate(w.from) : `${thDate(w.from)} – ${thDate(w.to)}`}`, `ตามแผน ${fmtN(w.plan)} · ส่งจริง ${fmtN(w.act)} กก. · ${w.n} รายการ`]);
    n.addEventListener('pointerenter', enter); n.addEventListener('pointermove', moveTip); n.addEventListener('focus', enter);
    n.addEventListener('pointerleave', hideTip); n.addEventListener('blur', hideTip);
  });
}

function select(day) {
  S.sel = day; const { el } = S;
  $$('.cal-cell.sel', el).forEach((c) => c.classList.remove('sel'));
  const c = $(`.cal-cell[data-day="${day}"]`, el); if (c) c.classList.add('sel');
  $('#plan-kpi', el).innerHTML = kpiBlock(); $('#plan-day', el).innerHTML = dayPanel(); bind2();
}
// ผูกปุ่มเฉพาะส่วนที่วาดใหม่ตอนเปลี่ยนวัน (ไม่ผูกปฏิทินซ้ำ)
function bind2() {
  const { el } = S;
  const td = $('[data-today]', el); if (td) td.onclick = () => select(S.data.today >= S.data.from && S.data.today <= S.data.to ? S.data.today : S.sel);
  const bd = $('[data-badday]', el); if (bd) bd.onclick = () => $('#plan-day', el)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const ay = $('#add-day', el); if (ay) ay.onclick = () => newPlan(S.sel, S.armed);
  $$('#plan-day [data-entry]', el).forEach((it) => { it.onclick = () => openEntry(it.dataset.entry); it.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEntry(it.dataset.entry); } }; });
}

function arm(id) {
  S.armed = id; const { el } = S;
  $('#plan-armed', el).innerHTML = armedBar();
  $$('.pal-item', el).forEach((it) => { const on = Number(it.dataset.dest) === id; it.classList.toggle('armed', on); const b = $('[data-arm]', it); if (b) b.setAttribute('aria-pressed', String(on)); });
  const dis = $('[data-disarm]', el); if (dis) dis.onclick = () => arm(null);
}

function newPlan(date, destId) {
  const ex = destId ? S.entries.find((e) => e.date === date && e.dest.id === destId) : null;
  if (ex?.plan) return planModal({ date, destId, plan: ex.plan, entry: ex });
  if (ex) return planModal({ date, destId, entry: ex, prefill: { kg: ex.actKg, bk: ex.actBk } });
  return planModal({ date, destId });
}

function openEntry(key) {
  const e = S.entries.find((x) => x.key === key); if (!e) return;
  planModal({ date: e.date, destId: e.dest.id, plan: e.plan, entry: e, prefill: e.plan ? null : { kg: e.actKg, bk: e.actBk } });
}

async function movePlan(key, day) {
  const e = S.entries.find((x) => x.key === key); if (!e?.plan || e.date === day) return;
  if (e.docs.length && !(await confirmBox('ย้ายแผนส่ง', `แผน <b>${esc(e.dest.name)}</b> วันที่ ${esc(thDate(e.date))} จับคู่กับใบตีออกแล้ว ย้ายไปวันอื่นจะไม่นับใบตีออกนั้นเป็นยอดของแผนนี้ ยืนยันย้าย?`, { ok: 'ย้าย' }))) return;
  try {
    const p = e.plan;
    await S.ctx.api.rpc('api_plan_save', { id: p.id, plan_date: day, dest_id: p.dest_id, planned_kg: p.planned_kg, planned_baskets: p.planned_baskets, note: p.note });
    toast(`ย้ายแผน ${lab(e.dest)} ไป ${thDate(day)} แล้ว`, 'ok'); S.wantSel = day; await load();
  } catch (err) { toast(err.message, 'err'); }
}

function planModal({ date, destId = null, plan = null, entry = null, prefill = null }) {
  const { ctx, data } = S; const can = data.can_edit;
  const dests = data.dests.filter((d) => d.active || d.id === destId);
  const d0 = data.dests.find((d) => d.id === destId) || null;
  const kg0 = plan ? plan.planned_kg : prefill ? prefill.kg || '' : d0?.last_kg ?? '';
  const bk0 = plan ? plan.planned_baskets : prefill ? prefill.bk || '' : d0?.last_baskets ?? '';
  const docs = entry?.docs || [];
  const title = plan ? 'แผนส่ง' : entry ? 'ส่งนอกแผน' : 'วางแผนส่ง';
  const sub = `${esc(dayLabel(date))}${d0 ? ` · ${esc(d0.name)}` : ''}`;
  const maxDate = addDays(data.today, 7);
  const canDispatch = can && ctx.can.dispatch && d0?.active && !docs.length && date <= maxDate;
  const docsHtml = docs.length ? `<div class="section-title">ใบตีออกจริง (${docs.length})</div>${docs.map((d) => `<div class="zone-row"><span><button type="button" class="link" data-doc="${d.id}">${esc(d.doc_no)}</button> ${statusBadge('dispatch', d.status)}</span>
      <span class="num" style="text-align:right">${kgbk(d.kg, d.baskets)}${d.received_kg != null ? `<div class="small muted">รับจริง ${fmtN(d.received_kg)} กก.</div>` : ''}</span></div>`).join('')}
      ${plan && plan.planned_kg != null && entry.actKg ? `<div class="small muted" style="margin-top:8px">ส่งจริง ${fmtN(entry.actKg)} จากแผน ${fmtN(entry.planKg)} กก. (${fmtN(Math.round((entry.actKg / entry.planKg) * 100))}%)</div>` : ''}` : '';
  const warn = entry?.st?.why ? `<div class="notice" style="margin-top:12px">⚠️ ${esc(entry.st.why)}</div>` : '';
  const view = `<div class="zone-row"><span>ปลายทาง</span><span>${esc(d0?.name || '-')}</span></div>
    <div class="zone-row"><span>สถานะ</span><span>${entry ? stBadge(entry.st) : '-'}</span></div>
    <div class="zone-row"><span>ตามแผน</span><span class="num">${plan ? (plan.planned_kg != null ? kgbk(plan.planned_kg, plan.planned_baskets) : 'ยังไม่ระบุยอด') : 'ไม่มีแผน (ส่งนอกแผน)'}</span></div>
    ${plan?.note ? `<div class="zone-row"><span>หมายเหตุ</span><span>${esc(plan.note)}</span></div>` : ''}
    ${plan?.updated_by_name ? `<div class="small muted" style="margin-top:6px">บันทึกโดย ${esc(plan.updated_by_name)}</div>` : ''}`;
  const form = `<form id="pf" class="form-grid" onsubmit="return false">
      ${field('ปลายทาง', `<select class="input" name="dest_id">${opt(dests, destId, (d) => (d.kind === 'customer' ? `${d.name} (ลูกค้า)` : full(d)), (d) => d.id, '— เลือกสาขา / ลูกค้า —')}</select>`, { req: true, cls: 'span-all' })}
      ${field('วันที่ส่ง', `<input class="input" type="date" name="plan_date" value="${esc(date)}">`, { req: true, cls: 'span-all' })}
      ${field('น้ำหนักตามแผน (กก.)', `<input class="input" type="number" name="planned_kg" min="0" step="0.01" inputmode="decimal" value="${esc(kg0 ?? '')}" placeholder="เว้นว่างได้">`)}
      ${field('จำนวนตะกร้า', `<input class="input" type="number" name="planned_baskets" min="0" step="1" inputmode="numeric" value="${esc(bk0 ?? '')}">`)}
      ${field('หมายเหตุ', `<input class="input" name="note" value="${esc(plan?.note || '')}" placeholder="เช่น รอบเช้า · รถคันเล็ก">`, { cls: 'span-all' })}
    </form>${!plan && !prefill && d0?.last_kg != null ? '<div class="small muted">เติมยอดจากแผนล่าสุดของปลายทางนี้ให้แล้ว แก้ได้</div>' : ''}${prefill && !plan ? '<div class="small muted">เติมยอดจากใบตีออกจริงให้แล้ว · กด "เพิ่มในแผน" เพื่อบันทึกเป็นแผน</div>' : ''}`;
  const m = openModal({ title, sub, size: 'sm', body: (can ? form : view) + docsHtml + warn,
    foot: `${can && plan ? '<button class="btn danger" id="pdel" style="margin-right:auto">ลบแผน</button>' : ''}
      ${canDispatch ? `<button class="btn" id="pmk" title="เปิดใบตีออกพร้อมปลายทาง/วันที่/ยอดตามแผน">สร้างใบตีออก</button>` : ''}
      ${can ? `<button class="btn primary" id="psave">${plan ? 'บันทึก' : 'เพิ่มในแผน'}</button>` : '<button class="btn" id="pclose">ปิด</button>'}` });
  $$('[data-doc]', m.el).forEach((b) => (b.onclick = () => { m.close(); dispatchView(ctx, Number(b.dataset.doc)); }));
  const cl = $('#pclose', m.el); if (cl) cl.onclick = () => m.close();
  const sel = $('[name=dest_id]', m.el);
  if (sel && !plan) sel.onchange = () => { // เปลี่ยนปลายทาง → เติมยอดล่าสุดของปลายทางนั้น (ถ้ายังไม่ได้กรอก)
    const d = data.dests.find((x) => x.id === Number(sel.value)); const kgI = $('[name=planned_kg]', m.el); const bkI = $('[name=planned_baskets]', m.el);
    if (d && !kgI.dataset.touched) { kgI.value = d.last_kg ?? ''; bkI.value = d.last_baskets ?? ''; }
  };
  $$('[name=planned_kg], [name=planned_baskets]', m.el).forEach((i) => i.addEventListener('input', () => { i.dataset.touched = '1'; }));
  const sv = $('#psave', m.el);
  if (sv) sv.onclick = (ev) => busy(ev.currentTarget, async () => {
    const f = formData($('#pf', m.el));
    if (!f.dest_id) throw new Error('กรุณาเลือกปลายทาง');
    if (!f.plan_date) throw new Error('กรุณาเลือกวันที่ส่ง');
    await ctx.api.rpc('api_plan_save', { id: plan?.id, dest_id: Number(f.dest_id), plan_date: f.plan_date, planned_kg: f.planned_kg, planned_baskets: f.planned_baskets, note: f.note });
    m.close(); const d = data.dests.find((x) => x.id === Number(f.dest_id));
    toast(`${plan ? 'บันทึกแผน' : 'เพิ่มแผนส่ง'} ${d ? lab(d) : ''} · ${thDate(f.plan_date)} แล้ว`, 'ok');
    S.wantSel = f.plan_date;
    if (f.plan_date < data.from || f.plan_date > data.to) goMonth(f.plan_date.slice(0, 7)); else await load();
  });
  const dl = $('#pdel', m.el);
  if (dl) dl.onclick = async () => {
    if (!(await confirmBox('ลบแผนส่ง', `ลบแผนส่ง <b>${esc(d0?.name || '')}</b> วันที่ ${esc(thDate(date))}? (ใบตีออกจริงไม่ถูกลบ)`, { ok: 'ลบแผน', danger: true }))) return;
    try { await ctx.api.rpc('api_plan_delete', { id: plan.id }); m.close(); toast('ลบแผนส่งแล้ว', 'ok'); await load(); } catch (e) { toast(e.message, 'err'); }
  };
  const mk = $('#pmk', m.el);
  if (mk) mk.onclick = () => {
    const f = can ? formData($('#pf', m.el)) : {}; m.close();
    dispatchForm(ctx, { kind: d0.kind === 'customer' ? 'sale' : 'transfer', to_site_id: d0.site_id, customer_id: d0.customer_id,
      doc_date: f.plan_date && f.plan_date <= maxDate ? f.plan_date : date, need: f.planned_kg || plan?.planned_kg || null });
  };
}

function addDestModal() {
  const { ctx, data } = S; const M = ctx.master;
  const onSites = new Set(data.dests.filter((d) => d.active && d.site_id).map((d) => d.site_id));
  const onCust = new Set(data.dests.filter((d) => d.active && d.customer_id).map((d) => d.customer_id));
  let kind = 'site';
  const m = openModal({ title: 'เพิ่มปลายทางในแผน', sub: 'เลือกสาขา หรือลูกค้าที่ส่งของให้เป็นประจำ', size: 'sm',
    body: `<div class="seg" id="dk"><button type="button" data-k="site" class="active">สาขา</button><button type="button" data-k="customer">ลูกค้า</button></div><div id="dsel"></div>`,
    foot: '<button class="btn primary" id="dok">เพิ่มในแผน</button>' });
  const draw = () => {
    $$('#dk button', m.el).forEach((b) => b.classList.toggle('active', b.dataset.k === kind));
    const list = kind === 'site' ? M.sites.filter((s) => s.kind === 'branch' && s.active && !onSites.has(s.id)) : M.customers.filter((c) => c.active && !onCust.has(c.id));
    $('#dsel', m.el).innerHTML = field(kind === 'site' ? 'สาขา' : 'ลูกค้า', `<select class="input" id="dpick">${opt(list, '', (x) => (kind === 'site' && x.code ? `${x.code} · ${x.name}` : x.name), (x) => x.id, list.length ? '— เลือก —' : 'ไม่มีรายการที่ยังไม่อยู่ในแผน')}</select>`,
      { req: true, hint: kind === 'site' ? (ctx.can.settings ? '<a class="link" href="#/settings/master">+ สร้างสาขาใหม่ที่ ตั้งค่า</a>' : 'สาขาใหม่ให้ Admin เพิ่มที่ ตั้งค่า') : (ctx.can.addCustomer ? '<button type="button" class="link" id="newcust">+ เพิ่มลูกค้าใหม่</button>' : '') });
    const al = $('#dsel a.link', m.el); if (al) al.onclick = () => m.close();
    const nc = $('#newcust', m.el);
    if (nc) nc.onclick = async () => (await import('./salesdocs.js')).customerForm(ctx, null, async (c) => {
      try { await ctx.api.rpc('api_plan_dest_save', { customer_id: c.id }); m.close(); toast(`เพิ่ม ${c.name} ในแผนแล้ว`, 'ok'); await load(); } catch (e) { toast(e.message, 'err'); }
    });
  };
  $$('#dk button', m.el).forEach((b) => (b.onclick = () => { kind = b.dataset.k; draw(); }));
  $('#dok', m.el).onclick = (ev) => busy(ev.currentTarget, async () => {
    const v = Number($('#dpick', m.el)?.value || 0); if (!v) throw new Error(kind === 'site' ? 'กรุณาเลือกสาขา' : 'กรุณาเลือกลูกค้า');
    const d = await ctx.api.rpc('api_plan_dest_save', kind === 'site' ? { site_id: v } : { customer_id: v });
    m.close(); toast(`เพิ่ม ${lab(d)} ในแผนแล้ว · ลากไปวางในวันที่ต้องส่งได้เลย`, 'ok'); await load();
  });
  draw();
}
