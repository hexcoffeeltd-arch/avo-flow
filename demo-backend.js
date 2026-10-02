// =====================================================================
// AVO FLOW — Demo backend (ทำงานในเบราว์เซอร์ ไม่ต้องมีฐานข้อมูล)
// จำลองฟังก์ชัน public.api_* ของ PostgreSQL ด้วยกฎธุรกิจชุดเดียวกัน
// ใช้สำหรับทดลองระบบเท่านั้น — ระบบจริงใช้ SQL ในโฟลเดอร์ sql/
// ทุกคำสั่งทำงานแบบ all-or-nothing (ถ้าผิดพลาดจะย้อนข้อมูลกลับ)
// =====================================================================

const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (p, k) => { if (p == null || p[k] === undefined || p[k] === null || p[k] === '') return null; const v = Number(p[k]); return Number.isFinite(v) ? v : null; };
const int = (p, k) => { const v = num(p, k); return v == null ? null : Math.round(v); };
const txt = (p, k) => (p == null || p[k] == null || String(p[k]).trim() === '' ? null : String(p[k]).trim());
const bool = (p, k, d) => (p == null || p[k] == null ? d : p[k] === true || p[k] === 'true');
const RIP = ['raw', 'breaking', 'ripe', 'overripe'];
const RIP_LABEL = { raw: 'ดิบ', breaking: 'ห่าม', ripe: 'สุก', overripe: 'สุกมาก', na: 'แช่แข็ง' };
const RIP_RANK = { overripe: 4, ripe: 3, breaking: 2, raw: 1, na: 0 };
const ZONE_LABEL = { main: 'คลัง', front: 'หน้าร้าน', back: 'หลังร้าน', frozen: 'แช่แข็ง', transit: 'ระหว่างทาง' };
const ripL = (r) => RIP_LABEL[r] || r;
const zoneL = (z) => ZONE_LABEL[z] || z;

class ApiError extends Error {}
const fail = (m) => { throw new ApiError(m); };

// เวลาไทย
const bkkDate = (d) => {
  const t = new Date(new Date(d).getTime() + 7 * 3600e3);
  return t.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(a + 'T00:00:00Z') - new Date(b + 'T00:00:00Z')) / 86400e3);
const nowIso = () => new Date().toISOString();

export function createDemoBackend(storageKey = 'avoflow-demo-v1') {
  let db = null;
  let claims = null;

  const empty = () => ({
    seq: {}, sites: [], users: [], varieties: [], sizes: [], prices: [], settings: {}, suppliers: [], customers: [],
    counters: {}, attachments: [], receipts: [], receipt_lines: [], lots: [], balances: [], movements: [],
    dispatches: [], dispatch_lines: [], cases: [], internal_transfers: [], freezes: [], adjustments: [],
    ripeness_checks: [], quotes: [], quote_lines: [], invoices: [], invoice_lines: [], audit_log: [],
    returns: [], return_lines: [], credit_notes: [], credit_note_lines: [], stocktakes: [], stocktake_lines: [],
    assignments: [], client_requests: [], notify_log: [], purchase_orders: [], po_lines: [], purchase_budgets: [],
    plan_dests: [], delivery_plans: [],
  });

  const nextId = (t) => (db.seq[t] = (db.seq[t] || 0) + 1);
  const ins = (t, row) => { const r = { id: nextId(t), ...row }; db[t].push(r); return r; };
  const byId = (t, id) => (id == null ? undefined : db[t].find((r) => r.id === Number(id)));
  const nextNo = (prefix) => {
    const d = new Date(Date.now() + 7 * 3600e3);
    const per = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0');
    const k = prefix + '|' + per;
    db.counters[k] = (db.counters[k] || 0) + 1;
    return `${prefix}-${per}-${String(db.counters[k]).padStart(3, '0')}`;
  };
  const setting = (k) => db.settings[k]?.value || {};
  const threshold = (k, d) => (setting('thresholds')[k] != null ? Number(setting('thresholds')[k]) : d);
  const audit = (actor, action, entity, id, data) => ins('audit_log', { at: nowIso(), actor_id: actor, action, entity, entity_id: String(id ?? ''), data: data ?? null });
  const uname = (id) => byId('users', id)?.display_name ?? null;
  const site = (id) => byId('sites', id);

  // ---------- ผู้ใช้/สิทธิ์ ----------
  function cur() {
    if (!claims?.sub) fail('กรุณาเข้าสู่ระบบ');
    const u = db.users.find((x) => x.auth_sub === claims.sub);
    if (!u) fail('ยังไม่พบบัญชีผู้ใช้ กรุณาโหลดหน้าใหม่');
    if (!u.active) fail('บัญชีนี้ถูกปิดการใช้งาน');
    if (u.role === 'pending') fail('บัญชีรอผู้ดูแลระบบกำหนดสิทธิ์');
    return u;
  }
  const need = (u, roles) => { if (u.role !== 'admin' && !roles.includes(u.role)) fail(`ไม่มีสิทธิ์ทำรายการนี้ (บทบาท: ${u.role})`); };
  const canSee = (u, sid) => ['admin', 'executive', 'sales', 'warehouse'].includes(u.role) || (u.role === 'branch' && u.site_id === sid);
  const canAct = (u, sid) => {
    if (u.role === 'admin') return true;
    if (u.role === 'warehouse') return (u.site_id == null && site(sid)?.kind === 'warehouse') || u.site_id === sid;
    if (u.role === 'branch') return u.site_id === sid;
    return false;
  };
  const needSite = (u, sid) => { if (!canAct(u, sid)) fail('ไม่มีสิทธิ์ทำรายการของสถานที่นี้'); };
  const isApprover = (u, sid) => ['admin', 'executive'].includes(u.role) || (u.is_manager && canAct(u, sid));
  // ผู้ใช้สาขาไม่เห็นต้นทุน/มูลค่า
  const COST_KEYS = ['unit_cost', 'value', 'cost', 'cost_total', 'gross_profit'];
  const stripCost = (j) => (Array.isArray(j) ? j.map(stripCost) : j && typeof j === 'object'
    ? Object.fromEntries(Object.entries(j).filter(([k]) => !COST_KEYS.includes(k)).map(([k, v]) => [k, stripCost(v)])) : j);
  const nocost = (u, j) => (u.role === 'branch' ? stripCost(j) : j);
  const userOut = (u) => { const { auth_sub, ...rest } = u; return rest; };
  const checkZone = (sid, z) => { const k = site(sid)?.kind; if (!k) fail('ไม่พบสถานที่');
    if ((k === 'warehouse' && !['main', 'frozen'].includes(z)) || (k === 'branch' && !['front', 'back', 'frozen'].includes(z))) fail(`จุดจัดเก็บ "${zoneL(z)}" ใช้กับสถานที่นี้ไม่ได้`); };
  // รุ่น 2.5: ใบตีออกร่างจองยอดระดับ Lot (รวมทุกความสุก) — รายการที่ลดยอด Lot ต้องไม่กินยอดที่ใบร่างจองไว้ · ยอดของช่องความสุกนั้นพอหรือไม่ move() เป็นผู้ตรวจ
  const needFree = (sid, z, l, r, kg) => { if (!(kg > 0)) return; const tot = lotTotal(sid, z, l); const lres = lotReserved(sid, z, l);
    const docs = [...new Set(db.dispatch_lines.filter((dl) => { const d = byId('dispatches', dl.dispatch_id); return d.status === 'draft' && d.from_site_id === sid && d.from_zone === z && dl.lot_id === l; })
      .map((dl) => byId('dispatches', dl.dispatch_id).doc_no))].sort();
    if (R2(tot - lres) < kg) fail(`สต็อกว่างไม่พอ: Lot นี้คงเหลือรวม ${fmt(tot)} กก. ถูกจองในใบตีออกร่าง ${fmt(lres)} กก.${docs.length ? ' (' + docs.join(', ') + ')' : ''} ใช้ได้ ${fmt(Math.max(tot - lres, 0))} กก.`); };
  const company = (u) => need(u, ['warehouse', 'sales', 'executive']);
  const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  // ---------- ยอดคงเหลือ + สมุดเคลื่อนไหว ----------
  const bal = (s, z, l, r) => db.balances.find((b) => b.site_id === s && b.zone === z && b.lot_id === l && b.ripeness === r);
  // ยอดติดลบ (รุ่น 2.5): ปกติห้ามลดจนติดลบ · ยกเว้นตอนยืนยันตีออกเมื่อเปิด "ตีออกเกินยอดได้" (G.allowNeg) · ระหว่างทางห้ามติดลบเสมอ
  //   มีของเข้า (+) แล้ว Lot เดียวกันที่จุดเดียวกันมีความสุกอื่นติดลบ → หักกลบให้อัตโนมัติ (ปิดได้ด้วย G.noNet)
  const G = { allowNeg: false, noNet: false };
  function move(s, z, l, r, dkg, dbask, dbag, mtype, docType, docId, docNo, actor, reason = null, evidence = null, approver = null, counterparty = null, occurred = null) {
    dkg = R2(dkg || 0); dbask = dbask || 0; dbag = dbag || 0;
    if (Number.isNaN(dkg)) fail('น้ำหนักไม่ถูกต้อง');
    if (!dkg && !dbask && !dbag) return { id: null, d_baskets: 0, d_bags: 0 };
    let b = bal(s, z, l, r);
    if (!b) { b = { site_id: s, zone: z, lot_id: l, ripeness: r, kg: 0, baskets: 0, bags: 0, updated_at: nowIso() }; db.balances.push(b); }
    const negOk = z !== 'transit' && G.allowNeg;
    const nk = R2(b.kg + dkg);
    const lcode = byId('lots', l)?.code;
    if (nk < 0 && dkg < 0 && !negOk) fail(`สต็อกไม่พอ: ${lcode} (${zoneL(z)} · ${ripL(r)}) คงเหลือ ${fmt(b.kg)} กก. แต่ต้องการ ${fmt(-dkg)} กก.`);
    let nb = b.baskets + dbask;
    if (nb < 0 || (nk <= 0 && dkg < 0)) nb = 0;
    let ng = b.bags + dbag;
    if (ng < 0) { if (negOk && nk < 0) ng = 0; else fail(`จำนวนถุงไม่พอ: ${lcode} คงเหลือ ${b.bags} ถุง แต่ต้องการ ${-dbag} ถุง`); }
    if (nk <= 0 && dkg < 0) ng = 0;
    const m = ins('movements', {
      mtype, doc_type: docType, doc_id: docId, doc_no: docNo, lot_id: l, site_id: s, zone: z, ripeness: r,
      d_kg: dkg, d_baskets: nb - b.baskets, d_bags: ng - b.bags, before_kg: b.kg, after_kg: nk,
      before_baskets: b.baskets, after_baskets: nb, before_bags: b.bags, after_bags: ng,
      occurred_at: occurred || nowIso(), recorded_at: nowIso(), actor_id: actor, approver_id: approver,
      counterparty, reason, evidence,
    });
    const out = { id: m.id, d_baskets: nb - b.baskets, d_bags: ng - b.bags };
    Object.assign(b, { kg: nk, baskets: nb, bags: ng, updated_at: nowIso() });
    if (dkg > 0 && nk > 0 && z !== 'transit' && docType !== 'NET' && !G.noNet) netLot(s, z, l, actor, docId, docNo, approver, occurred);
    return out;
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // หักกลบภายใน Lot ที่จุดเดียว: ความสุกที่ติดลบ ← ดึงจากความสุกที่ยังเป็นบวก (ใกล้กันก่อน)
  function netLot(s, z, l, actor, docId, docNo, approver = null, occurred = null) {
    if (z === 'transit') return;
    const rows = () => db.balances.filter((b) => b.site_id === s && b.zone === z && b.lot_id === l).map((b) => ({ ripeness: b.ripeness, kg: b.kg }));
    for (const neg of rows().filter((b) => b.kg < 0).sort((a, b) => a.kg - b.kg || cmp(a.ripeness, b.ripeness))) {
      let need_ = -neg.kg;
      const dist = (x) => Math.abs(RIP_RANK[x.ripeness] - RIP_RANK[neg.ripeness]);
      for (const pos of rows().filter((b) => b.kg > 0).sort((a, b) => dist(a) - dist(b) || RIP_RANK[a.ripeness] - RIP_RANK[b.ripeness])) {
        if (need_ <= 0) break;
        const x = Math.min(need_, pos.kg); const why = `หักกลบยอดติดลบอัตโนมัติ: ${ripL(pos.ripeness)} → ${ripL(neg.ripeness)}`;
        move(s, z, l, pos.ripeness, -x, 0, 0, 'RIPEN_OUT', 'NET', docId, docNo, actor, why, null, approver, null, occurred);
        move(s, z, l, neg.ripeness, x, 0, 0, 'RIPEN_IN', 'NET', docId, docNo, actor, why, null, approver, null, occurred);
        need_ = R2(need_ - x);
      }
      if (need_ > 0) break;
    }
  }
  const lotTotal = (s, z, l) => R2(db.balances.filter((b) => b.site_id === s && b.zone === z && b.lot_id === l).reduce((a, b) => a + b.kg, 0));
  const lotReserved = (s, z, l, exclude = null) => R2(db.dispatch_lines.filter((dl) => { const d = byId('dispatches', dl.dispatch_id);
    return d.status === 'draft' && d.from_site_id === s && d.from_zone === z && dl.lot_id === l && d.id !== exclude; }).reduce((a, dl) => a + dl.kg, 0));
  const lotFree = (s, z, l, exclude = null) => R2(lotTotal(s, z, l) - lotReserved(s, z, l, exclude));
  // ตั้งค่า options.allow_negative_dispatch: ไม่ได้ตั้ง = อนุญาต · false = ห้ามจ่ายเกินยอดพร้อมใช้
  const allowNegative = () => { const v = setting('options').allow_negative_dispatch; return v == null ? true : v === true || v === 'true'; };
  const fmt = (n) => String(R2(n));
  const R1 = (n) => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
  const sizeAvg = (id) => { const z = byId('sizes', id); if (!z) return null;
    if (z.min_g != null && z.max_g != null) return R1((z.min_g + z.max_g) / 2); if (z.min_g != null) return R1(z.min_g * 1.1); if (z.max_g != null) return R1(z.max_g * 0.9); return null; };
  const lim = (p, d = 200) => Math.min(Math.max(int(p, 'limit') ?? d, 1), 1000);
  const off = (p) => Math.max(int(p, 'offset') ?? 0, 0);
  const page = (rows, p, d = 200) => rows.slice(off(p), off(p) + lim(p, d));
  const addH = (iso, h) => new Date(new Date(iso).getTime() + h * 3600e3).toISOString();
  const taxOk = (t) => /^[0-9]{13}$/.test(String(t ?? '').replace(/[^0-9]/g, '')) && t != null;
  const sysUser = () => ({ id: 0, role: 'executive', is_manager: true, active: true, display_name: 'ระบบ', site_id: null });

  // ---------- JSON builders (รูปแบบเดียวกับ SQL) ----------
  const masterJson = () => ({
    varieties: [...db.varieties].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    sizes: [...db.sizes].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    sites: [...db.sites].sort((a, b) => (a.kind === b.kind ? a.sort - b.sort || a.name.localeCompare(b.name) : a.kind === 'warehouse' ? -1 : 1)),
    suppliers: db.suppliers.map((x) => ({ id: x.id, code: x.code, name: x.name, active: x.active, buy_price: x.buy_price })).sort((a, b) => a.name.localeCompare(b.name)),
    customers: db.customers.map((c) => ({ id: c.id, code: c.code, name: c.name, channel: c.channel, active: c.active })).sort((a, b) => a.name.localeCompare(b.name)),
    settings: Object.fromEntries(Object.entries(db.settings).map(([k, v]) => [k, v.value])),
  });
  const lotJson = (id) => {
    const l = byId('lots', id); if (!l) return null;
    return { id: l.id, code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, variety_id: l.variety_id,
      size: byId('sizes', l.size_id)?.name ?? null, size_id: l.size_id, supplier: byId('suppliers', l.supplier_id)?.name ?? null,
      supplier_id: l.supplier_id, received_at: l.received_at, unit_cost: l.unit_cost, status: l.status, parent_lot_id: l.parent_lot_id ?? null, avg_g: l.avg_g ?? null };
  };
  const receiptJson = (id) => {
    const r = byId('receipts', id); if (!r) return null;
    const lines = db.receipt_lines.filter((x) => x.receipt_id === r.id).sort((a, b) => a.line_no - b.line_no);
    return { ...r, po_id: r.po_id ?? null, supplier: byId('suppliers', r.supplier_id)?.name, site: site(r.site_id)?.name, po_no: byId('purchase_orders', r.po_id)?.doc_no ?? null,
      created_by_name: uname(r.created_by), checked_by_name: uname(r.checked_by),
      total_net: R2(lines.reduce((s, x) => s + x.net_kg, 0)), total_accepted: R2(lines.reduce((s, x) => s + (x.accepted_kg || 0), 0)),
      total_baskets: lines.reduce((s, x) => s + x.baskets, 0),
      lines: lines.map((x) => ({ ...x, po_line_id: x.po_line_id ?? null, lot_code: byId('lots', x.lot_id)?.code, variety: byId('varieties', x.variety_id)?.name, size: byId('sizes', x.size_id)?.name })) };
  };
  const reserved = (s, z, l, r, exclude = null) => R2(db.dispatch_lines.filter((dl) => {
    const d = byId('dispatches', dl.dispatch_id);
    return d.status === 'draft' && d.from_site_id === s && d.from_zone === z && dl.lot_id === l && dl.ripeness === r && d.id !== exclude;
  }).reduce((a, dl) => a + dl.kg, 0));
  // ยอดจองที่แสดงต่อช่องความสุก (ใบร่างจองระดับ Lot): จองตรงตามความสุกที่กรอกก่อน ส่วนที่เกินนับเป็นการจองช่องอื่นของ Lot ที่ยังมียอดเหลือ
  const reservedAlloc = (s, z, l, rip) => {
    const ord = [...RIP, 'na']; const dir = Object.fromEntries(ord.map((k) => [k, reserved(s, z, l, k)]));
    if (!ord.some((k) => dir[k] > 0)) return 0;
    const cap = Object.fromEntries(ord.map((k) => [k, Math.max(bal(s, z, l, k)?.kg || 0, 0)]));
    let over = R2(ord.reduce((a, k) => a + dir[k] - Math.min(dir[k], cap[k]), 0)); const res = Math.min(dir[rip] ?? 0, cap[rip] ?? 0);
    for (const k of ord) { if (over <= 0) break; const take = Math.min(over, R2(cap[k] - Math.min(dir[k], cap[k]))); if (k === rip) return R2(res + take); over = R2(over - take); }
    return R2(res);
  };
  const dispatchJson = (id) => {
    const d = byId('dispatches', id); if (!d) return null;
    const lines = db.dispatch_lines.filter((x) => x.dispatch_id === d.id).sort((a, b) => a.line_no - b.line_no);
    const c = byId('customers', d.customer_id); const fs = site(d.from_site_id); const ts = site(d.to_site_id);
    const rec = lines.filter((x) => x.received_kg != null);
    return { ...d, from_site: fs?.name, from_site_kind: fs?.kind, to_site: ts?.name ?? null, customer: c?.name ?? null, channel: c?.channel ?? null,
      details: d.details ?? null, edited_by: d.edited_by ?? null, edited_at: d.edited_at ?? null, edit_reason: d.edit_reason ?? null,
      destination: c?.name ?? ts?.name ?? null, destination_address: c?.address ?? null, destination_phone: c?.phone ?? null,
      created_by_name: uname(d.created_by), shipped_by_name: uname(d.shipped_by), received_by_name: uname(d.received_by), edited_by_name: uname(d.edited_by),
      shortages: d.status === 'draft' ? dispatchShortages(d.id) : [],
      total_kg: R2(lines.reduce((s, x) => s + x.kg, 0)), total_received_kg: rec.length ? R2(rec.reduce((s, x) => s + x.received_kg, 0)) : null,
      total_baskets: lines.reduce((s, x) => s + x.baskets, 0), total_billed_kg: R2(lines.reduce((s, x) => s + x.billed_kg, 0)),
      open_cases: db.cases.filter((x) => x.dispatch_id === d.id && x.status === 'open').length,
      lines: lines.map((x) => { const l = byId('lots', x.lot_id); return { ...x, detail: x.detail ?? null, lot_code: l.code, product: l.product,
        variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
        supplier: byId('suppliers', l.supplier_id)?.name ?? null, unit_cost: l.unit_cost, avg_g: l.avg_g ?? null }; }),
      cases: db.cases.filter((x) => x.dispatch_id === d.id).sort((a, b) => a.id - b.id) };
  };
  const priceRow = (cust, v, s, prod = 'fresh') => {
    const f = (c) => db.prices.find((p) => (p.customer_id ?? null) === (c ?? null) && p.variety_id === v && p.size_id === s && p.product === (prod || 'fresh'));
    return (cust != null ? f(cust) : null) ?? f(null) ?? null;
  };
  const priceFor = (cust, v, s, prod = 'fresh') => priceRow(cust, v, s, prod)?.sell_price ?? null;
  const checkPrice = (u, cust, v, s, prod, price) => {
    const r = priceRow(cust, v, s, prod); const lp = r?.sell_price ?? null;
    if (price == null || price < 0) fail('ราคาไม่ถูกต้อง');
    if (['admin', 'executive'].includes(u.role)) return lp;
    if (lp == null) fail('ยังไม่ได้ตั้งราคาขายของสินค้านี้ ให้ผู้บริหารตั้งราคาในหน้าตั้งค่าก่อน');
    if (r.min_price != null || r.max_price != null) {
      const lo = r.min_price ?? lp; const hi = r.max_price ?? lp;
      if (price < lo || price > hi) fail(`ราคาต้องอยู่ในกรอบที่อนุมัติ ${fmt(lo)}–${fmt(hi)} บาท/กก. (ราคาตั้ง ${fmt(lp)})`);
      return lp;
    }
    if (price !== lp) fail(`ฝ่ายขายแก้ราคาไม่ได้ (ราคาที่ตั้งไว้ ${fmt(lp)} บาท/กก.)`);
    return lp;
  };
  const totals = (sub, disc, ship, rate) => {
    const base = sub - (disc || 0) + (ship || 0);
    return { subtotal: R2(sub), discount: R2(disc || 0), shipping: R2(ship || 0), vat: R2(base * (rate || 0) / 100), total: R2(base * (1 + (rate || 0) / 100)) };
  };
  const checkDiscount = (u, sub, disc, rate) => {
    const mx = setting('options').max_sales_discount_pct ?? 5;
    if ((disc || 0) < 0) fail('ส่วนลดต้องไม่ติดลบ');
    if ((disc || 0) > sub) fail('ส่วนลดต้องไม่เกินยอดสินค้า');
    if (![0, 7].includes(rate || 0)) fail('VAT ต้องเป็น 0% หรือ 7%');
    if (!['admin', 'executive'].includes(u.role) && sub > 0 && (disc || 0) * 100 / sub > mx) fail(`ฝ่ายขายให้ส่วนลดได้ไม่เกิน ${mx}% ของยอดสินค้า`);
  };
  const quoteJson = (id) => {
    const q = byId('quotes', id); if (!q) return null; const c = byId('customers', q.customer_id);
    return { ...q, customer: c.name, customer_address: c.address, customer_tax_id: c.tax_id, customer_phone: c.phone, created_by_name: uname(q.created_by),
      lines: db.quote_lines.filter((x) => x.quote_id === q.id).sort((a, b) => a.line_no - b.line_no)
        .map((x) => ({ ...x, variety: byId('varieties', x.variety_id)?.name, size: byId('sizes', x.size_id)?.name })) };
  };
  const invoiceJson = (id) => {
    const i = byId('invoices', id); if (!i) return null; const c = byId('customers', i.customer_id);
    const lines = db.invoice_lines.filter((x) => x.invoice_id === i.id).sort((a, b) => a.line_no - b.line_no);
    const dnos = [...new Set(lines.map((x) => byId('dispatches', byId('dispatch_lines', x.dispatch_line_id).dispatch_id).doc_no))].sort();
    const cns = db.credit_notes.filter((n) => n.invoice_id === i.id).sort((a, b) => a.id - b.id);
    return { ...i, customer: c.name, customer_address: c.address, customer_tax_id: c.tax_id, customer_phone: c.phone, channel: c.channel,
      created_by_name: uname(i.created_by), gross_profit: R2(i.subtotal - i.discount - i.cost_total),
      credit_notes: cns.map((n) => ({ id: n.id, doc_no: n.doc_no, doc_date: n.doc_date, total: n.total, status: n.status })),
      credited_total: R2(cns.filter((n) => n.status === 'issued').reduce((a, n) => a + n.total, 0)), dispatches: dnos.join(', ') || null,
      lines: lines.map((x) => { const l = byId('lots', x.lot_id); const dl = byId('dispatch_lines', x.dispatch_line_id); const d = byId('dispatches', dl.dispatch_id);
        const root = l.parent_lot_id ? byId('lots', l.parent_lot_id) : l; const r = byId('receipts', root.receipt_id);
        return { ...x, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name, size: byId('sizes', l.size_id)?.name,
          dispatch_no: d.doc_no, dispatch_id: d.id, delivered_kg: dl.received_kg, shipped_kg: dl.kg, receipt_no: r?.doc_no ?? null,
          supplier: byId('suppliers', root.supplier_id)?.name ?? null, received_at: root.received_at }; }) };
  };
  const today = () => bkkDate(Date.now());
  const ageDays = (l) => daysBetween(today(), bkkDate(l.received_at));
  const inRange = (iso, f, t) => { const d = iso.length > 10 ? bkkDate(iso) : iso; return (!f || d >= f) && (!t || d <= t); };
  const like = (s, q) => (s || '').toLowerCase().includes(q);

  // ---------- ฟังก์ชัน API ----------
  const A = {};

  A.api_me = (p) => {
    const sub = claims?.sub; if (!sub) fail('กรุณาเข้าสู่ระบบ');
    let u = db.users.find((x) => x.auth_sub === sub);
    if (!u) {
      u = ins('users', { auth_sub: sub, email: claims.email ?? null,
        display_name: txt(p, 'name') || claims.name || (claims.email || 'ผู้ใช้ใหม่').split('@')[0],
        role: db.users.some((x) => x.role === 'admin') ? 'pending' : 'admin', site_id: null, is_manager: false, active: true,
        created_at: nowIso(), updated_by: null, updated_at: nowIso() });
      audit(u.id, 'signup', 'user', u.id, { role: u.role, email: u.email });
    }
    return { user: { ...userOut(u), site: site(u.site_id) ?? null }, master: u.role === 'pending' || !u.active ? {} : masterJson() };
  };

  // ผู้ใช้ที่มีประวัติในเอกสาร/สมุดเคลื่อนไหว ลบไม่ได้ (ตรงกับ FK ที่อ้าง avo.users ใน SQL)
  const USER_REFS = [['adjustments', 'decided_by'], ['adjustments', 'requested_by'], ['assignments', 'assigned_by'], ['cases', 'resolved_by'],
    ['credit_notes', 'cancelled_by'], ['credit_notes', 'created_by'], ['dispatches', 'created_by'], ['dispatches', 'received_by'], ['dispatches', 'shipped_by'], ['dispatches', 'edited_by'],
    ['freezes', 'created_by'], ['internal_transfers', 'created_by'], ['invoices', 'cancelled_by'], ['invoices', 'created_by'], ['movements', 'actor_id'],
    ['movements', 'approver_id'], ['quotes', 'created_by'], ['receipts', 'checked_by'], ['receipts', 'created_by'], ['returns', 'decided_by'],
    ['returns', 'requested_by'], ['ripeness_checks', 'checked_by'], ['stocktake_lines', 'counted_by'], ['stocktakes', 'created_by'],
    ['stocktakes', 'decided_by'], ['stocktakes', 'submitted_by'], ['purchase_orders', 'created_by'], ['purchase_orders', 'approved_by'],
    ['purchase_orders', 'closed_by'], ['purchase_budgets', 'updated_by'], ['plan_dests', 'created_by'], ['delivery_plans', 'created_by'],
    ['delivery_plans', 'updated_by']];
  const userInUse = (id) => USER_REFS.some(([t, c]) => (db[t] || []).some((r) => r[c] === id));
  A.api_users = () => { const u = cur(); need(u, ['admin']);
    return db.users.map((x) => ({ ...userOut(x), site_name: site(x.site_id)?.name ?? null, can_delete: x.id !== u.id && !userInUse(x.id) }))
      .sort((a, b) => (b.active - a.active) || ((b.role === 'pending') - (a.role === 'pending')) || (a.display_name || '').localeCompare(b.display_name || '')); };

  A.api_user_delete = (p) => {
    const u = cur(); need(u, ['admin']);
    const t = byId('users', num(p, 'id')); if (!t) fail('ไม่พบผู้ใช้');
    if (t.id === u.id) fail('ไม่สามารถลบบัญชีของตัวเองได้');
    if (userInUse(t.id)) fail('ผู้ใช้นี้เคยทำรายการในระบบแล้ว ลบไม่ได้เพราะต้องเก็บประวัติไว้ตรวจสอบ — ให้ติ๊กเอา "เปิดใช้งาน" ออกแทน (เข้าระบบไม่ได้อีก)');
    db.assignments = db.assignments.filter((x) => x.assignee_id !== t.id);
    db.client_requests = db.client_requests.filter((x) => x.user_id !== t.id);
    db.users = db.users.filter((x) => x.id !== t.id);
    audit(u.id, 'delete', 'user', t.id, { email: t.email, display_name: t.display_name, role: t.role });
    return { deleted: true, id: t.id };
  };
  A.api_user_save = (p) => {
    const u = cur(); need(u, ['admin']);
    const t = byId('users', num(p, 'id')); if (!t) fail('ไม่พบผู้ใช้');
    const role = txt(p, 'role');
    if (role && !['pending', 'admin', 'executive', 'warehouse', 'branch', 'sales'].includes(role)) fail('บทบาทไม่ถูกต้อง');
    if (t.id === u.id && ((role || t.role) !== 'admin' || bool(p, 'active', true) === false)) fail('ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
    const newSite = 'site_id' in p ? num(p, 'site_id') : t.site_id;
    if ((role || t.role) === 'branch' && newSite == null) fail('ผู้ใช้ฝ่ายสาขาต้องระบุสาขา');
    Object.assign(t, { role: role || t.role, display_name: txt(p, 'display_name') || t.display_name, site_id: newSite,
      is_manager: bool(p, 'is_manager', t.is_manager), active: bool(p, 'active', t.active), updated_by: u.id, updated_at: nowIso() });
    audit(u.id, 'update', 'user', t.id, p);
    return userOut(t);
  };

  A.api_master_save = (p) => {
    const u = cur(); const ent = p.entity; const r = p.row || {}; const rid = num(r, 'id');
    if (['variety', 'size'].includes(ent)) { if (!(u.role === 'admin' || (u.role === 'warehouse' && u.is_manager))) fail('เฉพาะ Admin หรือผู้จัดการคลังที่แก้ไขสายพันธุ์/ไซส์ได้'); }
    else need(u, ['admin']);
    if (!txt(r, 'code') || !txt(r, 'name')) fail('กรุณากรอกรหัสและชื่อ');
    const table = { variety: 'varieties', size: 'sizes', site: 'sites' }[ent]; if (!table) fail('ประเภทข้อมูลไม่ถูกต้อง');
    const code = txt(r, 'code').toUpperCase();
    if (db[table].some((x) => x.code === code && x.id !== rid)) fail('รหัสนี้ถูกใช้แล้ว');
    if (ent === 'site' && !['warehouse', 'branch'].includes(r.kind)) fail('ประเภทสถานที่ต้องเป็น คลัง หรือ สาขา');
    let row;
    const vals = { code, name: txt(r, 'name'), updated_by: u.id, updated_at: nowIso() };
    if (ent === 'size') Object.assign(vals, { min_g: int(r, 'min_g'), max_g: int(r, 'max_g') });
    if (ent === 'site') vals.kind = r.kind;
    if (rid == null) row = ins(table, { ...vals, sort: int(r, 'sort') ?? 0, active: bool(r, 'active', true) });
    else { row = byId(table, rid); if (!row) fail('ไม่พบข้อมูลที่ต้องการแก้ไข'); Object.assign(row, vals, { sort: int(r, 'sort') ?? row.sort, active: bool(r, 'active', row.active) }); }
    audit(u.id, rid == null ? 'create' : 'update', ent, row.id, r);
    return { ...row };
  };

  A.api_settings_save = (p) => {
    const u = cur(); need(u, ['admin']);
    if (!['thresholds', 'company', 'options', 'line'].includes(p.key)) fail('หมวดการตั้งค่าไม่ถูกต้อง');
    const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v); const oldV = db.settings[p.key]?.value; const newV = p.value || {};
    db.settings[p.key] = { value: isObj(oldV) && isObj(newV) ? { ...oldV, ...newV } : newV, updated_by: u.id, updated_at: nowIso() };   // รวมกับค่าเดิม (หัวข้อที่หน้าเว็บรุ่นเก่าไม่ได้ส่งมาไม่หาย)
    audit(u.id, 'update', 'settings', p.key, p.value);
    return masterJson();
  };

  A.api_audit = (p) => { const u = cur(); need(u, ['admin', 'executive']);
    return [...db.audit_log].sort((a, b) => b.id - a.id).slice(0, int(p, 'limit') || 200)
      .map((a) => ({ at: a.at, actor: uname(a.actor_id), action: a.action, entity: a.entity, entity_id: a.entity_id, data: a.data })); };

  A.api_attachment_save = (p) => { const u = cur(); const d = p.data;
    if (!d || !String(d).startsWith('data:image/')) fail('ไฟล์แนบต้องเป็นรูปภาพ');
    if (d.length > 1500000) fail('รูปมีขนาดใหญ่เกินไป');
    const a = ins('attachments', { token: uuid(), mime: d.split(';')[0].split(':')[1], data: d, created_by: u.id, created_at: nowIso() });
    return { ref: 'att:' + a.token }; };
  A.api_attachment_get = (p) => { cur(); const r = p.ref || '';
    if (!/^att:[0-9a-f-]{36}$/.test(r)) return { data: null }; return { data: db.attachments.find((a) => a.token === r.slice(4))?.data ?? null }; };

  A.api_supplier_save = (p) => {
    const u = cur(); need(u, ['warehouse', 'executive']); if (!txt(p, 'name')) fail('กรุณากรอกชื่อสวน');
    const rid = num(p, 'id'); const code = txt(p, 'code')?.toUpperCase();
    if (code && db.suppliers.some((s) => s.code === code && s.id !== rid)) fail('รหัสสวนนี้ถูกใช้แล้ว');
    const vals = { name: txt(p, 'name'), contact: txt(p, 'contact'), phone: txt(p, 'phone'), province: txt(p, 'province'), varieties: txt(p, 'varieties'),
      buy_price: num(p, 'buy_price'), note: txt(p, 'note'), updated_by: u.id, updated_at: nowIso() };
    let s;
    if (rid == null) s = ins('suppliers', { code: code || 'F' + String(db.suppliers.length + 1).padStart(3, '0'), ...vals, active: bool(p, 'active', true) });
    else { s = byId('suppliers', rid); if (!s) fail('ไม่พบสวน'); Object.assign(s, vals, { code: code || s.code, active: bool(p, 'active', s.active) }); }
    audit(u.id, rid == null ? 'create' : 'update', 'supplier', s.id, p);
    return { ...s };
  };
  const confirmedLinesOf = (sid) => db.receipt_lines.filter((rl) => { const r = byId('receipts', rl.receipt_id); return r.supplier_id === sid && r.status === 'confirmed'; });
  A.api_suppliers = () => { company(cur()); return [...db.suppliers].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map((s) => {
    const rs = db.receipts.filter((r) => r.supplier_id === s.id && r.status === 'confirmed');
    return { ...s, receipts: rs.length, received_kg: R2(confirmedLinesOf(s.id).reduce((a, x) => a + x.accepted_kg, 0)),
      last_received: rs.length ? rs.map((r) => r.received_at).sort().at(-1) : null }; }); };
  A.api_supplier_get = (p) => {
    company(cur()); const s = byId('suppliers', num(p, 'id')); if (!s) return null;
    const recv = R2(confirmedLinesOf(s.id).reduce((a, x) => a + x.accepted_kg, 0));
    const rootSup = (lotId) => { const l = byId('lots', lotId); const root = l.parent_lot_id ? byId('lots', l.parent_lot_id) : l; return root.supplier_id; };
    const waste = R2(db.movements.filter((m) => ['WASTE', 'CASE_LOSS'].includes(m.mtype)).filter((m) => rootSup(m.lot_id) === s.id).reduce((a, m) => a - m.d_kg, 0)
      + db.return_lines.filter((x) => x.disposition === 'discard' && byId('returns', x.return_id).status === 'applied' && rootSup(x.lot_id) === s.id).reduce((a, x) => a + x.kg, 0));
    const hist = db.receipt_lines.filter((rl) => byId('receipts', rl.receipt_id).supplier_id === s.id).map((rl) => { const r = byId('receipts', rl.receipt_id);
      return { receipt_id: r.id, doc_no: r.doc_no, received_at: r.received_at, status: r.status, lot: byId('lots', rl.lot_id).code,
        variety: byId('varieties', rl.variety_id)?.name, size: byId('sizes', rl.size_id)?.name, baskets: rl.baskets, net_kg: rl.net_kg,
        accepted_kg: rl.accepted_kg, rejected_kg: rl.rejected_kg, unit_cost: rl.unit_cost, _ln: rl.line_no }; })
      .sort((a, b) => (b.received_at > a.received_at ? 1 : b.received_at < a.received_at ? -1 : a._ln - b._ln)).map(({ _ln, ...x }) => x);
    return { ...s, received_kg: recv, waste_kg: waste,
      shrink_kg: R2(db.movements.filter((m) => m.mtype === 'SHRINK' && byId('lots', m.lot_id).supplier_id === s.id).reduce((a, m) => a - m.d_kg, 0)),
      waste_rate: recv > 0 ? R2(waste * 100 / recv) : 0,
      rejected_kg: R2(confirmedLinesOf(s.id).reduce((a, x) => a + x.rejected_kg, 0)), history: hist };
  };

  A.api_customer_save = (p) => {
    const u = cur(); need(u, ['sales', 'executive', 'warehouse']); if (!txt(p, 'name')) fail('กรุณากรอกชื่อลูกค้า');
    const ch = p.channel || 'wholesale'; if (!['wholesale', 'retail', 'dc', 'online', 'tiktok', 'other'].includes(ch)) fail('ช่องทางขายไม่ถูกต้อง');
    const rid = num(p, 'id'); const code = txt(p, 'code')?.toUpperCase();
    if (code && db.customers.some((s) => s.code === code && s.id !== rid)) fail('รหัสลูกค้านี้ถูกใช้แล้ว');
    const vals = { name: txt(p, 'name'), address: txt(p, 'address'), phone: txt(p, 'phone'), tax_id: txt(p, 'tax_id'), branch_no: txt(p, 'branch_no'), note: txt(p, 'note'), updated_by: u.id, updated_at: nowIso() };
    let c;
    if (rid == null) c = ins('customers', { code: code || 'C' + String(db.customers.length + 1).padStart(3, '0'), ctype: txt(p, 'ctype') || 'company', channel: ch, ...vals, active: bool(p, 'active', true) });
    else { c = byId('customers', rid); if (!c) fail('ไม่พบลูกค้า'); Object.assign(c, vals, { code: code || c.code, ctype: txt(p, 'ctype') || c.ctype, channel: txt(p, 'channel') || c.channel, active: bool(p, 'active', c.active) }); }
    audit(u.id, rid == null ? 'create' : 'update', 'customer', c.id, p);
    return { ...c };
  };
  A.api_customers = () => { company(cur()); return [...db.customers].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map((c) => {
    const inv = db.invoices.filter((i) => i.customer_id === c.id && i.status === 'issued');
    return { ...c, invoices: inv.length, sales_total: R2(inv.reduce((a, i) => a + i.total, 0) - db.credit_notes.filter((n) => n.customer_id === c.id && n.status === 'issued').reduce((a, n) => a + n.total, 0)), last_sale: inv.length ? inv.map((i) => i.doc_date).sort().at(-1) : null }; }); };
  A.api_customer_get = (p) => {
    company(cur()); const c = byId('customers', num(p, 'id')); if (!c) return null;
    const rows = [];
    db.invoices.filter((i) => i.customer_id === c.id).forEach((i) => db.invoice_lines.filter((il) => il.invoice_id === i.id).forEach((il) => {
      const l = byId('lots', il.lot_id);
      rows.push({ invoice_id: i.id, doc_no: i.doc_no, doc_date: i.doc_date, status: i.status, variety: byId('varieties', l.variety_id)?.name ?? null,
        size: byId('sizes', l.size_id)?.name ?? null, lot: l.code, kg: il.kg, price: il.price, amount: il.amount, _k: [i.doc_date, i.id, il.line_no] }); }));
    rows.sort((a, b) => (a._k[0] < b._k[0] ? 1 : a._k[0] > b._k[0] ? -1 : b._k[1] - a._k[1] || a._k[2] - b._k[2]));
    const fav = {};
    rows.filter((r) => r.status === 'issued').forEach((r) => { const k = r.variety + '|' + r.size; fav[k] = fav[k] || { variety: r.variety, size: r.size, kg: 0 }; fav[k].kg = R2(fav[k].kg + r.kg); });
    return { ...c, credit_total: R2(db.credit_notes.filter((n) => n.customer_id === c.id && n.status === 'issued').reduce((a, n) => a + n.total, 0)),
      prices: db.prices.filter((x) => x.customer_id === c.id).map((x) => ({ variety: byId('varieties', x.variety_id)?.name, size: byId('sizes', x.size_id)?.name, product: x.product, sell_price: x.sell_price, min_price: x.min_price ?? null, max_price: x.max_price ?? null })),
      history: rows.map(({ _k, ...r }) => r), favorites: Object.values(fav).sort((a, b) => b.kg - a.kg) };
  };

  A.api_prices = () => { company(cur()); return db.prices.map((x) => ({ id: x.id, customer_id: x.customer_id ?? null, customer: byId('customers', x.customer_id)?.name ?? null,
    variety_id: x.variety_id, variety: byId('varieties', x.variety_id)?.name, size_id: x.size_id, size: byId('sizes', x.size_id)?.name, product: x.product,
    sell_price: x.sell_price, min_price: x.min_price ?? null, max_price: x.max_price ?? null, updated_at: x.updated_at, _vs: byId('varieties', x.variety_id)?.sort ?? 0, _zs: byId('sizes', x.size_id)?.sort ?? 0 }))
    .sort((a, b) => ((a.customer || '') < (b.customer || '') ? -1 : (a.customer || '') > (b.customer || '') ? 1 : a._vs - b._vs || a._zs - b._zs || a.product.localeCompare(b.product)))
    .map(({ _vs, _zs, ...x }) => x); };
  A.api_price_save = (p) => {
    const u = cur(); need(u, ['executive']);
    const cid = num(p, 'customer_id'); const vid = num(p, 'variety_id'); const zid = num(p, 'size_id'); const prod = txt(p, 'product') || 'fresh'; const pr = num(p, 'sell_price');
    const lo = num(p, 'min_price'); const hi = num(p, 'max_price');
    if (vid == null || zid == null) fail('กรุณาเลือกสายพันธุ์และไซส์');
    db.prices = db.prices.filter((x) => !((x.customer_id ?? null) === (cid ?? null) && x.variety_id === vid && x.size_id === zid && x.product === prod));
    if (pr != null) {
      if (pr < 0 || (lo ?? 0) < 0 || (hi ?? 0) < 0) fail('ราคาต้องไม่ติดลบ');
      if (lo != null && lo > pr) fail('ราคาต่ำสุดต้องไม่มากกว่าราคาขาย');
      if (hi != null && hi < pr) fail('ราคาสูงสุดต้องไม่น้อยกว่าราคาขาย');
      ins('prices', { customer_id: cid, variety_id: vid, size_id: zid, product: prod, sell_price: pr, min_price: lo, max_price: hi, updated_by: u.id, updated_at: nowIso() }); }
    audit(u.id, 'update', 'price', `${cid ?? 'std'}:${vid}:${zid}:${prod}`, p);
    return A.api_prices({});
  };
  A.api_price_lookup = (p) => { need(cur(), ['warehouse', 'sales', 'executive']); let r;
    if ('lot_id' in p) { const l = byId('lots', num(p, 'lot_id')); r = l ? priceRow(num(p, 'customer_id'), l.variety_id, l.size_id, l.product) : null; }
    else r = priceRow(num(p, 'customer_id'), num(p, 'variety_id'), num(p, 'size_id'), txt(p, 'product') || 'fresh');
    return { price: r?.sell_price ?? null, min_price: r?.min_price ?? null, max_price: r?.max_price ?? null }; };
  A.api_assignees = () => { const u = cur();
    return db.users.filter((x) => x.active && x.role !== 'pending' && (u.role !== 'branch' || x.site_id === u.site_id || ['admin', 'executive'].includes(x.role) || x.id === u.id))
      .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''))
      .map((x) => ({ id: x.id, name: x.display_name || x.email, role: x.role, site_id: x.site_id, site: site(x.site_id)?.name ?? null, is_manager: x.is_manager })); };

  // ---------- รับเข้า ----------
  A.api_receipt_save = (p) => {
    const u = cur(); need(u, ['warehouse']);
    let po = null;
    if (num(p, 'po_id') != null) { po = byId('purchase_orders', num(p, 'po_id'));
      if (!po || !['approved', 'partial'].includes(po.status)) fail('ใบสั่งซื้อต้องอนุมัติแล้วและยังไม่ปิด');
      p = { ...p, supplier_id: po.supplier_id, site_id: num(p, 'site_id') ?? po.site_id }; }
    const sid = num(p, 'site_id') ?? u.site_id ?? db.sites.filter((s) => s.kind === 'warehouse' && s.active).sort((a, b) => a.sort - b.sort || a.id - b.id)[0]?.id;
    if (sid == null) fail('ยังไม่ได้ตั้งค่าคลังสินค้า (ตั้งค่า → สาขา/คลัง)');
    if (site(sid)?.kind !== 'warehouse') fail('รับเข้าจากสวนได้เฉพาะที่คลัง');
    needSite(u, sid);
    const sup = num(p, 'supplier_id'); if (sup == null || !byId('suppliers', sup)) fail('กรุณาเลือกสวน / แหล่งที่มา');
    if (!(p.lines || []).length) fail('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
    const status = bool(p, 'submit', false) ? 'pending_check' : 'draft';
    let r; const rid = num(p, 'id');
    if (rid == null) {
      r = ins('receipts', { doc_no: nextNo('IN'), supplier_id: sup, site_id: sid, received_at: p.received_at ? new Date(p.received_at).toISOString() : nowIso(),
        status, note: txt(p, 'note'), evidence: txt(p, 'evidence'), created_by: u.id, created_at: nowIso(), checked_by: null, checked_at: null, cancel_reason: null, updated_at: nowIso(), po_id: po?.id ?? null });
    } else {
      r = byId('receipts', rid); if (r && !canAct(u, r.site_id)) fail('ไม่มีสิทธิ์แก้ไขใบรับเข้าของคลังอื่น');
      if (!r || !['draft', 'pending_check'].includes(r.status)) fail('แก้ไขได้เฉพาะใบรับเข้าที่ยังไม่ยืนยัน');
      Object.assign(r, { supplier_id: sup, site_id: sid, received_at: p.received_at ? new Date(p.received_at).toISOString() : r.received_at, status,
        note: txt(p, 'note'), evidence: txt(p, 'evidence') ?? r.evidence, updated_at: nowIso(), po_id: po?.id ?? null });
    }
    const keep = [];
    p.lines.forEach((ln, idx) => {
      const i = idx + 1; const v = num(ln, 'variety_id'); const s = num(ln, 'size_id'); const rip = ln.ripeness || 'raw';
      let gross = num(ln, 'gross_kg'); let tare = num(ln, 'tare_kg') ?? 0; const bk = int(ln, 'baskets') ?? 0; const est = bool(ln, 'estimated', false); const pcs = int(ln, 'pieces');
      if (v == null || s == null) fail(`รายการที่ ${i}: กรุณาเลือกสายพันธุ์และไซส์`);
      if (!RIP.includes(rip)) fail(`รายการที่ ${i}: สถานะความสุกไม่ถูกต้อง`);
      if (bk < 0) fail(`รายการที่ ${i}: จำนวนตะกร้าไม่ถูกต้อง`);
      if (pcs != null && pcs <= 0) fail(`รายการที่ ${i}: จำนวนลูกต้องมากกว่า 0`);
      if (est) {
        if (bk <= 0) fail(`รายการที่ ${i}: รับแบบประมาณต้องระบุจำนวนตะกร้า`);
        gross = R2(bk * threshold('std_basket_kg', 20)); tare = 0;
      } else {
        if (gross == null || gross <= 0) fail(`รายการที่ ${i}: กรุณากรอกน้ำหนักรวม (ชั่งจริง)`);
        if (tare < 0 || tare >= gross) fail(`รายการที่ ${i}: น้ำหนักตะกร้าต้องน้อยกว่าน้ำหนักรวม`);
      }
      const avg = pcs != null ? R1((gross - tare) * 1000 / pcs) : sizeAvg(s);
      const pol = po ? poLineFor(po.id, v, s) : null;
      const vals = { line_no: i, variety_id: v, size_id: s, ripeness: rip, baskets: bk, gross_kg: R2(gross), tare_kg: R2(tare),
        net_kg: R2(gross - tare), pieces: pcs ?? null, is_estimated: est, est_kg: est ? R2(gross) : null, unit_cost: num(ln, 'unit_cost') ?? pol?.price ?? 0, note: txt(ln, 'note'), po_line_id: pol?.id ?? null };
      const ex = db.receipt_lines.find((x) => x.id === num(ln, 'id') && x.receipt_id === r.id);
      if (ex) {
        Object.assign(byId('lots', ex.lot_id), { variety_id: v, size_id: s, supplier_id: sup, received_at: r.received_at, unit_cost: vals.unit_cost, avg_g: avg });
        Object.assign(ex, vals); keep.push(ex.id);
      } else {
        const lot = ins('lots', { code: nextNo('LOT'), product: 'fresh', variety_id: v, size_id: s, supplier_id: sup, receipt_id: r.id, parent_lot_id: null,
          received_at: r.received_at, unit_cost: vals.unit_cost, status: 'draft', created_at: nowIso(), avg_g: avg });
        const nl = ins('receipt_lines', { receipt_id: r.id, lot_id: lot.id, ...vals, rejected_kg: 0, accepted_kg: null });
        keep.push(nl.id);
      }
    });
    const drop = db.receipt_lines.filter((x) => x.receipt_id === r.id && !keep.includes(x.id));
    db.receipt_lines = db.receipt_lines.filter((x) => !drop.includes(x));
    db.lots = db.lots.filter((l) => !drop.some((d) => d.lot_id === l.id));
    audit(u.id, rid == null ? 'create' : 'update', 'receipt', r.id, { status });
    return receiptJson(r.id);
  };
  A.api_receipt_confirm = (p) => {
    const u = cur(); need(u, ['warehouse']);
    const r = byId('receipts', num(p, 'id')); if (!r) fail('ไม่พบใบรับเข้า');
    if (!['draft', 'pending_check'].includes(r.status)) fail('ใบรับเข้านี้ยืนยันหรือยกเลิกไปแล้ว');
    needSite(u, r.site_id);
    const sname = byId('suppliers', r.supplier_id)?.name;
    db.receipt_lines.filter((x) => x.receipt_id === r.id).sort((a, b) => a.line_no - b.line_no).forEach((rl) => {
      const ln = (p.lines || []).find((x) => Number(x.id) === rl.id);
      if (rl.is_estimated) {
        const g = num(ln, 'gross_kg'); const t = num(ln, 'tare_kg') ?? 0;
        if (g == null || g <= 0) fail(`บรรทัด ${rl.line_no}: รับแบบประมาณ ต้องกรอกน้ำหนักชั่งจริงก่อนยืนยันตรวจรับ`);
        if (t < 0 || t >= g) fail(`บรรทัด ${rl.line_no}: น้ำหนักตะกร้าต้องน้อยกว่าน้ำหนักรวม`);
        Object.assign(rl, { gross_kg: R2(g), tare_kg: R2(t), net_kg: R2(g - t), is_estimated: false });
      }
      const rej = num(ln, 'rejected_kg') ?? rl.rejected_kg ?? 0;
      if (rej < 0 || rej > rl.net_kg) fail(`บรรทัด ${rl.line_no}: น้ำหนักคัดออกต้องอยู่ระหว่าง 0 ถึง ${fmt(rl.net_kg)} กก.`);
      Object.assign(rl, { rejected_kg: R2(rej), accepted_kg: R2(rl.net_kg - rej), note: txt(ln, 'note') ?? rl.note });
      const lt = byId('lots', rl.lot_id); lt.status = 'active';
      lt.avg_g = rl.pieces != null ? R1(rl.net_kg * 1000 / rl.pieces) : (lt.avg_g ?? sizeAvg(rl.size_id));
      move(r.site_id, 'main', rl.lot_id, rl.ripeness, rl.accepted_kg, rl.baskets, 0, 'RECEIVE', 'RECEIPT', r.id, r.doc_no, u.id, txt(p, 'note'), [r.evidence, txt(p, 'evidence')].filter(Boolean).join('|') || null, u.id, sname, r.received_at);
    });
    Object.assign(r, { status: 'confirmed', checked_by: u.id, checked_at: nowIso(), evidence: [r.evidence, txt(p, 'evidence')].filter(Boolean).join('|') || null, updated_at: nowIso() });
    poRefresh(r.po_id);
    audit(u.id, 'confirm', 'receipt', r.id, p);
    return receiptJson(r.id);
  };
  A.api_receipt_cancel = (p) => {
    const u = cur(); need(u, ['warehouse']); const r = byId('receipts', num(p, 'id'));
    if (!r || !['draft', 'pending_check'].includes(r.status)) fail('ยกเลิกได้เฉพาะใบรับเข้าที่ยังไม่ยืนยัน');
    needSite(u, r.site_id);
    Object.assign(r, { status: 'cancelled', cancel_reason: txt(p, 'reason'), updated_at: nowIso() });
    db.lots.filter((l) => l.receipt_id === r.id).forEach((l) => { l.status = 'cancelled'; });
    audit(u.id, 'cancel', 'receipt', r.id, p);
    return receiptJson(r.id);
  };
  A.api_receipt_reverse = (p) => {
    const u = cur(); const r = byId('receipts', num(p, 'id'));
    if (!r || r.status !== 'confirmed') fail('กลับรายการได้เฉพาะใบรับเข้าที่ยืนยันแล้ว');
    if (!isApprover(u, r.site_id)) fail('ต้องเป็นผู้จัดการคลัง ผู้บริหาร หรือ Admin');
    if (!txt(p, 'reason')) fail('กรุณาระบุเหตุผลการกลับรายการ');
    const lines = db.receipt_lines.filter((x) => x.receipt_id === r.id);
    const bad = lines.filter((x) => db.movements.some((m) => m.lot_id === x.lot_id && m.mtype !== 'RECEIVE')).map((x) => byId('lots', x.lot_id).code);
    if (bad.length) fail('Lot ' + bad.join(', ') + ' ถูกเคลื่อนไหวแล้ว กลับรายการทั้งใบไม่ได้ ให้ใช้การปรับยอดที่อ้างอิงรายการเดิมแทน');
    lines.forEach((rl) => { needFree(r.site_id, 'main', rl.lot_id, rl.ripeness, rl.accepted_kg); move(r.site_id, 'main', rl.lot_id, rl.ripeness, -rl.accepted_kg, -rl.baskets, 0, 'RECEIVE_REVERSE', 'RECEIPT', r.id, r.doc_no, u.id, txt(p, 'reason'), txt(p, 'evidence'), u.id);
      byId('lots', rl.lot_id).status = 'cancelled'; });
    Object.assign(r, { status: 'reversed', cancel_reason: txt(p, 'reason'), updated_at: nowIso() }); poRefresh(r.po_id);
    audit(u.id, 'reverse', 'receipt', r.id, p);
    return receiptJson(r.id);
  };
  A.api_receipts = (p) => {
    const u = cur(); const q = txt(p, 'q')?.toLowerCase();
    return page(db.receipts.filter((r) => canSee(u, r.site_id) && (!txt(p, 'status') || r.status === p.status) && inRange(r.received_at, txt(p, 'from'), txt(p, 'to'))
      && (!q || like(r.doc_no, q) || like(byId('suppliers', r.supplier_id)?.name, q) || db.receipt_lines.some((rl) => rl.receipt_id === r.id && like(byId('lots', rl.lot_id).code, q))))
      .sort((a, b) => (a.received_at < b.received_at ? 1 : a.received_at > b.received_at ? -1 : b.id - a.id)), p)
      .map((r) => { const { lines, ...j } = receiptJson(r.id); return { ...j, lots: lines.map((l) => l.lot_code).join(', ') || null, estimated: lines.length ? lines.some((l) => l.is_estimated) : null }; });
  };
  A.api_receipt_get = (p) => { const u = cur(); const r = byId('receipts', num(p, 'id')); if (!canSee(u, r?.site_id)) fail('ไม่มีสิทธิ์ดูเอกสารนี้'); return receiptJson(num(p, 'id')); };

  // ---------- สต็อก ----------
  A.api_stock = (p) => {
    const u = cur(); const q = txt(p, 'q')?.toLowerCase();
    return nocost(u, db.balances.filter((b) => (b.kg !== 0 || b.bags > 0) && canSee(u, b.site_id)
      && (num(p, 'site_id') == null || b.site_id === num(p, 'site_id'))
      && (txt(p, 'zone') == null ? b.zone !== 'transit' : b.zone === p.zone)
      && (!txt(p, 'site_kind') || site(b.site_id).kind === p.site_kind)
      && (!txt(p, 'ripeness') || b.ripeness === p.ripeness))
      .map((b) => { const l = byId('lots', b.lot_id); const st = site(b.site_id);
        return { site_id: b.site_id, site: st.name, site_code: st.code, site_kind: st.kind, zone: b.zone, lot_id: l.id, lot_code: l.code, product: l.product,
          variety_id: l.variety_id, variety: byId('varieties', l.variety_id)?.name ?? null, size_id: l.size_id, size: byId('sizes', l.size_id)?.name ?? null,
          supplier_id: l.supplier_id, supplier: byId('suppliers', l.supplier_id)?.name ?? null, received_at: l.received_at, age_days: ageDays(l),
          ripeness: b.ripeness, rip_rank: RIP_RANK[b.ripeness], kg: b.kg, baskets: b.baskets, bags: b.bags, unit_cost: l.unit_cost,
          value: R2(b.kg * l.unit_cost), avg_g: l.avg_g ?? null, est_pieces: l.avg_g > 0 ? Math.round(b.kg * 1000 / l.avg_g) : null,
          reserved_kg: reservedAlloc(b.site_id, b.zone, b.lot_id, b.ripeness), updated_at: b.updated_at }; })
      .filter((x) => (num(p, 'variety_id') == null || x.variety_id === num(p, 'variety_id')) && (num(p, 'size_id') == null || x.size_id === num(p, 'size_id'))
        && (num(p, 'supplier_id') == null || x.supplier_id === num(p, 'supplier_id')) && (!txt(p, 'product') || x.product === p.product)
        && (!q || like(x.lot_code, q) || like(x.variety, q) || like(x.supplier, q) || like(x.size, q)))
      .sort((a, b) => (a.site_kind !== b.site_kind ? (a.site_kind < b.site_kind ? 1 : -1) : a.site.localeCompare(b.site) || b.rip_rank - a.rip_rank
        || (a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.lot_code.localeCompare(b.lot_code)))));
  };
  A.api_fefo = (p) => {
    const uu = cur(); if (!canSee(uu, num(p, 'site_id'))) fail('ไม่มีสิทธิ์ดูสต็อกของสถานที่นี้'); let need_ = num(p, 'need_kg') ?? 0; const out = [];
    db.balances.filter((b) => b.site_id === num(p, 'site_id') && b.zone === (txt(p, 'zone') || 'main') && b.kg > 0 && (!txt(p, 'ripeness') || b.ripeness === p.ripeness))
      .map((b) => ({ b, l: byId('lots', b.lot_id) }))
      .filter(({ l }) => (num(p, 'variety_id') == null || l.variety_id === num(p, 'variety_id')) && (num(p, 'size_id') == null || l.size_id === num(p, 'size_id')))
      .sort((x, y) => RIP_RANK[y.b.ripeness] - RIP_RANK[x.b.ripeness] || (x.l.received_at < y.l.received_at ? -1 : x.l.received_at > y.l.received_at ? 1 : x.l.id - y.l.id))
      .forEach(({ b, l }) => {
        const avail = R2(b.kg - reserved(b.site_id, b.zone, b.lot_id, b.ripeness, num(p, 'exclude_dispatch_id')));
        if (avail <= 0) return;
        const take = Math.min(avail, Math.max(need_, 0)); need_ -= take;
        out.push({ lot_id: l.id, lot_code: l.code, ripeness: b.ripeness, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
          supplier: byId('suppliers', l.supplier_id)?.name ?? null, product: l.product, received_at: l.received_at, kg: b.kg, available_kg: avail,
          baskets: b.baskets, bags: b.bags, avg_g: l.avg_g ?? null, suggest_kg: R2(take), suggest_baskets: b.kg > 0 ? Math.round(b.baskets * take / b.kg) : 0 });
      });
    return out;
  };
  A.api_ripeness_change = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const sid = num(p, 'site_id'); needSite(u, sid);
    const z = txt(p, 'zone') || 'main'; const lot = num(p, 'lot_id'); const f = p.from; const t = p.to; const kg = num(p, 'kg'); const bk = int(p, 'baskets') ?? 0;
    checkZone(sid, z);
    if (f === t) fail('สถานะความสุกใหม่ต้องต่างจากเดิม');
    if (!RIP.includes(t) || !RIP.includes(f)) fail('สถานะความสุกไม่ถูกต้อง');
    if (kg == null || kg <= 0) fail('กรุณาระบุน้ำหนักที่ตรวจ');
    if (['frozen', 'transit'].includes(z)) fail('เปลี่ยนความสุกได้เฉพาะสินค้าสดในคลัง/หน้าร้าน/หลังร้าน');
    const no = nextNo('RIP');   // เปลี่ยนความสุกไม่ลดยอดรวมของ Lot จึงไม่ตรวจยอดจอง · ยอดของช่องนั้นพอหรือไม่ move() ตรวจ
    const c = ins('ripeness_checks', { doc_no: no, lot_id: lot, site_id: sid, zone: z, from_ripeness: f, to_ripeness: t, kg: R2(kg), baskets: bk,
      note: txt(p, 'note'), evidence: txt(p, 'evidence'), checked_by: u.id, checked_at: p.checked_at ? new Date(p.checked_at).toISOString() : nowIso() });
    const r = move(sid, z, lot, f, -kg, -bk, 0, 'RIPEN_OUT', 'RIPENESS', c.id, no, u.id, txt(p, 'note'), txt(p, 'evidence'));
    move(sid, z, lot, t, kg, -r.d_baskets, 0, 'RIPEN_IN', 'RIPENESS', c.id, no, u.id, txt(p, 'note'), txt(p, 'evidence'));
    return { id: c.id, doc_no: no };
  };
  A.api_movements = (p) => {
    const u = cur(); const q = txt(p, 'q')?.toLowerCase();
    return db.movements.filter((m) => canSee(u, m.site_id) && (num(p, 'lot_id') == null || m.lot_id === num(p, 'lot_id')) && (num(p, 'site_id') == null || m.site_id === num(p, 'site_id'))
      && (!txt(p, 'mtype') || m.mtype === p.mtype) && inRange(m.occurred_at, txt(p, 'from'), txt(p, 'to'))
      && (!q || like(byId('lots', m.lot_id).code, q) || like(m.doc_no, q)))
      .sort((a, b) => b.id - a.id).slice(off(p), off(p) + lim(p, 500))
      .map((m) => { const l = byId('lots', m.lot_id); return { id: m.id, mtype: m.mtype, doc_type: m.doc_type, doc_id: m.doc_id, doc_no: m.doc_no, lot_id: m.lot_id,
        lot_code: l.code, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, site: site(m.site_id).name,
        site_id: m.site_id, zone: m.zone, ripeness: m.ripeness, d_kg: m.d_kg, d_baskets: m.d_baskets, d_bags: m.d_bags, before_kg: m.before_kg,
        after_kg: m.after_kg, occurred_at: m.occurred_at, recorded_at: m.recorded_at, actor: uname(m.actor_id), approver: uname(m.approver_id),
        counterparty: m.counterparty, reason: m.reason, evidence: m.evidence }; });
  };
  A.api_lot_trace = (p) => {
    cur();
    const l = db.lots.find((x) => x.id === num(p, 'lot_id') || (txt(p, 'code') && x.code === txt(p, 'code').toUpperCase()));
    if (!l) fail('ไม่พบ Lot');
    const root = l.parent_lot_id ? byId('lots', l.parent_lot_id) : l;
    const tu = cur(); const br = tu.role === 'branch'; const mine = (...ids) => !br || ids.includes(tu.site_id);
    if (br && !db.movements.some((m) => m.site_id === tu.site_id && m.lot_id === l.id)
      && !db.dispatch_lines.some((dl) => dl.lot_id === l.id && byId('dispatches', dl.dispatch_id).to_site_id === tu.site_id)) fail('ไม่มีสิทธิ์ดู Lot นี้');
    const ev = [];
    db.receipt_lines.filter((rl) => rl.lot_id === root.id).forEach((rl) => { const r = byId('receipts', rl.receipt_id);
      ev.push({ at: r.received_at, seq: '1', kind: 'receive', title: 'รับเข้าจากสวน',
        detail: `${byId('suppliers', r.supplier_id).name} · ${r.doc_no} · สุทธิ ${fmt(rl.net_kg)} กก. รับจริง ${fmt(rl.accepted_kg ?? rl.net_kg)} กก.${rl.rejected_kg > 0 ? ' (คัดออก ' + fmt(rl.rejected_kg) + ' กก.)' : ''}`,
        doc_no: r.doc_no, status: r.status, actor: uname(r.checked_by) }); });
    db.ripeness_checks.filter((c) => c.lot_id === l.id && mine(c.site_id)).forEach((c) => ev.push({ at: c.checked_at, seq: '2', kind: 'ripeness', title: 'ตรวจความสุก',
      detail: `${ripL(c.from_ripeness)} → ${ripL(c.to_ripeness)} · ${fmt(c.kg)} กก. · ผู้ตรวจ: ${uname(c.checked_by) || '-'} · ${site(c.site_id).name}`, doc_no: c.doc_no, evidence: c.evidence }));
    db.dispatch_lines.filter((dl) => dl.lot_id === l.id).forEach((dl) => { const d = byId('dispatches', dl.dispatch_id);
      if (!mine(d.from_site_id, d.to_site_id)) return;
      if (d.shipped_at) ev.push({ at: d.shipped_at, seq: '3', kind: 'ship', title: d.kind === 'sale' ? 'ตีออกขาย ' + byId('customers', d.customer_id).name : 'ตีออกไป ' + site(d.to_site_id).name,
        detail: `${d.doc_no} · ส่ง ${fmt(dl.kg)} กก.${dl.baskets > 0 ? ' / ' + dl.baskets + ' ตะกร้า' : ''}`, doc_no: d.doc_no, dispatch_id: d.id });
      if (d.received_at) { const part = dl.received_kg < dl.kg;
        ev.push({ at: d.received_at, seq: '4', kind: part ? 'partial' : 'arrive', title: part ? 'ปลายทางรับบางส่วน' : 'ปลายทางรับครบ',
          detail: `รับ ${fmt(dl.received_kg)} กก.${part ? ' · ขาด ' + fmt(dl.kg - dl.received_kg) + ' กก.' : ''} · ผู้รับ: ${d.receiver_name || '-'}`, doc_no: d.doc_no, evidence: d.evidence, dispatch_id: d.id }); } });
    db.cases.filter((c) => c.lot_id === l.id && c.status === 'resolved' && mine(byId('dispatches', c.dispatch_id).from_site_id, byId('dispatches', c.dispatch_id).to_site_id)).forEach((c) => ev.push({ at: c.resolved_at, seq: '5', kind: 'case', title: 'สรุปส่วนต่าง ' + c.doc_no,
      detail: `${fmt(c.kg)} กก. → ${{ loss: 'สูญเสีย', return: 'ส่งคืนต้นทาง' }[c.outcome] || 'ส่งตามภายหลัง'}${c.resolve_note ? ' · ' + c.resolve_note : ''}`, doc_no: c.doc_no }));
    db.internal_transfers.filter((t) => t.lot_id === l.id && mine(t.site_id)).forEach((t) => ev.push({ at: t.created_at, seq: '6', kind: 'zone', title: 'โอนภายใน ' + site(t.site_id).name,
      detail: `${zoneL(t.from_zone)} → ${zoneL(t.to_zone)} · ${fmt(t.kg)} กก.`, doc_no: t.doc_no }));
    db.freezes.filter((f) => (f.source_lot_id === l.id || f.output_lot_id === l.id) && mine(f.site_id)).forEach((f) => ev.push({ at: f.created_at, seq: '7', kind: 'freeze', title: 'แปรรูปแช่แข็ง',
      detail: `ใช้ ${fmt(f.input_kg)} กก. ได้ ${fmt(f.output_kg)} กก. / ${f.bags} ถุง · สูญเสีย ${fmt(f.loss_kg)} กก. · Lot ใหม่ ${byId('lots', f.output_lot_id).code}`, doc_no: f.doc_no, lot_code: byId('lots', f.output_lot_id).code }));
    db.adjustments.filter((a) => a.lot_id === l.id && mine(a.site_id)).forEach((a) => ev.push({ at: a.decided_at || a.requested_at, seq: '8', kind: a.kind,
      title: ({ retail_sale: 'ขายหน้าร้าน', internal_use: 'นำไปใช้', waste: 'ตัดทิ้ง', shrinkage: 'ชั่งซ้ำ · น้ำหนักหายระหว่างบ่ม' }[a.kind] || 'ปรับยอด') + ({ pending: ' (รออนุมัติ)', rejected: ' (ไม่อนุมัติ)' }[a.status] || ''),
      detail: `${site(a.site_id).name} · ${fmt(a.kind === 'count_adjust' ? a.kg : Math.abs(a.kg))} กก. · ${a.reason || '-'}`, doc_no: a.doc_no }));
    db.invoice_lines.filter((il) => il.lot_id === l.id && !br).forEach((il) => { const i = byId('invoices', il.invoice_id);
      ev.push({ at: i.created_at, seq: '9', kind: 'invoice', title: 'ออกบิล ' + i.doc_no + (i.status === 'cancelled' ? ' (ยกเลิก)' : ''),
        detail: `${byId('customers', i.customer_id).name} · ${fmt(il.kg)} กก. × ${fmt(il.price)} บาท`, doc_no: i.doc_no, invoice_id: i.id }); });
    db.return_lines.filter((x) => x.lot_id === l.id).forEach((x) => { const rt = byId('returns', x.return_id); const d = byId('dispatches', rt.dispatch_id);
      if (br && ![d.from_site_id, rt.site_id].includes(tu.site_id)) return;
      ev.push({ at: rt.decided_at || rt.requested_at, seq: 'a', kind: x.disposition === 'discard' ? 'claim' : 'return',
        title: (x.disposition === 'discard' ? 'ลูกค้าเคลมเสียหาย' : 'ลูกค้าคืนสินค้า → เข้าสต็อก') + ({ pending: ' (รออนุมัติ)', rejected: ' (ไม่อนุมัติ)', cancelled: ' (ยกเลิก)' }[rt.status] || ''),
        detail: `${byId('customers', rt.customer_id).name} · ${fmt(x.kg)} กก. · ${rt.reason}`, doc_no: rt.doc_no, return_id: rt.id, evidence: rt.evidence }); });
    if (!br) db.credit_note_lines.filter((x) => x.lot_id === l.id).forEach((x) => { const n = byId('credit_notes', x.credit_note_id);
      ev.push({ at: n.created_at, seq: 'b', kind: 'credit', title: 'ใบลดหนี้ ' + n.doc_no + (n.status === 'cancelled' ? ' (ยกเลิก)' : ''),
        detail: `${byId('customers', n.customer_id).name} · ${fmt(x.kg)} กก. × ${fmt(x.price)} บาท · ${n.reason}`, doc_no: n.doc_no, credit_note_id: n.id }); });
    db.movements.filter((m) => m.lot_id === l.id && m.mtype === 'COUNT_ADJUST' && mine(m.site_id)).forEach((m) => ev.push({ at: m.occurred_at, seq: 'c', kind: 'stocktake',
      title: 'ปรับยอดจากการตรวจนับ ' + m.doc_no, detail: `${site(m.site_id).name} · ${zoneL(m.zone)} · ${m.d_kg > 0 ? '+' : ''}${fmt(m.d_kg)} กก.`, doc_no: m.doc_no }));
    ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq.localeCompare(b.seq)));
    const r = byId('receipts', root.receipt_id); const sp = r ? byId('suppliers', r.supplier_id) : null;
    const lj = lotJson(l.id); if (br) delete lj.unit_cost;
    return { ...lj, root: root.id !== l.id ? lotJson(root.id) : null,
      receipt: r ? { id: r.id, doc_no: r.doc_no, received_at: r.received_at, supplier: sp.name, contact: sp.contact, phone: sp.phone, province: sp.province } : null,
      balances: db.balances.filter((b) => b.lot_id === l.id && (b.kg !== 0 || b.bags > 0) && canSee(tu, b.site_id)).map((b) => ({ site: site(b.site_id).name, zone: b.zone, ripeness: b.ripeness, kg: b.kg, baskets: b.baskets, bags: b.bags })),
      destinations: db.dispatch_lines.filter((dl) => dl.lot_id === l.id).map((dl) => ({ dl, d: byId('dispatches', dl.dispatch_id) })).filter(({ d }) => d.status !== 'cancelled' && mine(d.from_site_id, d.to_site_id))
        .sort((a, b) => ((a.d.shipped_at || '~') < (b.d.shipped_at || '~') ? -1 : 1))
        .map(({ dl, d }) => { const c = byId('customers', d.customer_id); return { doc_no: d.doc_no, kind: d.kind, to: c?.name ?? site(d.to_site_id)?.name, channel: c?.channel ?? null, kg: dl.kg, received_kg: dl.received_kg, status: d.status }; }),
      children: db.lots.filter((c) => c.parent_lot_id === l.id).map((c) => ({ id: c.id, code: c.code })),
      open_cases: db.cases.filter((c) => c.lot_id === l.id && c.status === 'open').length,
      shrink_kg: R2(db.movements.filter((m) => m.lot_id === l.id && m.mtype === 'SHRINK' && mine(m.site_id)).reduce((a, m) => a - m.d_kg, 0)), events: ev };
  };

  // ---------- ตีออก ----------
  // รุ่น 2.5: กรอกน้ำหนักแยกความสุกเองได้ (ระบบปรับความสุกในสต็อกให้ตอนยืนยัน) · ตีออกเกินยอดได้ (Lot ติดลบ) เว้นแต่ปิดในตั้งค่า
  //           แก้ใบที่ตีออกแล้วแต่ปลายทางยังไม่รับได้ (กลับรายการเดิมแล้วตัดใหม่) · รายละเอียดทั้งใบ/ต่อรายการ
  const linesOf = (id) => db.dispatch_lines.filter((x) => x.dispatch_id === id).sort((a, b) => a.line_no - b.line_no);
  const dispatchShortages = (id) => {
    const d = byId('dispatches', id); const g = new Map();
    linesOf(id).forEach((dl) => g.set(dl.lot_id, R2((g.get(dl.lot_id) || 0) + dl.kg)));
    return [...g.entries()].map(([lot, need_]) => { const total = lotTotal(d.from_site_id, d.from_zone, lot); const free = lotFree(d.from_site_id, d.from_zone, lot, d.id);
      return { lot_id: lot, lot_code: byId('lots', lot).code, need_kg: need_, total_kg: total, reserved_kg: R2(total - free), free_kg: free, short_kg: R2(need_ - Math.max(free, 0)), after_kg: R2(total - need_) }; })
      .filter((x) => x.need_kg > x.free_kg).sort((a, b) => cmp(a.lot_code, b.lot_code));
  };
  const shortText = (sh) => sh.map((x) => `${x.lot_code} ขาด ${fmt(x.short_kg)} กก. (มี ${fmt(Math.max(x.free_kg, 0))} ขอ ${fmt(x.need_kg)}${x.reserved_kg > 0 ? ', ใบร่างอื่นจองไว้ ' + fmt(x.reserved_kg) : ''})`).join(' · ');
  // ด่านตรวจยอดก่อนตัดสต็อก: ปิด "ตีออกเกินยอด" = ห้ามจ่ายเกิน · เปิด = ผู้ยืนยันต้องรับทราบว่า Lot ใดจะติดลบ
  // confirm = true (ยืนยันโดยไม่ระบุรายการ) หรือ ข้อความรายการที่ผู้ยืนยันเห็นบนจอ — ถ้ายอดเปลี่ยนไปจากที่เห็น ระบบจะให้ยืนยันใหม่
  const shortGate = (sh, confirm) => {
    if (!sh.length) return;
    if (!allowNegative()) fail('ห้ามจ่ายเกินยอดพร้อมใช้: ' + shortText(sh));
    const ok = confirm === true || (typeof confirm === 'string' && confirm === shortText(sh));
    if (!ok) fail('ต้องยืนยันการตีออกเกินยอด (Lot จะติดลบ): ' + shortText(sh));
  };
  // ตัดสต็อกของใบตีออก: (1) ปรับความสุกให้ตรงกับที่กรอก (2) ตัดออกจากต้นทาง → เข้าระหว่างทาง (3) หักกลบยอดบวก/ลบใน Lot
  function dispatchPost(u, d, neg, at = null) {
    const dest = byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name; const lines = linesOf(d.id);
    G.noNet = true; G.allowNeg = !!neg;
    if (d.from_zone !== 'frozen') lines.filter((dl) => dl.ripeness !== 'na').forEach((dl) => {
      let short = R2(dl.kg - Math.max(bal(d.from_site_id, d.from_zone, dl.lot_id, dl.ripeness)?.kg || 0, 0));
      if (short <= 0) return;
      const t = RIP.indexOf(dl.ripeness);
      // ลำดับที่ดึงมาชดเชย: ความสุกที่ดิบกว่า (ใกล้ → ไกล) ก่อน แล้วจึงที่สุกกว่า (ใกล้ → ไกล)
      const cand = [...RIP.slice(0, t).reverse(), ...RIP.slice(t + 1)];
      // รอบ 1 เว้นยอดที่ใบร่างอื่นจองไว้ในความสุกนั้น · รอบ 2 (ยังไม่พอ) ใช้ได้ทั้งหมด เพราะการจองนับรวมระดับ Lot
      for (const pass of [1, 2]) for (const rk of cand) {
        if (short <= 0) break;
        const src = bal(d.from_site_id, d.from_zone, dl.lot_id, rk);
        if (!src || src.kg <= 0) continue;
        const own = lines.find((x) => x.lot_id === dl.lot_id && x.ripeness === rk)?.kg || 0;
        const c = Math.min(short, R2(src.kg - own - (pass === 1 ? reserved(d.from_site_id, d.from_zone, dl.lot_id, rk, d.id) : 0)));
        if (c <= 0) continue;
        const mv = Math.min(src.baskets, Math.round(src.baskets * c / src.kg));
        const why = `ปรับความสุกตอนตีออก: ${ripL(rk)} → ${ripL(dl.ripeness)}`;
        const r = move(d.from_site_id, d.from_zone, dl.lot_id, rk, -c, -mv, 0, 'RIPEN_OUT', 'DISPATCH', d.id, d.doc_no, u.id, why, null, u.id, dest, at);
        move(d.from_site_id, d.from_zone, dl.lot_id, dl.ripeness, c, -r.d_baskets, 0, 'RIPEN_IN', 'DISPATCH', d.id, d.doc_no, u.id, why, null, u.id, dest, at);
        short = R2(short - c);
      }
      if (short > 0 && !neg) fail(`ห้ามจ่ายเกินยอดพร้อมใช้: ${byId('lots', dl.lot_id).code} มีไม่พอ ขาด ${fmt(short)} กก.`);
    });
    lines.forEach((dl) => {
      move(d.from_site_id, d.from_zone, dl.lot_id, dl.ripeness, -dl.kg, -dl.baskets, -dl.bags, 'SHIP_OUT', 'DISPATCH', d.id, d.doc_no, u.id, d.note, null, u.id, dest, at);
      // ระหว่างทางรับตามจำนวนที่กรอกในใบ (จำนวนตะกร้า/ถุงในใบคือของที่ส่งจริง)
      move(d.from_site_id, 'transit', dl.lot_id, dl.ripeness, dl.kg, dl.baskets, dl.bags, 'TRANSIT_IN', 'DISPATCH', d.id, d.doc_no, u.id, d.note, null, u.id, dest, at);
    });
    G.allowNeg = false; G.noNet = false;
    [...new Set(lines.map((x) => x.lot_id))].sort((a, b) => a - b).forEach((lot) => netLot(d.from_site_id, d.from_zone, lot, u.id, d.id, d.doc_no, u.id, at));
  }
  // กลับรายการสต็อกของใบที่ตีออกแล้ว: หักล้างผลรวมของทุกรายการเคลื่อนไหวของใบนั้น
  function dispatchUnship(u, d) {
    const dest = byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name; const g = new Map();
    db.movements.filter((m) => m.doc_type === 'DISPATCH' && m.doc_id === d.id).forEach((m) => {
      const k = [m.site_id, m.zone, m.lot_id, m.ripeness, m.mtype].join('|');
      const x = g.get(k) || { site_id: m.site_id, zone: m.zone, lot_id: m.lot_id, ripeness: m.ripeness, mtype: m.mtype, kg: 0, bk: 0, bg: 0 };
      x.kg = R2(x.kg + m.d_kg); x.bk += m.d_baskets; x.bg += m.d_bags; g.set(k, x); });
    G.noNet = true; G.allowNeg = true;
    [...g.values()].filter((x) => x.kg !== 0 || x.bk !== 0 || x.bg !== 0)
      .sort((a, b) => ((b.zone === 'transit') - (a.zone === 'transit')) || a.kg - b.kg || a.lot_id - b.lot_id || cmp(a.ripeness, b.ripeness) || cmp(a.mtype, b.mtype))
      .forEach((x) => move(x.site_id, x.zone, x.lot_id, x.ripeness, -x.kg, -x.bk, -x.bg, x.mtype, 'DISPATCH', d.id, d.doc_no, u.id, 'แก้ไขใบตีออก: กลับรายการเดิม', null, u.id, dest, d.shipped_at));
    G.allowNeg = false; G.noNet = false;
  }
  function shipInternal(u, id) {
    const d = byId('dispatches', id); if (!d) fail('ไม่พบใบตีออก');
    if (d.status !== 'draft') fail('ใบตีออก ' + d.doc_no + ' ถูกยืนยันส่งไปแล้ว (กันกดซ้ำ)');
    if (!isApprover(u, d.from_site_id)) fail('ต้องให้ผู้จัดการคลัง/สาขา ผู้บริหาร หรือ Admin ยืนยันการตีออก');
    dispatchPost(u, d, allowNegative());
    Object.assign(d, { status: 'shipped', shipped_by: u.id, shipped_at: nowIso() });
    audit(u.id, 'ship', 'dispatch', d.id, null);
  }
  A.api_dispatch_save = (p) => {
    const u = cur(); const did = num(p, 'id'); let old = null; let reedit = false;
    const kind = p.kind || 'transfer'; const from = num(p, 'from_site_id'); let to = num(p, 'to_site_id'); let cust = num(p, 'customer_id');
    if (did != null) {
      old = byId('dispatches', did); if (!old) fail('ไม่พบใบตีออก');
      if (old.status === 'shipped') {
        // แก้ใบที่ตีออกแล้ว (ปลายทางยังไม่รับ): เฉพาะผู้ที่ยืนยันตีออกได้ และต้องมีเหตุผล
        reedit = true;
        if (!isApprover(u, old.from_site_id)) fail('ต้องให้ผู้จัดการคลัง/สาขา ผู้บริหาร หรือ Admin แก้ไขใบที่ตีออกแล้ว');
        if (!txt(p, 'edit_reason')) fail('กรุณาระบุเหตุผลที่แก้ไขใบที่ตีออกแล้ว');
        if (kind !== old.kind || from !== old.from_site_id || (txt(p, 'from_zone') || old.from_zone) !== old.from_zone) fail('ใบที่ตีออกแล้วเปลี่ยนประเภท/ต้นทางไม่ได้');
        const lids = linesOf(old.id).map((x) => x.id);
        if (db.cases.some((c) => c.dispatch_id === old.id) || db.invoice_lines.some((il) => lids.includes(il.dispatch_line_id)) || db.return_lines.some((rl) => lids.includes(rl.dispatch_line_id)))
          fail('ใบนี้มีเอกสารอ้างอิงแล้ว (ส่วนต่าง/บิล/รับคืน) จึงแก้ไขไม่ได้');
      } else if (old.status !== 'draft') fail('แก้ไขได้เฉพาะใบร่าง หรือใบที่ตีออกแล้วแต่ปลายทางยังไม่ยืนยันรับ');
    }
    if (!reedit) need(u, ['warehouse', 'branch']);
    const fk = site(from)?.kind; if (!fk) fail('กรุณาเลือกต้นทาง');
    if (!reedit) needSite(u, from);
    const fz = txt(p, 'from_zone') || (reedit ? old.from_zone : fk === 'warehouse' ? 'main' : 'back');
    if ((fk === 'warehouse' && !['main', 'frozen'].includes(fz)) || (fk === 'branch' && !['front', 'back', 'frozen'].includes(fz))) fail('จุดจัดเก็บต้นทางไม่ถูกต้อง');
    let tz = null;
    if (kind === 'transfer') {
      const tk = site(to)?.kind; if (!tk) fail('กรุณาเลือกสาขา/คลังปลายทาง');
      if (to === from) fail('ปลายทางต้องต่างจากต้นทาง (ย้ายภายในสาขาให้ใช้ใบโอนภายใน)');
      tz = txt(p, 'to_zone') || (fz === 'frozen' ? 'frozen' : tk === 'warehouse' ? 'main' : 'back'); checkZone(to, tz); cust = null;
    } else if (kind === 'sale') {
      if (cust == null || !byId('customers', cust)) fail('กรุณาเลือกลูกค้า / ช่องทางขาย'); to = null;
    } else fail('ประเภทใบตีออกไม่ถูกต้อง');
    if (!(p.lines || []).length) fail('กรุณาเลือก Lot อย่างน้อย 1 รายการ');
    const docDate = txt(p, 'doc_date') || today();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate)) fail('วันที่ไม่ถูกต้อง');
    if (docDate > bkkDate(Date.now() + 7 * 86400e3)) fail('วันที่ตีออกล่วงหน้าได้ไม่เกิน 7 วัน');
    let d; let pre = {}; let oldKg = 0; let touched = [];
    const vals = { kind, from_site_id: from, from_zone: fz, to_site_id: to, to_zone: tz, customer_id: cust, carrier: txt(p, 'carrier'), vehicle: txt(p, 'vehicle'), packer: txt(p, 'packer'), note: txt(p, 'note'),
      doc_date: docDate, ship_evidence: txt(p, 'ship_evidence'), details: txt(p, 'details') };
    if (did == null) d = ins('dispatches', { doc_no: nextNo(kind === 'sale' ? 'OUT' : 'TR'), ...vals, status: 'draft', created_by: u.id, created_at: nowIso(),
      shipped_by: null, shipped_at: null, receiver_name: null, received_by: null, received_at: null, receive_note: null, evidence: null,
      edited_by: null, edited_at: null, edit_reason: null });
    else { d = old;
      if (!reedit && !canAct(u, d.from_site_id)) fail('ไม่มีสิทธิ์แก้ไขใบตีออกของสถานที่อื่น');
      if (reedit) {
        // จำยอดรวมของ Lot ที่เกี่ยวข้องก่อนแก้ ไว้เทียบว่าการแก้ทำให้ Lot ใดติดลบมากขึ้นหรือไม่
        touched = [...new Set([...linesOf(d.id).map((x) => x.lot_id), ...p.lines.map((x) => num(x, 'lot_id')).filter((x) => x != null)])];
        touched.forEach((lot) => { if (db.balances.some((b) => b.site_id === d.from_site_id && b.zone === d.from_zone && b.lot_id === lot)) pre[lot] = lotTotal(d.from_site_id, d.from_zone, lot); });
        oldKg = R2(linesOf(d.id).reduce((a, x) => a + x.kg, 0));
        dispatchUnship(u, d);
      }
      Object.assign(d, vals);
      db.dispatch_lines = db.dispatch_lines.filter((x) => x.dispatch_id !== d.id); }
    p.lines.forEach((ln, idx) => {
      const i = idx + 1; const lot = db.lots.find((l) => l.id === num(ln, 'lot_id') && l.status === 'active'); const kg0 = num(ln, 'kg'); const kg = kg0 == null ? null : R2(kg0);
      if (!lot) fail(`รายการที่ ${i}: ไม่พบ Lot ที่ใช้งานได้`);
      const rip = lot.product === 'frozen' ? 'na' : ln.ripeness || 'raw';
      if (lot.product !== 'frozen' && !RIP.includes(rip)) fail(`รายการที่ ${i}: สถานะความสุกไม่ถูกต้อง`);
      if ((lot.product === 'frozen') !== (fz === 'frozen')) fail(`รายการที่ ${i}: สินค้าแช่แข็งต้องตีออกจากจุดแช่แข็ง`);
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุน้ำหนัก (กก.)`);
      if (db.dispatch_lines.some((x) => x.dispatch_id === d.id && x.lot_id === lot.id && x.ripeness === rip)) fail(`Lot ${lot.code} (${ripL(rip)}) ถูกเลือกซ้ำ`);
      if (!db.balances.some((b) => b.site_id === from && b.zone === fz && b.lot_id === lot.id)) fail(`Lot ${lot.code} ไม่เคยมีสต็อกที่จุดนี้ จึงตีออกจากที่นี่ไม่ได้`);
      if ((int(ln, 'pieces') ?? 0) < 0 || (int(ln, 'baskets') ?? 0) < 0 || (int(ln, 'bags') ?? 0) < 0) fail(`รายการที่ ${i}: จำนวนตะกร้า/ถุง/ลูกไม่ถูกต้อง`);
      ins('dispatch_lines', { dispatch_id: d.id, line_no: i, lot_id: lot.id, ripeness: rip, kg: R2(kg), baskets: int(ln, 'baskets') ?? 0, bags: int(ln, 'bags') ?? 0,
        received_kg: null, received_baskets: null, received_bags: null, billed_kg: 0, pieces: int(ln, 'pieces') || null, returned_kg: 0, detail: txt(ln, 'detail') });
    });
    if (reedit) {
      // ต้องยืนยัน (หรือถูกห้าม) เฉพาะ Lot ที่การแก้ครั้งนี้ทำให้ยอดลดลงกว่าก่อนแก้ — Lot ที่ติดลบอยู่เดิมและไม่แย่ลงแก้ได้เลย
      shortGate(dispatchShortages(d.id).filter((x) => x.after_kg < (pre[x.lot_id] ?? 0)), p.confirm_negative);
      dispatchPost(u, d, true, d.shipped_at);
      const now_ = new Set(linesOf(d.id).map((x) => x.lot_id));
      touched.filter((lot) => !now_.has(lot)).sort((a, b) => a - b).forEach((lot) => netLot(from, fz, lot, u.id, d.id, d.doc_no, u.id, d.shipped_at));
      // กันพลาดในโหมดห้ามจ่ายเกิน: หลังตัดสต็อกแล้ว Lot ที่เกี่ยวข้องต้องไม่ติดลบมากกว่าก่อนแก้
      if (!allowNegative()) { const bad = touched.filter((lot) => db.balances.some((b) => b.site_id === from && b.zone === fz && b.lot_id === lot) && lotTotal(from, fz, lot) < Math.min(pre[lot] ?? 0, 0)).map((lot) => byId('lots', lot).code);
        if (bad.length) fail('ห้ามจ่ายเกินยอดพร้อมใช้: ' + bad.join(', ')); }
      Object.assign(d, { edited_by: u.id, edited_at: nowIso(), edit_reason: txt(p, 'edit_reason') });
      audit(u.id, 'edit_shipped', 'dispatch', d.id, { reason: txt(p, 'edit_reason'), kg_before: oldKg, kg_after: R2(linesOf(d.id).reduce((a, x) => a + x.kg, 0)) });
    } else {
      if (!allowNegative()) shortGate(dispatchShortages(d.id), false);
      audit(u.id, did == null ? 'create' : 'update', 'dispatch', d.id, null);
      if (bool(p, 'ship', false)) {
        if (!isApprover(u, d.from_site_id)) fail('ต้องให้ผู้จัดการคลัง/สาขา ผู้บริหาร หรือ Admin ยืนยันการตีออก');
        shortGate(dispatchShortages(d.id), p.confirm_negative); shipInternal(u, d.id); }
    }
    return nocost(u, dispatchJson(d.id));
  };
  A.api_dispatch_ship = (p) => { const u = cur(); need(u, ['warehouse', 'branch', 'executive']); const d = byId('dispatches', num(p, 'id'));
    if (d && d.status === 'draft') {
      // ตรวจสิทธิ์ก่อนบอกยอดขาด (ผู้ใช้สถานที่อื่นต้องไม่เห็นยอดสต็อกจากข้อความ)
      if (!isApprover(u, d.from_site_id)) fail('ต้องให้ผู้จัดการคลัง/สาขา ผู้บริหาร หรือ Admin ยืนยันการตีออก');
      shortGate(dispatchShortages(d.id), p.confirm_negative); }
    shipInternal(u, num(p, 'id')); return nocost(u, dispatchJson(num(p, 'id'))); };
  // รายการ Lot สำหรับหน้าตีออก: 1 แถวต่อ Lot แยกยอดตามความสุก + ยอดว่างระดับ Lot (หักที่ใบร่างอื่นจองไว้)
  A.api_dispatch_lots = (p) => {
    const u = cur(); const sid = num(p, 'site_id'); const z = txt(p, 'zone') || 'main';
    if (sid == null || !canSee(u, sid)) fail('ไม่มีสิทธิ์ดูสต็อกของสถานที่นี้');
    const did = num(p, 'dispatch_id'); const dd = byId('dispatches', did);
    const back = dd && dd.status === 'shipped' && dd.from_site_id === sid && dd.from_zone === z ? dd.id : null;
    const zero = bool(p, 'include_zero', false); const days = Math.min(Math.max(int(p, 'days') ?? 30, 1), 365);
    const adj = new Map();
    if (back != null) db.movements.filter((m) => m.doc_type === 'DISPATCH' && m.doc_id === back && m.site_id === sid && m.zone === z).forEach((m) => {
      const k = m.lot_id + '|' + m.ripeness; const x = adj.get(k) || { kg: 0, bk: 0, bg: 0 }; x.kg = R2(x.kg + m.d_kg); x.bk += m.d_baskets; x.bg += m.d_bags; adj.set(k, x); });
    const lots = new Map();
    db.balances.filter((b) => b.site_id === sid && b.zone === z).forEach((b) => {
      const a = adj.get(b.lot_id + '|' + b.ripeness) || { kg: 0, bk: 0, bg: 0 };
      if (!lots.has(b.lot_id)) lots.set(b.lot_id, []);
      lots.get(b.lot_id).push({ ripeness: b.ripeness, kg: R2(b.kg - a.kg), baskets: Math.max(b.baskets - a.bk, 0), bags: Math.max(b.bags - a.bg, 0) }); });
    const resOf = (lot, rip) => R2(db.dispatch_lines.filter((dl) => { const x = byId('dispatches', dl.dispatch_id);
      return x.status === 'draft' && x.from_site_id === sid && x.from_zone === z && x.id !== did && dl.lot_id === lot && (rip == null || dl.ripeness === rip); }).reduce((a, dl) => a + dl.kg, 0));
    const since = Date.now() - days * 86400e3;
    return [...lots.entries()].map(([lotId, rows]) => {
      const l = byId('lots', lotId); const total = R2(rows.reduce((a, r) => a + r.kg, 0)); const rsv = resOf(lotId, null);
      return { l, total, top: Math.max(0, ...rows.filter((r) => r.kg > 0).map((r) => RIP_RANK[r.ripeness])),
        out: { lot_id: l.id, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
          supplier: byId('suppliers', l.supplier_id)?.name ?? null, received_at: l.received_at, age_days: ageDays(l), avg_g: l.avg_g ?? null,
          total_kg: total, reserved_kg: rsv, free_kg: R2(total - rsv), baskets: rows.reduce((a, r) => a + r.baskets, 0), bags: rows.reduce((a, r) => a + r.bags, 0),
          rip: rows.filter((r) => r.kg !== 0 || r.baskets > 0 || r.bags > 0).sort((a, b) => RIP_RANK[a.ripeness] - RIP_RANK[b.ripeness]).map((r) => ({ ...r, reserved_kg: resOf(lotId, r.ripeness) })) } }; })
      .filter(({ l, total, out }) => (l.product === 'frozen') === (z === 'frozen')
        && (total !== 0 || out.bags > 0 || (did != null && db.dispatch_lines.some((dl) => dl.dispatch_id === did && dl.lot_id === l.id))
          || (zero && l.status === 'active' && db.movements.some((m) => m.site_id === sid && m.zone === z && m.lot_id === l.id && new Date(m.recorded_at).getTime() > since))))
      .sort((a, b) => ((b.total > 0) - (a.total > 0)) || b.top - a.top || cmp(a.l.received_at, b.l.received_at) || a.l.id - b.l.id)
      .map((x) => x.out);
  };
  A.api_dispatch_cancel = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const d = byId('dispatches', num(p, 'id'));
    if (!d || d.status !== 'draft') fail('ยกเลิกได้เฉพาะใบตีออกที่ยังเป็นร่าง (ถ้าส่งแล้วให้ใช้การรับคืน/สรุปส่วนต่าง)');
    needSite(u, d.from_site_id);
    d.status = 'cancelled'; d.note = (d.note ? d.note + ' · ' : '') + 'ยกเลิก: ' + (txt(p, 'reason') || '-');
    audit(u.id, 'cancel', 'dispatch', d.id, p);
    return nocost(u, dispatchJson(d.id));
  };
  A.api_dispatch_receive = (p) => {
    const u = cur(); const d = byId('dispatches', num(p, 'id')); if (!d) fail('ไม่พบใบตีออก');
    if (d.status !== 'shipped') fail('ใบ ' + d.doc_no + ' ไม่ได้อยู่ในสถานะ "ส่งแล้ว รอรับ" (อาจรับไปแล้ว)');
    if (d.kind === 'transfer') { if (!(u.role === 'admin' || canAct(u, d.to_site_id))) fail('ต้องเป็นผู้ใช้ของสาขาปลายทางจึงยืนยันรับได้'); }
    else if (!(['admin', 'warehouse', 'sales'].includes(u.role) || canAct(u, d.from_site_id))) fail('ต้องเป็นคลัง ฝ่ายขาย หรือสาขาต้นทางจึงบันทึกการส่งมอบลูกค้าได้');
    if (!txt(p, 'receiver_name')) fail('กรุณาระบุชื่อผู้รับสินค้า');
    if ((setting('options').require_receive_photo ?? true) && !txt(p, 'evidence')) fail('กรุณาแนบรูปสภาพสินค้าเมื่อถึงปลายทาง');
    const src = site(d.from_site_id).name; const at = p.received_at ? new Date(p.received_at).toISOString() : nowIso(); let partial = false;
    // รายการที่ส่งมาต้องเป็นบรรทัดปัจจุบันของใบ (ใบถูกแก้ไขหลังเปิดหน้ารับ → เลขบรรทัดเปลี่ยน ต้องเปิดใบใหม่)
    const ids = new Set(linesOf(d.id).map((x) => x.id));
    if ((p.lines || []).some((x) => !ids.has(num(x, 'id')))) fail('ใบนี้ถูกแก้ไขหลังจากเปิดหน้ารับ กรุณาเปิดใบใหม่แล้วตรวจรับอีกครั้ง');
    db.dispatch_lines.filter((x) => x.dispatch_id === d.id).sort((a, b) => a.line_no - b.line_no).forEach((dl) => {
      const ln = (p.lines || []).find((x) => Number(x.id) === dl.id);
      const rk = num(ln, 'received_kg') ?? dl.kg; let rb = Math.min(int(ln, 'received_baskets') ?? dl.baskets, dl.baskets); let rg = Math.min(int(ln, 'received_bags') ?? dl.bags, dl.bags);
      if (rk < 0 || rk > dl.kg) fail(`บรรทัด ${dl.line_no}: น้ำหนักรับจริงต้องอยู่ระหว่าง 0 ถึง ${fmt(dl.kg)} กก.`);
      if (rk === 0) { rb = 0; rg = 0; }
      const r = move(d.from_site_id, 'transit', dl.lot_id, dl.ripeness, -rk, -rb, -rg, d.kind === 'sale' ? 'DELIVERED' : 'TRANSIT_OUT', 'DISPATCH', d.id, d.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, txt(p, 'receiver_name'), at);
      if (d.kind === 'transfer') move(d.to_site_id, d.to_zone, dl.lot_id, dl.ripeness, rk, -r.d_baskets, -r.d_bags, 'TRANSFER_IN', 'DISPATCH', d.id, d.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, src, at);
      Object.assign(dl, { received_kg: R2(rk), received_baskets: rb, received_bags: rg });
      if (rk < dl.kg) { partial = true;
        ins('cases', { doc_no: nextNo('CASE'), dispatch_id: d.id, dispatch_line_id: dl.id, lot_id: dl.lot_id, ripeness: dl.ripeness, kg: R2(dl.kg - rk),
          baskets: Math.max(dl.baskets - rb, 0), bags: Math.max(dl.bags - rg, 0), status: 'open', outcome: null, note: txt(ln, 'note') ?? txt(p, 'note'),
          resolve_note: null, evidence: null, created_at: nowIso(), resolved_by: null, resolved_at: null }); }
    });
    Object.assign(d, { status: partial ? 'partial' : 'received', receiver_name: txt(p, 'receiver_name'), received_by: u.id, received_at: at, receive_note: txt(p, 'note'), evidence: txt(p, 'evidence') });
    audit(u.id, 'receive', 'dispatch', d.id, { partial });
    return nocost(u, dispatchJson(d.id));
  };
  A.api_case_resolve = (p) => {
    const u = cur(); const c = byId('cases', num(p, 'id')); if (!c) fail('ไม่พบงานตรวจสอบ');
    if (c.status !== 'open') fail('งานนี้ปิดไปแล้ว');
    const d = byId('dispatches', c.dispatch_id);
    if (!(isApprover(u, d.from_site_id) || (d.to_site_id != null && isApprover(u, d.to_site_id)))) fail('ต้องเป็นผู้จัดการ ผู้บริหาร หรือ Admin จึงปิดงานส่วนต่างได้');
    const o = p.outcome; if (!['loss', 'return', 'late_delivery'].includes(o)) fail('กรุณาเลือกผลสรุป');
    if (!txt(p, 'note')) fail('กรุณาระบุเหตุผล');
    const dest = byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name;
    if (o === 'loss') move(d.from_site_id, 'transit', c.lot_id, c.ripeness, -c.kg, -c.baskets, -c.bags, 'CASE_LOSS', 'CASE', c.id, c.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, dest);
    else if (o === 'return') { const r = move(d.from_site_id, 'transit', c.lot_id, c.ripeness, -c.kg, -c.baskets, -c.bags, 'CASE_RETURN', 'CASE', c.id, c.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, dest);
      move(d.from_site_id, d.from_zone, c.lot_id, c.ripeness, c.kg, -r.d_baskets, -r.d_bags, 'RETURN_IN', 'CASE', c.id, c.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, dest); }
    else { const r = move(d.from_site_id, 'transit', c.lot_id, c.ripeness, -c.kg, -c.baskets, -c.bags, d.kind === 'sale' ? 'DELIVERED' : 'TRANSIT_OUT', 'CASE', c.id, c.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, dest);
      if (d.kind === 'transfer') move(d.to_site_id, d.to_zone, c.lot_id, c.ripeness, c.kg, -r.d_baskets, -r.d_bags, 'TRANSFER_IN', 'CASE', c.id, c.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence'), u.id, site(d.from_site_id).name);
      const dl = byId('dispatch_lines', c.dispatch_line_id); dl.received_kg = R2(dl.received_kg + c.kg); dl.received_baskets += c.baskets; dl.received_bags = (dl.received_bags || 0) + c.bags; }
    Object.assign(c, { status: 'resolved', outcome: o, resolve_note: txt(p, 'note'), evidence: txt(p, 'evidence'), resolved_by: u.id, resolved_at: nowIso() });
    if (!db.cases.some((x) => x.dispatch_id === d.id && x.status === 'open')) d.status = 'closed';
    audit(u.id, 'resolve', 'case', c.id, p);
    return nocost(u, dispatchJson(d.id));
  };
  A.api_dispatches = (p) => {
    const u = cur(); const q = txt(p, 'q')?.toLowerCase(); const sts = txt(p, 'status')?.split(',');
    return db.dispatches.filter((d) => (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id)))
      && (!sts || sts.includes(d.status)) && (!txt(p, 'kind') || d.kind === p.kind)
      && (num(p, 'site_id') == null || d.from_site_id === num(p, 'site_id') || d.to_site_id === num(p, 'site_id'))
      && (num(p, 'to_site_id') == null || d.to_site_id === num(p, 'to_site_id')) && (num(p, 'customer_id') == null || d.customer_id === num(p, 'customer_id'))
      && inRange(d.created_at, txt(p, 'from'), txt(p, 'to'))
      && (!q || like(d.doc_no, q) || like(byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name, q)
        || db.dispatch_lines.some((dl) => dl.dispatch_id === d.id && like(byId('lots', dl.lot_id).code, q))))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))
      .slice(off(p), off(p) + lim(p))
      .map((d) => { const { cases, ...j } = dispatchJson(d.id); return nocost(u, j); });
  };
  A.api_dispatch_get = (p) => { const u = cur(); const d = byId('dispatches', num(p, 'id')); if (!d || !(canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id)))) fail('ไม่มีสิทธิ์ดูเอกสารนี้'); return nocost(u, dispatchJson(d.id)); };
  A.api_cases = (p) => {
    const u = cur();
    return db.cases.map((c) => ({ c, d: byId('dispatches', c.dispatch_id) })).filter(({ c, d }) => (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id))) && (!txt(p, 'status') || c.status === p.status))
      .sort((a, b) => (a.c.status < b.c.status ? -1 : a.c.status > b.c.status ? 1 : a.c.created_at < b.c.created_at ? 1 : -1))
      .slice(off(p), off(p) + lim(p))
      .map(({ c, d }) => { const dl = byId('dispatch_lines', c.dispatch_line_id); const a = db.assignments.find((x) => x.entity === 'case' && x.entity_id === c.id);
        return { ...c, dispatch_no: d.doc_no, lot_code: byId('lots', c.lot_id).code, from_site: site(d.from_site_id).name,
        destination: byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name, shipped_kg: dl.kg, received_kg: dl.received_kg, resolved_by_name: uname(c.resolved_by),
        assignee_id: a?.assignee_id ?? null, assignee: a?.assignee_id ? uname(a.assignee_id) : null, due_at: a?.due_at ?? addH(c.created_at, threshold('task_due_hours', 24)) }; });
  };

  // ---------- สาขา ----------
  A.api_branch_stock = (p) => {
    const u = cur(); let sid = num(p, 'site_id') ?? u.site_id;
    if (sid == null) sid = db.sites.filter((s) => s.kind === 'branch' && s.active).sort((a, b) => a.sort - b.sort || a.id - b.id)[0]?.id;
    if (sid == null) return { site: null };
    if (!canSee(u, sid)) fail('ไม่มีสิทธิ์ดูสาขานี้');
    const zones = {};
    db.balances.filter((b) => b.site_id === sid && b.zone !== 'transit' && (b.kg !== 0 || b.bags > 0)).forEach((b) => {
      zones[b.zone] = zones[b.zone] || {}; const g = (zones[b.zone][b.ripeness] = zones[b.zone][b.ripeness] || { ripeness: b.ripeness, kg: 0, baskets: 0, bags: 0, _lots: new Set() });
      g.kg = R2(g.kg + b.kg); g.baskets += b.baskets; g.bags += b.bags; g._lots.add(b.lot_id); });
    const zout = {};
    Object.entries(zones).forEach(([z, g]) => { zout[z] = Object.values(g).map(({ _lots, ...x }) => ({ ...x, lots: _lots.size })).sort((a, b) => RIP_RANK[b.ripeness] - RIP_RANK[a.ripeness]); });
    return nocost(u, { site: { ...site(sid) }, zones: zout,
      incoming: db.dispatches.filter((d) => d.to_site_id === sid && ['shipped', 'partial'].includes(d.status)).sort((a, b) => (a.shipped_at < b.shipped_at ? -1 : 1)).map((d) => dispatchJson(d.id)),
      recent: db.dispatches.filter((d) => d.to_site_id === sid && ['received', 'closed'].includes(d.status)).sort((a, b) => (a.received_at < b.received_at ? 1 : -1)).slice(0, 10)
        .map((d) => { const { cases, ...j } = dispatchJson(d.id); return j; }),
      pending_adjustments: db.adjustments.filter((a) => a.site_id === sid && a.status === 'pending').length });
  };
  A.api_zone_transfer = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const sid = num(p, 'site_id'); needSite(u, sid);
    const fz = p.from_zone; const tz = p.to_zone; const lot = byId('lots', num(p, 'lot_id')); const kg = num(p, 'kg'); const sk = site(sid)?.kind;
    if (fz === tz) fail('จุดต้นทางและปลายทางต้องต่างกัน');
    if ((sk === 'branch' && (!['front', 'back', 'frozen'].includes(fz) || !['front', 'back', 'frozen'].includes(tz))) || (sk === 'warehouse' && (!['main', 'frozen'].includes(fz) || !['main', 'frozen'].includes(tz)))) fail('จุดจัดเก็บไม่ถูกต้องสำหรับสถานที่นี้');
    const fr = lot?.product === 'frozen';
    if (fr !== (tz === 'frozen') || fr !== (fz === 'frozen')) fail('สินค้าสดย้ายเข้าแช่แข็งต้องใช้ "แปรรูปแช่แข็ง" และสินค้าแช่แข็งอยู่ได้เฉพาะจุดแช่แข็ง');
    if (kg == null || kg <= 0) fail('กรุณาระบุน้ำหนัก');
    const rip = fr ? 'na' : p.ripeness || 'raw'; needFree(sid, fz, lot.id, rip, kg); const no = nextNo('ZT'); const bk = int(p, 'baskets') ?? 0; const bg = int(p, 'bags') ?? 0;
    const t = ins('internal_transfers', { doc_no: no, site_id: sid, from_zone: fz, to_zone: tz, lot_id: lot.id, ripeness: rip, kg: R2(kg), baskets: bk, bags: bg, note: txt(p, 'note'), created_by: u.id, created_at: nowIso() });
    const r = move(sid, fz, lot.id, rip, -kg, -bk, -bg, 'ZONE_OUT', 'ZONE', t.id, no, u.id, txt(p, 'note'));
    move(sid, tz, lot.id, rip, kg, -r.d_baskets, -r.d_bags, 'ZONE_IN', 'ZONE', t.id, no, u.id, txt(p, 'note'));
    return { id: t.id, doc_no: no };
  };
  A.api_freeze = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const sid = num(p, 'site_id'); needSite(u, sid);
    const fz = txt(p, 'from_zone') || 'back'; const src = byId('lots', num(p, 'lot_id')); const inkg = num(p, 'input_kg'); const outkg = num(p, 'output_kg'); const bags = int(p, 'bags');
    const rip = p.ripeness || 'ripe';
    if (!src || src.product !== 'fresh') fail('ต้องเลือก Lot สินค้าสดเป็นวัตถุดิบ');
    if (!['main', 'front', 'back'].includes(fz)) fail('จุดวัตถุดิบไม่ถูกต้อง');
    if (inkg == null || inkg <= 0) fail('กรุณาระบุน้ำหนักวัตถุดิบที่ใช้');
    if (outkg == null || outkg <= 0) fail('กรุณาระบุน้ำหนักผลผลิตที่ได้');
    if (outkg > inkg) fail('ผลผลิตต้องไม่มากกว่าวัตถุดิบ');
    if (bags == null || bags <= 0) fail('กรุณาระบุจำนวนถุง');
    checkZone(sid, fz); needFree(sid, fz, src.id, rip, inkg);
    const no = nextNo('FRZ'); const code = src.code + '-F' + (db.lots.filter((l) => l.parent_lot_id === src.id).length + 1);
    const nl = ins('lots', { code, product: 'frozen', variety_id: src.variety_id, size_id: src.size_id, supplier_id: src.supplier_id, receipt_id: src.receipt_id, parent_lot_id: src.id,
      received_at: nowIso(), unit_cost: Math.round(src.unit_cost * inkg / outkg * 10000) / 10000, status: 'active', created_at: nowIso() });
    const f = ins('freezes', { doc_no: no, site_id: sid, from_zone: fz, source_lot_id: src.id, ripeness: rip, input_kg: R2(inkg), input_baskets: int(p, 'input_baskets') ?? 0,
      output_kg: R2(outkg), bags, loss_kg: R2(inkg - outkg), output_lot_id: nl.id, note: txt(p, 'note'), created_by: u.id, created_at: nowIso() });
    move(sid, fz, src.id, rip, -inkg, -(int(p, 'input_baskets') ?? 0), 0, 'FREEZE_CONSUME', 'FREEZE', f.id, no, u.id, `ได้ ${fmt(outkg)} กก. / ${bags} ถุง · สูญเสีย ${fmt(inkg - outkg)} กก.`);
    move(sid, 'frozen', nl.id, 'na', outkg, 0, bags, 'FREEZE_PRODUCE', 'FREEZE', f.id, no, u.id, 'จาก ' + src.code);
    audit(u.id, 'create', 'freeze', f.id, p);
    return { id: f.id, doc_no: no, lot_code: code, loss_kg: R2(inkg - outkg) };
  };
  A.api_adjust_request = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const sid = num(p, 'site_id'); needSite(u, sid);
    const k = p.kind; if (!['retail_sale', 'internal_use', 'waste', 'count_adjust'].includes(k)) fail('ประเภทรายการไม่ถูกต้อง (น้ำหนักหายระหว่างบ่มให้ใช้ "ชั่งซ้ำ")');
    const z = txt(p, 'zone') || 'front'; const lot = byId('lots', num(p, 'lot_id')); if (!lot) fail('กรุณาเลือก Lot');
    const rip = lot.product === 'frozen' ? 'na' : p.ripeness || 'ripe'; let kg = num(p, 'kg');
    if (kg == null || kg === 0) fail('กรุณาระบุน้ำหนัก');
    let bk = int(p, 'baskets') ?? 0; let bg = int(p, 'bags') ?? 0;
    if (k !== 'count_adjust') { kg = -Math.abs(kg); bk = -Math.abs(bk); bg = -Math.abs(bg); }
    if (['waste', 'count_adjust'].includes(k) && !txt(p, 'reason')) fail('กรุณาระบุเหตุผล');
    if (k === 'waste' && (setting('options').require_waste_photo ?? true) && !txt(p, 'evidence')) fail('กรุณาแนบรูปสินค้าที่ตัดทิ้ง');
    checkZone(sid, z);
    if (kg < 0) needFree(sid, z, lot.id, rip, -kg);
    const a = ins('adjustments', { doc_no: nextNo({ retail_sale: 'POS', internal_use: 'USE', waste: 'WST' }[k] || 'ADJ'), kind: k, site_id: sid, zone: z, lot_id: lot.id, ripeness: rip,
      kg: R2(kg), baskets: bk, bags: bg, amount: num(p, 'amount'), reason: txt(p, 'reason'), evidence: txt(p, 'evidence'), status: 'pending', requested_by: u.id,
      requested_at: nowIso(), decided_by: null, decided_at: null, decision_note: null, ref_kg: null, measured_kg: null });
    if (['retail_sale', 'internal_use'].includes(k)) {
      move(sid, z, lot.id, rip, kg, bk, bg, k.toUpperCase(), 'ADJUST', a.id, a.doc_no, u.id, a.reason, a.evidence);
      Object.assign(a, { status: 'applied', decided_by: u.id, decided_at: nowIso() });
    }
    return { ...a };
  };
  A.api_adjust_decide = (p) => {
    const u = cur(); const a = byId('adjustments', num(p, 'id')); if (!a) fail('ไม่พบรายการ');
    if (a.status !== 'pending') fail('รายการนี้ได้รับการพิจารณาแล้ว');
    if (!isApprover(u, a.site_id)) fail('ต้องเป็นผู้จัดการสาขา/คลัง ผู้บริหาร หรือ Admin จึงอนุมัติได้');
    if (a.requested_by === u.id && u.role !== 'admin') fail('ผู้ขอไม่สามารถอนุมัติรายการของตัวเองได้');
    const ok = bool(p, 'approve', false);
    if (ok && a.kind === 'shrinkage' && (bal(a.site_id, a.zone, a.lot_id, a.ripeness)?.kg ?? null) !== a.ref_kg)
      fail('ยอด Lot นี้เปลี่ยนไปหลังชั่งซ้ำ (มีการเคลื่อนไหวหรือบันทึกอื่น) กรุณาไม่อนุมัติแล้วให้ชั่งใหม่');
    if (ok && a.kg < 0) needFree(a.site_id, a.zone, a.lot_id, a.ripeness, -a.kg);
    if (ok) move(a.site_id, a.zone, a.lot_id, a.ripeness, a.kg, a.baskets, a.bags, { waste: 'WASTE', shrinkage: 'SHRINK' }[a.kind] || 'ADJUST', 'ADJUST', a.id, a.doc_no, a.requested_by, a.reason, a.evidence, u.id);
    Object.assign(a, { status: ok ? 'applied' : 'rejected', decided_by: u.id, decided_at: nowIso(), decision_note: txt(p, 'note') });
    audit(u.id, ok ? 'approve' : 'reject', 'adjustment', a.id, p);
    return { ...a };
  };
  A.api_adjustments = (p) => {
    const u = cur();
    return db.adjustments.filter((a) => canSee(u, a.site_id) && (!txt(p, 'status') || a.status === p.status) && (num(p, 'site_id') == null || a.site_id === num(p, 'site_id')) && (!txt(p, 'kind') || a.kind === p.kind))
      .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1)).slice(off(p), off(p) + lim(p, 300))
      .map((a) => { const l = byId('lots', a.lot_id); return { ...a, site: site(a.site_id).name, lot_code: l.code, variety: byId('varieties', l.variety_id)?.name ?? null,
        size: byId('sizes', l.size_id)?.name ?? null, requested_by_name: uname(a.requested_by), decided_by_name: uname(a.decided_by) }; });
  };

  // ---------- ขาย ----------
  A.api_quote_save = (p) => {
    const u = cur(); need(u, ['sales', 'executive']); const cust = num(p, 'customer_id'); if (cust == null) fail('กรุณาเลือกลูกค้า');
    if (!(p.lines || []).length) fail('กรุณาเพิ่มรายการสินค้า');
    let q; const qid = num(p, 'id');
    if (qid == null) q = ins('quotes', { doc_no: nextNo('QT'), customer_id: cust, doc_date: txt(p, 'doc_date') || today(), valid_until: txt(p, 'valid_until'), status: 'draft',
      discount: 0, shipping: 0, vat_rate: 0, subtotal: 0, vat: 0, total: 0, note: txt(p, 'note'), created_by: u.id, created_at: nowIso() });
    else { q = byId('quotes', qid); if (!q || !['draft', 'sent'].includes(q.status)) fail('แก้ไขได้เฉพาะใบเสนอราคาที่ยังไม่ปิด');
      Object.assign(q, { customer_id: cust, doc_date: txt(p, 'doc_date') || q.doc_date, valid_until: txt(p, 'valid_until'), note: txt(p, 'note') });
      db.quote_lines = db.quote_lines.filter((x) => x.quote_id !== q.id); }
    let sub = 0;
    p.lines.forEach((ln, idx) => { const i = idx + 1; const kg = num(ln, 'kg'); const pr = num(ln, 'price');
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุจำนวน กก.`);
      checkPrice(u, cust, num(ln, 'variety_id'), num(ln, 'size_id'), txt(ln, 'product') || 'fresh', pr);
      ins('quote_lines', { quote_id: q.id, line_no: i, variety_id: num(ln, 'variety_id'), size_id: num(ln, 'size_id'), kg: R2(kg), price: pr, amount: R2(kg * pr) });
      sub += R2(kg * pr); });
    checkDiscount(u, sub, num(p, 'discount'), num(p, 'vat_rate'));
    Object.assign(q, totals(sub, num(p, 'discount'), num(p, 'shipping'), num(p, 'vat_rate')), { vat_rate: num(p, 'vat_rate') ?? 0, status: txt(p, 'status') || q.status });
    return quoteJson(q.id);
  };
  A.api_quote_status = (p) => { const u = cur(); need(u, ['sales', 'executive']); if (!['draft', 'sent', 'accepted', 'cancelled'].includes(p.status)) fail('สถานะไม่ถูกต้อง');
    const q = byId('quotes', num(p, 'id')); if (!q) fail('ไม่พบใบเสนอราคา');
    if (['accepted', 'cancelled'].includes(q.status)) fail('ใบเสนอราคานี้ปิดแล้ว เปลี่ยนสถานะไม่ได้');
    q.status = p.status; return quoteJson(q.id); };
  A.api_quotes = (p) => { company(cur()); return page(db.quotes.filter((q) => num(p, 'customer_id') == null || q.customer_id === num(p, 'customer_id'))
    .sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.id - a.id)), p).map((q) => { const { lines, ...j } = quoteJson(q.id); return j; }); };
  A.api_quote_get = (p) => { company(cur()); return quoteJson(num(p, 'id')); };
  A.api_billable = (p) => {
    company(cur());
    return db.dispatch_lines.map((dl) => ({ dl, d: byId('dispatches', dl.dispatch_id) }))
      .filter(({ dl, d }) => d.kind === 'sale' && ['received', 'partial', 'closed'].includes(d.status) && R2(dl.received_kg - (dl.returned_kg || 0)) > dl.billed_kg
        && (num(p, 'customer_id') == null || d.customer_id === num(p, 'customer_id')) && (num(p, 'dispatch_id') == null || d.id === num(p, 'dispatch_id')))
      .sort((a, b) => (a.d.received_at < b.d.received_at ? -1 : a.d.received_at > b.d.received_at ? 1 : a.d.id - b.d.id || a.dl.line_no - b.dl.line_no))
      .map(({ dl, d }) => { const l = byId('lots', dl.lot_id); const c = byId('customers', d.customer_id);
        return { dispatch_line_id: dl.id, dispatch_id: d.id, dispatch_no: d.doc_no, customer_id: d.customer_id, customer: c.name, channel: c.channel, delivered_at: d.received_at,
          lot_id: l.id, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, ripeness: dl.ripeness,
          shipped_kg: dl.kg, received_kg: dl.received_kg, returned_kg: dl.returned_kg || 0, billed_kg: dl.billed_kg, billable_kg: R2(dl.received_kg - (dl.returned_kg || 0) - dl.billed_kg),
          price: priceFor(d.customer_id, l.variety_id, l.size_id, l.product), min_price: priceRow(d.customer_id, l.variety_id, l.size_id, l.product)?.min_price ?? null,
          max_price: priceRow(d.customer_id, l.variety_id, l.size_id, l.product)?.max_price ?? null, unit_cost: l.unit_cost }; });
  };
  A.api_invoice_create = (p) => {
    const u = cur(); need(u, ['sales', 'executive']); const cust = num(p, 'customer_id'); if (cust == null) fail('กรุณาเลือกลูกค้า');
    if (!(p.lines || []).length) fail('กรุณาเลือกรายการจากใบตีออกที่ส่งมอบแล้ว');
    const type = txt(p, 'doc_type') || 'invoice'; if (!['invoice', 'tax_invoice', 'cash'].includes(type)) fail('ประเภทเอกสารไม่ถูกต้อง');
    const cu = byId('customers', cust); const co = setting('company');
    if (type === 'tax_invoice') {
      if ((num(p, 'vat_rate') ?? 0) !== 7) fail('ใบกำกับภาษีต้องคิด VAT 7%');
      if (!String(co.name ?? '').trim() || !String(co.address ?? '').trim() || !taxOk(co.tax_id)) fail('ใบกำกับภาษีต้องมีชื่อ ที่อยู่ และเลขผู้เสียภาษี 13 หลักของบริษัท (ตั้งค่า → ทั่วไป)');
      if (cu.address == null) fail('ใบกำกับภาษีต้องมีที่อยู่ของลูกค้า (แก้ไขข้อมูลลูกค้า)');
      if (cu.ctype === 'company' && !taxOk(cu.tax_id)) fail('ลูกค้านิติบุคคลต้องมีเลขผู้เสียภาษี 13 หลัก (แก้ไขข้อมูลลูกค้า)');
    }
    const inv = ins('invoices', { doc_no: nextNo({ tax_invoice: 'TIV', cash: 'CS' }[type] || 'INV'),
      title: { tax_invoice: 'ใบกำกับภาษี / ใบส่งของ / ใบแจ้งหนี้', cash: 'บิลเงินสด' }[type] || 'ใบส่งของ / ใบแจ้งหนี้', customer_id: cust, doc_date: txt(p, 'doc_date') || today(), status: 'issued',
      discount: 0, shipping: 0, vat_rate: 0, subtotal: 0, vat: 0, total: 0, cost_total: 0, note: txt(p, 'note'), created_by: u.id, created_at: nowIso(),
      cancel_reason: null, cancelled_by: null, cancelled_at: null, doc_type: type,
      seller: { name: co.name ?? null, address: co.address ?? null, tax_id: co.tax_id ?? null, phone: co.phone ?? null, branch: String(co.branch ?? '').trim() || 'สำนักงานใหญ่' },
      buyer: { name: cu.name, address: cu.address ?? null, tax_id: cu.tax_id ?? null, phone: cu.phone ?? null, ctype: cu.ctype, branch: cu.ctype === 'company' ? (cu.branch_no ?? 'สำนักงานใหญ่') : null } });
    let sub = 0; let cost = 0;
    p.lines.forEach((ln, idx) => { const i = idx + 1; const kg = num(ln, 'kg'); const pr = num(ln, 'price');
      const dl = byId('dispatch_lines', num(ln, 'dispatch_line_id')); if (!dl) fail(`รายการที่ ${i}: ไม่พบรายการส่งสินค้า`);
      const d = byId('dispatches', dl.dispatch_id);
      if (d.kind !== 'sale') fail('การโอนไปสาขาไม่ถือเป็นยอดขาย ออกบิลไม่ได้');
      if (d.customer_id !== cust) fail('รวมบิลได้เฉพาะใบตีออกของลูกค้ารายเดียวกัน');
      if (!['received', 'partial', 'closed'].includes(d.status)) fail(`ใบ ${d.doc_no} ยังไม่ได้ยืนยันส่งมอบ`);
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุจำนวน กก.`);
      const left = R2(dl.received_kg - (dl.returned_kg || 0) - dl.billed_kg);
      if (kg > left) fail(`ออกบิลเกินจำนวนที่ส่งมอบจริง: ${d.doc_no} คงเหลือให้ออกบิล ${fmt(Math.max(left, 0))} กก. (กันบิลซ้ำ)`);
      const l = byId('lots', dl.lot_id); const lp = checkPrice(u, cust, l.variety_id, l.size_id, l.product, pr);
      dl.billed_kg = R2(dl.billed_kg + kg);
      ins('invoice_lines', { invoice_id: inv.id, line_no: i, dispatch_line_id: dl.id, lot_id: dl.lot_id, kg: R2(kg), price: pr, list_price: lp ?? null, amount: R2(kg * pr), cost: R2(kg * l.unit_cost), credited_kg: 0 });
      sub += R2(kg * pr); cost += R2(kg * l.unit_cost); });
    checkDiscount(u, sub, num(p, 'discount'), num(p, 'vat_rate'));
    Object.assign(inv, totals(sub, num(p, 'discount'), num(p, 'shipping'), num(p, 'vat_rate')), { vat_rate: num(p, 'vat_rate') ?? 0, cost_total: R2(cost) });
    audit(u.id, 'create', 'invoice', inv.id, null);
    return invoiceJson(inv.id);
  };
  A.api_invoice_cancel = (p) => {
    const u = cur(); need(u, ['executive']); const inv = byId('invoices', num(p, 'id'));
    if (!inv || inv.status !== 'issued') fail('ยกเลิกได้เฉพาะบิลที่ออกแล้ว');
    if (!txt(p, 'reason')) fail('กรุณาระบุเหตุผลการยกเลิกบิล');
    if (db.credit_notes.some((n) => n.invoice_id === inv.id && n.status === 'issued')) fail('บิลนี้มีใบลดหนี้อยู่ ต้องยกเลิกใบลดหนี้ก่อน');
    db.invoice_lines.filter((il) => il.invoice_id === inv.id).forEach((il) => { const dl = byId('dispatch_lines', il.dispatch_line_id); dl.billed_kg = R2(dl.billed_kg - il.kg); });
    Object.assign(inv, { status: 'cancelled', cancel_reason: txt(p, 'reason'), cancelled_by: u.id, cancelled_at: nowIso() });
    audit(u.id, 'cancel', 'invoice', inv.id, p);
    return invoiceJson(inv.id);
  };
  A.api_invoices = (p) => {
    const u = cur(); need(u, ['sales', 'executive', 'warehouse']); const q = txt(p, 'q')?.toLowerCase();
    return page(db.invoices.filter((i) => (num(p, 'customer_id') == null || i.customer_id === num(p, 'customer_id')) && (!txt(p, 'status') || i.status === p.status)
      && (!txt(p, 'doc_type') || i.doc_type === p.doc_type)
      && inRange(i.doc_date, txt(p, 'from'), txt(p, 'to')) && (!q || like(i.doc_no, q) || like(byId('customers', i.customer_id).name, q)))
      .sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.id - a.id)), p).map((i) => { const { lines, ...j } = invoiceJson(i.id); return j; });
  };
  A.api_invoice_get = (p) => { const u = cur(); need(u, ['sales', 'executive', 'warehouse']);
    const id = num(p, 'id') ?? db.invoices.find((i) => i.doc_no === (txt(p, 'doc_no') || '').toUpperCase())?.id; return invoiceJson(id); };

  // ---------- แจ้งเตือน / แดชบอร์ด / รายงาน ----------
  function alerts(u) {
    const low = threshold('low_stock_kg', 200), near = threshold('near_ripe_days', 5), aging = threshold('aging_days', 7), pct = threshold('weight_variance_pct', 5),
      std = threshold('std_basket_kg', 20), hrs = threshold('receive_deadline_hours', 4); const res = [];
    const B = db.balances.map((b) => ({ ...b, l: byId('lots', b.lot_id), st: site(b.site_id) }));
    // ยอด Lot ติดลบ (ตีออกเกินยอดที่บันทึกไว้) รอเคลียร์
    const negs = new Map();
    B.filter((b) => b.zone !== 'transit').forEach((b) => { const k = b.site_id + '|' + b.zone + '|' + b.lot_id; const x = negs.get(k) || { b, kg: 0 }; x.kg = R2(x.kg + b.kg); negs.set(k, x); });
    [...negs.values()].filter((x) => x.kg < 0 && canSee(u, x.b.site_id)).sort((a, b) => a.kg - b.kg || cmp(a.b.l.code, b.b.l.code))
      .forEach(({ b, kg }) => res.push({ level: 'danger', kind: 'negative_stock', title: 'ยอด Lot ติดลบ รอเคลียร์', detail: `${b.l.code} · ${b.st.name} · ${zoneL(b.zone)} ติดลบ ${fmt(-kg)} กก.`,
        lot_id: b.l.id, lot_code: b.l.code, site_id: b.site_id, zone: b.zone, kg }));
    B.filter((b) => b.ripeness === 'overripe' && b.kg > 0 && b.zone !== 'transit' && canSee(u, b.site_id)).forEach((b) => res.push({ level: 'danger', kind: 'overripe', title: 'สุกมาก เร่งระบาย/พิจารณาตัดทิ้ง', detail: `${b.l.code} · ${b.st.name} · ${zoneL(b.zone)} ${fmt(b.kg)} กก.`, lot_id: b.l.id, lot_code: b.l.code }));
    B.filter((b) => b.ripeness === 'ripe' && b.kg > 0 && b.st.kind === 'warehouse' && b.zone === 'main' && canSee(u, b.site_id)).forEach((b) => res.push({ level: 'warn', kind: 'ripe', title: 'สุกแล้ว ควรจ่ายก่อน', detail: `${b.l.code} · ${b.st.name} ${fmt(b.kg)} กก.`, lot_id: b.l.id, lot_code: b.l.code }));
    B.filter((b) => ['raw', 'breaking'].includes(b.ripeness) && b.kg > 0 && ['main', 'front', 'back'].includes(b.zone) && canSee(u, b.site_id) && ageDays(b.l) >= near
      && !db.ripeness_checks.some((c) => c.lot_id === b.l.id && Date.now() - new Date(c.checked_at) < 86400e3))
      .forEach((b) => res.push({ level: 'info', kind: 'near_ripe', title: 'ใกล้สุก ควรตรวจความสุก', detail: `${b.l.code} · ${ripL(b.ripeness)} · ${b.st.name} · อายุ ${ageDays(b.l)} วัน`, lot_id: b.l.id, lot_code: b.l.code }));
    B.filter((b) => b.l.product === 'fresh' && b.kg > 0 && b.zone !== 'transit' && canSee(u, b.site_id) && ageDays(b.l) >= aging)
      .forEach((b) => res.push({ level: 'warn', kind: 'aging', title: 'ค้างคลังเกิน ' + aging + ' วัน', detail: `${b.l.code} · ${b.st.name} · ${fmt(b.kg)} กก. · อายุ ${ageDays(b.l)} วัน`, lot_id: b.l.id, lot_code: b.l.code }));
    if (u.role !== 'branch') db.varieties.filter((v) => v.active && db.lots.some((l) => l.variety_id === v.id)).forEach((v) => {
      const kg = R2(B.filter((b) => b.l.variety_id === v.id && b.st.kind === 'warehouse' && b.zone === 'main').reduce((a, b) => a + b.kg, 0));
      if (kg < low) res.push({ level: 'warn', kind: 'low_stock', title: 'สต็อกต่ำ', detail: `${v.name} เหลือ ${fmt(kg)} กก. (เกณฑ์ ${fmt(low)} กก.)` }); });
    if (u.role !== 'branch') db.receipt_lines.forEach((rl) => { const r = byId('receipts', rl.receipt_id);
      if (['pending_check', 'confirmed'].includes(r.status) && Date.now() - new Date(r.received_at) < 7 * 86400e3 && rl.baskets > 0 && std > 0 && Math.abs(rl.net_kg - rl.baskets * std) * 100 / (rl.baskets * std) > pct) {
        const l = byId('lots', rl.lot_id); res.push({ level: 'info', kind: 'weight', title: 'น้ำหนักรับเข้าต่างจากค่ามาตรฐาน', detail: `${r.doc_no} · ${l.code} · ${rl.baskets} ตะกร้า ชั่งได้ ${fmt(rl.net_kg)} กก. (มาตรฐาน ${fmt(rl.baskets * std)} กก.)`, lot_id: l.id, lot_code: l.code }); } });
    db.cases.filter((c) => c.status === 'open').forEach((c) => { const d = byId('dispatches', c.dispatch_id);
      if (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id))) { const l = byId('lots', c.lot_id);
        res.push({ level: 'danger', kind: 'case', title: 'รับไม่ครบ รอตรวจสอบส่วนต่าง', detail: `${d.doc_no} · ${l.code} ขาด ${fmt(c.kg)} กก.`, dispatch_id: d.id, lot_code: l.code, lot_id: l.id }); } });
    db.dispatches.filter((d) => d.status === 'shipped' && Date.now() - new Date(d.shipped_at) > hrs * 3600e3 && (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id))))
      .forEach((d) => { const t = new Date(new Date(d.shipped_at).getTime() + 7 * 3600e3).toISOString();
        res.push({ level: 'danger', kind: 'late', title: 'ปลายทางยังไม่ยืนยันรับเกิน ' + fmt(hrs) + ' ชม.', detail: `${d.doc_no} → ${byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name} · ส่งเมื่อ ${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`, dispatch_id: d.id }); });
    db.receipts.filter((r) => r.status === 'pending_check' && canSee(u, r.site_id)).forEach((r) => res.push({ level: 'info', kind: 'pending_receipt', title: 'รอตรวจรับจากสวน', detail: `${r.doc_no} · ${byId('suppliers', r.supplier_id).name}`, receipt_id: r.id }));
    db.adjustments.filter((a) => a.status === 'pending' && canSee(u, a.site_id)).forEach((a) => res.push({ level: 'info', kind: 'pending_adjust', title: 'รออนุมัติ' + (a.kind === 'waste' ? 'ตัดทิ้ง' : 'ปรับยอด'),
      detail: `${a.doc_no} · ${site(a.site_id).name} · ${fmt(a.kg)} กก. · ${a.reason || '-'}`, adjustment_id: a.id }));
    db.returns.filter((r) => r.status === 'pending' && (canSee(u, r.site_id) || canSee(u, byId('dispatches', r.dispatch_id).from_site_id)))
      .forEach((r) => res.push({ level: 'info', kind: 'pending_return', title: 'รออนุมัติรับคืน / เคลมจากลูกค้า', detail: `${r.doc_no} · ${byId('customers', r.customer_id).name} · ${r.reason}`, return_id: r.id }));
    if (u.role !== 'branch') db.returns.filter((r) => r.status === 'applied' && returnCreditKg(r.id) > 0)
      .forEach((r) => res.push({ level: 'warn', kind: 'credit_needed', title: 'ต้องออกใบลดหนี้', detail: `${r.doc_no} · ${byId('customers', r.customer_id).name} · คืน/เคลมส่วนที่ออกบิลแล้ว`, return_id: r.id }));
    if (['admin', 'executive', 'warehouse'].includes(u.role)) {
      db.purchase_orders.filter((po) => po.status === 'pending' && isApprover(u, po.site_id))
        .forEach((po) => res.push({ level: 'info', kind: 'pending_po', title: 'ใบสั่งซื้อรออนุมัติ', detail: `${po.doc_no} · ${byId('suppliers', po.supplier_id).name} · ${fmt(poValue(po.id))} บาท`, po_id: po.id }));
      const bm = budgetMonth(bkkDate(Date.now()).slice(0, 7));
      if (bm.pct != null && bm.pct >= 90) res.push({ level: bm.over ? 'danger' : 'warn', kind: 'budget_over', title: bm.over ? 'ยอดจัดซื้อเกินงบเดือนนี้' : 'ยอดจัดซื้อใกล้เต็มงบ',
        detail: `ใช้แล้ว ${bm.pct}% · รับแล้ว ${fmt(bm.received_value)} + รอรับ ${fmt(bm.open_po_value)} จากงบ ${fmt(bm.budget)} บาท`, month: bm.month });
    }
    db.stocktakes.filter((t) => t.status === 'submitted' && canSee(u, t.site_id))
      .forEach((t) => res.push({ level: 'info', kind: 'pending_stocktake', title: 'ผลตรวจนับรออนุมัติ', detail: `${t.doc_no} · ${site(t.site_id).name}`, stocktake_id: t.id }));
    tasks(u).filter((t) => t.overdue && t.entity !== 'dispatch_receive')
      .forEach((t) => res.push({ level: 'danger', kind: 'overdue', title: 'งานเกินกำหนด: ' + t.title, detail: `${t.doc_no} · ${t.site ?? '-'} · รอ ${t.assignee ?? t.who}`, task_entity: t.entity, task_id: t.entity_id }));
    return res;
  }
  A.api_alerts = () => alerts(cur());

  A.api_dashboard = () => {
    const u = cur(); const t = today();
    const B = db.balances.map((b) => ({ ...b, l: byId('lots', b.lot_id), st: site(b.site_id) }));
    const whB = B.filter((b) => b.st.kind === 'warehouse' && b.zone === 'main' && canSee(u, b.site_id));
    const wh = R2(whB.reduce((a, b) => a + b.kg, 0));
    const res = R2(db.dispatch_lines.filter((dl) => { const d = byId('dispatches', dl.dispatch_id); return d.status === 'draft' && site(d.from_site_id).kind === 'warehouse' && d.from_zone === 'main' && canSee(u, d.from_site_id); }).reduce((a, dl) => a + dl.kg, 0));
    const grp = (rows, key) => { const g = {}; rows.forEach((b) => { const k = key(b); g[k] = g[k] || { kg: 0, bk: 0 }; g[k].kg = R2(g[k].kg + b.kg); g[k].bk += b.baskets; }); return g; };
    const byRip = {}; whB.forEach((b) => { byRip[b.ripeness] = R2((byRip[b.ripeness] || 0) + b.kg); });
    const M = (types, f) => R2(db.movements.filter((m) => types.includes(m.mtype) && bkkDate(m.occurred_at) === t && canSee(u, m.site_id)).reduce((a, m) => a + f(m), 0));
    const inv = u.role === 'branch' ? [] : db.invoices.filter((i) => i.status === 'issued' && i.doc_date === t);
    const cnSub = u.role === 'branch' ? 0 : R2(db.credit_notes.filter((n) => n.status === 'issued' && n.doc_date === t).reduce((a, n) => a + n.subtotal, 0));
    const seeD = (d) => canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id));
    return {
      warehouse_kg: wh, reserved_kg: res, ready_kg: R2(wh - res),
      baskets: B.filter((b) => b.zone !== 'transit' && canSee(u, b.site_id)).reduce((a, b) => a + b.baskets, 0),
      transit_kg: R2(B.filter((b) => b.zone === 'transit' && canSee(u, b.site_id)).reduce((a, b) => a + b.kg, 0)),
      frozen_bags: B.filter((b) => b.zone === 'frozen' && canSee(u, b.site_id)).reduce((a, b) => a + b.bags, 0),
      lots_active: new Set(B.filter((b) => (b.kg > 0 || b.bags > 0) && b.zone !== 'transit' && canSee(u, b.site_id)).map((b) => b.lot_id)).size,
      by_ripeness: byRip,
      by_variety: Object.entries(grp(whB.filter((b) => b.kg !== 0), (b) => byId('varieties', b.l.variety_id)?.name || '-')).filter(([, x]) => x.kg > 0).map(([v, x]) => ({ variety: v, kg: x.kg, baskets: x.bk })).sort((a, b) => b.kg - a.kg),
      by_size: Object.entries(grp(whB.filter((b) => b.kg !== 0), (b) => byId('sizes', b.l.size_id)?.name || '-')).filter(([, x]) => x.kg > 0).map(([s, x]) => ({ size: s, kg: x.kg })).sort((a, b) => b.kg - a.kg),
      by_site: db.sites.filter((s) => s.active && canSee(u, s.id)).sort((a, b) => (a.kind === b.kind ? a.sort - b.sort || a.name.localeCompare(b.name) : a.kind === 'warehouse' ? -1 : 1))
        .map((s) => ({ site_id: s.id, site: s.name, kind: s.kind, kg: R2(B.filter((b) => b.site_id === s.id && b.zone !== 'transit').reduce((a, b) => a + b.kg, 0)),
          baskets: B.filter((b) => b.site_id === s.id && b.zone !== 'transit').reduce((a, b) => a + b.baskets, 0), bags: B.filter((b) => b.site_id === s.id && b.zone === 'frozen').reduce((a, b) => a + b.bags, 0) })),
      today: { in_kg: M(['RECEIVE'], (m) => m.d_kg), out_kg: M(['SHIP_OUT'], (m) => -m.d_kg), sales: R2(inv.reduce((a, i) => a + i.subtotal - i.discount, 0) - cnSub),
        gross_profit: R2(inv.reduce((a, i) => a + i.subtotal - i.discount - i.cost_total, 0) - cnSub), waste_kg: M(['WASTE', 'CASE_LOSS'], (m) => -m.d_kg) },
      queue: [
        { key: 'pending_receipt', title: 'รอตรวจรับจากสวน', sub: 'คลังต้องยืนยันน้ำหนักจริง', count: db.receipts.filter((r) => r.status === 'pending_check' && canSee(u, r.site_id)).length },
        { key: 'draft_dispatch', title: 'ใบตีออกรอผู้จัดการยืนยัน', sub: 'จองสต็อกไว้แล้ว ยังไม่ส่ง', count: db.dispatches.filter((d) => d.status === 'draft' && canSee(u, d.from_site_id)).length },
        { key: 'in_transit', title: 'ส่งแล้ว รอสาขารับ', sub: 'อยู่ระหว่างขนส่ง', count: db.dispatches.filter((d) => d.status === 'shipped' && (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id)))).length },
        { key: 'partial', title: 'รับบางส่วน', sub: 'รอตรวจสอบส่วนต่าง', count: db.cases.filter((c) => c.status === 'open' && seeD(byId('dispatches', c.dispatch_id))).length },
        { key: 'pending_adjust', title: 'รออนุมัติตัดทิ้ง / ปรับยอด', sub: 'ผู้จัดการต้องอนุมัติ', count: db.adjustments.filter((a) => a.status === 'pending' && canSee(u, a.site_id)).length },
        { key: 'to_bill', title: 'ส่งมอบแล้ว รอออกบิล', sub: 'ฝ่ายขายสร้างบิลจากใบตีออก',
          count: u.role === 'branch' ? 0 : new Set(db.dispatch_lines.filter((dl) => { const d = byId('dispatches', dl.dispatch_id); return d.kind === 'sale' && ['received', 'partial', 'closed'].includes(d.status) && R2(dl.received_kg - (dl.returned_kg || 0)) > dl.billed_kg; }).map((dl) => dl.dispatch_id)).size },
        { key: 'pending_return', title: 'รออนุมัติรับคืน / เคลม', sub: 'ผู้จัดการตรวจรูปและอนุมัติ', count: db.returns.filter((r) => r.status === 'pending' && (canSee(u, r.site_id) || canSee(u, byId('dispatches', r.dispatch_id).from_site_id))).length },
        { key: 'stocktake', title: 'ตรวจนับสต็อก', sub: 'นับให้ครบ → ผู้จัดการอนุมัติปรับยอด', count: db.stocktakes.filter((x) => ['draft', 'submitted'].includes(x.status) && canSee(u, x.site_id)).length },
      ],
      overdue_tasks: tasks(u).filter((x) => x.overdue).length,
      watch_lots: B.filter((b) => b.kg > 0 && b.l.product === 'fresh' && ['main', 'front', 'back'].includes(b.zone) && canSee(u, b.site_id))
        .sort((a, b) => RIP_RANK[b.ripeness] - RIP_RANK[a.ripeness] || (a.l.received_at < b.l.received_at ? -1 : 1)).slice(0, 8)
        .map((b) => ({ lot_id: b.l.id, lot_code: b.l.code, variety: byId('varieties', b.l.variety_id)?.name ?? null, size: byId('sizes', b.l.size_id)?.name ?? null,
          received_at: b.l.received_at, ripeness: b.ripeness, kg: b.kg, site: b.st.name, zone: b.zone, age_days: ageDays(b.l), urgency: RIP_RANK[b.ripeness] * 100 + ageDays(b.l) }))
        .sort((a, b) => b.urgency - a.urgency || (a.received_at < b.received_at ? -1 : 1)),
      alerts_count: alerts(u).length,
      open_cases: db.cases.filter((c) => c.status === 'open' && seeD(byId('dispatches', c.dispatch_id))).length,
    };
  };

  const COLS = {
    receipts: [['date', 'วันที่', 'date'], ['month', 'เดือน', null, 1], ['doc_no', 'เลขที่รับเข้า'], ['po', 'ใบสั่งซื้อ'], ['supplier', 'สวน', null, 1], ['province', 'จังหวัด', null, 1], ['lot', 'Lot'], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['ripeness', 'ความสุก', null, 1], ['baskets', 'ตะกร้า', 'num'], ['net_kg', 'ชั่งสุทธิ (กก.)', 'num'], ['rejected_kg', 'คัดออก (กก.)', 'num'], ['accepted_kg', 'รับจริง (กก.)', 'num'], ['unit_cost', 'ราคาซื้อ/กก.', 'money', 0, 1], ['cost', 'ต้นทุน (บาท)', 'money']],
    dispatches: [['date', 'วันที่ส่ง', 'date'], ['doc_no', 'เลขที่'], ['kind', 'ประเภท', null, 1], ['from', 'ต้นทาง', null, 1], ['destination', 'ปลายทาง', null, 1], ['channel', 'ช่องทาง', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['kg', 'ส่ง (กก.)', 'num'], ['received_kg', 'รับจริง (กก.)', 'num'], ['variance_kg', 'ส่วนต่าง (กก.)', 'num'], ['status', 'สถานะ', null, 1]],
    stock: [['site', 'สถานที่', null, 1], ['zone', 'จุดจัดเก็บ', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['ripeness', 'ความสุก', null, 1], ['received', 'รับเข้า', 'date'], ['age_days', 'อายุ (วัน)', 'num', 0, 1], ['kg', 'คงเหลือ (กก.)', 'num'], ['baskets', 'ตะกร้า', 'num'], ['bags', 'ถุง', 'num'], ['value', 'มูลค่าทุน (บาท)', 'money']],
    sales: [['date', 'วันที่บิล', 'date'], ['doc_no', 'เลขที่บิล'], ['customer', 'ลูกค้า', null, 1], ['channel', 'ช่องทาง', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['kg', 'กก.', 'num'], ['price', 'ราคา/กก.', 'money', 0, 1], ['amount', 'ยอดขาย (บาท)', 'money'], ['cost', 'ต้นทุน (บาท)', 'money'], ['gp', 'กำไรขั้นต้น (บาท)', 'money']],
    waste: [['date', 'วันที่', 'date'], ['doc_no', 'เอกสาร'], ['type', 'ประเภทสูญเสีย', null, 1], ['site', 'สถานที่', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['kg', 'สูญเสีย (กก.)', 'num'], ['reason', 'เหตุผล']],
    shrinkage: [['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['received', 'รับเข้า', 'date'], ['weighs', 'ชั่งซ้ำ (ครั้ง)', 'num'], ['received_kg', 'รับจริง (กก.)', 'num'], ['shrink_kg', 'น้ำหนักหาย (กก.)', 'num'], ['shrink_pct', 'หาย (%)', 'num', 0, 1], ['last_weigh', 'ชั่งล่าสุด', 'date']],
    returns: [['date', 'วันที่อนุมัติ', 'date'], ['doc_no', 'เลขที่'], ['customer', 'ลูกค้า', null, 1], ['channel', 'ช่องทาง', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['disposition', 'การจัดการ', null, 1], ['kg', 'กก.', 'num'], ['reason', 'เหตุผล'], ['credit_note', 'ใบลดหนี้']],
    movements: [['date', 'เวลาเกิดจริง', 'datetime'], ['mtype', 'ประเภท', null, 1], ['doc_no', 'เอกสาร'], ['lot', 'Lot'], ['site', 'สถานที่', null, 1], ['zone', 'จุด', null, 1], ['ripeness', 'ความสุก', null, 1], ['d_kg', 'เปลี่ยน (กก.)', 'num'], ['before_kg', 'ก่อน', 'num', 0, 1], ['after_kg', 'หลัง', 'num', 0, 1], ['actor', 'ผู้ทำ', null, 1], ['approver', 'ผู้อนุมัติ'], ['reason', 'เหตุผล']],
  };
  const cols = (k) => COLS[k].map(([key, label, type, dim, nosum]) => ({ key, label, ...(type ? { type } : {}), ...(dim ? { dim: true } : {}), ...(nosum ? { nosum: true } : {}) }));
  A.api_report = (p) => {
    const u = cur(); const k = p.kind || 'stock';
    const f = txt(p, 'from') || bkkDate(Date.now() - 30 * 86400e3); const t = txt(p, 'to') || today();
    const rootOf = (l) => (l.parent_lot_id ? byId('lots', l.parent_lot_id) : l);
    let rows = []; let c;
    if (k === 'receipts') { c = cols('receipts');
      db.receipt_lines.map((rl) => ({ rl, r: byId('receipts', rl.receipt_id) })).filter(({ r }) => r.status === 'confirmed' && inRange(r.received_at, f, t) && canSee(u, r.site_id))
        .sort((a, b) => (a.r.received_at < b.r.received_at ? -1 : a.r.received_at > b.r.received_at ? 1 : a.rl.line_no - b.rl.line_no))
        .forEach(({ rl, r }) => { const s = byId('suppliers', r.supplier_id); rows.push({ date: bkkDate(r.received_at), month: bkkDate(r.received_at).slice(0, 7), doc_no: r.doc_no, po: byId('purchase_orders', r.po_id)?.doc_no ?? null, supplier: s.name, province: s.province, lot: byId('lots', rl.lot_id).code,
          variety: byId('varieties', rl.variety_id).name, size: byId('sizes', rl.size_id).name, ripeness: ripL(rl.ripeness), baskets: rl.baskets, net_kg: rl.net_kg, rejected_kg: rl.rejected_kg,
          accepted_kg: rl.accepted_kg, unit_cost: rl.unit_cost, cost: R2(rl.accepted_kg * rl.unit_cost) }); });
    } else if (k === 'dispatches') { c = cols('dispatches');
      const dd = (d) => d.doc_date || bkkDate(d.shipped_at);
      db.dispatch_lines.map((dl) => ({ dl, d: byId('dispatches', dl.dispatch_id) })).filter(({ d }) => d.shipped_at && inRange(dd(d), f, t) && (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id))))
        .sort((a, b) => (dd(a.d) < dd(b.d) ? -1 : dd(a.d) > dd(b.d) ? 1 : a.d.shipped_at < b.d.shipped_at ? -1 : a.d.shipped_at > b.d.shipped_at ? 1 : a.dl.line_no - b.dl.line_no))
        .forEach(({ dl, d }) => { const l = byId('lots', dl.lot_id); const cu = byId('customers', d.customer_id);
          rows.push({ date: dd(d), doc_no: d.doc_no, kind: d.kind === 'sale' ? 'ขาย' : 'โอนสาขา', from: site(d.from_site_id).name, destination: cu?.name ?? site(d.to_site_id)?.name,
            channel: cu?.channel ?? 'สาขา', lot: l.code, supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
            kg: dl.kg, received_kg: dl.received_kg, variance_kg: dl.received_kg == null ? null : R2(dl.kg - dl.received_kg), status: d.status }); });
    } else if (['stock', 'branch', 'aging'].includes(k)) { c = cols('stock');
      rows = db.balances.map((b) => ({ b, l: byId('lots', b.lot_id), st: site(b.site_id) }))
        .filter(({ b, l, st }) => (b.kg !== 0 || b.bags > 0) && canSee(u, b.site_id) && (k !== 'branch' || st.kind === 'branch') && (k !== 'aging' || (l.product === 'fresh' && b.zone !== 'transit')))
        .map(({ b, l, st }) => ({ _k: st.kind, site: st.name, zone: zoneL(b.zone), lot: l.code, supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null,
          size: byId('sizes', l.size_id)?.name ?? null, ripeness: ripL(b.ripeness), received: bkkDate(l.received_at), age_days: ageDays(l), kg: b.kg, baskets: b.baskets, bags: b.bags, value: R2(b.kg * l.unit_cost) }))
        .sort((a, b) => (k === 'aging' ? b.age_days - a.age_days : 0) || (a._k < b._k ? 1 : a._k > b._k ? -1 : 0) || a.site.localeCompare(b.site) || a.zone.localeCompare(b.zone) || a.lot.localeCompare(b.lot))
        .map(({ _k, ...x }) => x);
    } else if (k === 'sales') { c = cols('sales'); need(u, ['sales', 'executive', 'warehouse']);
      db.invoice_lines.map((il) => ({ il, i: byId('invoices', il.invoice_id) })).filter(({ i }) => i.status === 'issued' && inRange(i.doc_date, f, t))
        .sort((a, b) => (a.i.doc_date < b.i.doc_date ? -1 : a.i.doc_date > b.i.doc_date ? 1 : a.i.id - b.i.id || a.il.line_no - b.il.line_no))
        .forEach(({ il, i }) => { const l = byId('lots', il.lot_id); const cu = byId('customers', i.customer_id);
          rows.push({ date: i.doc_date, doc_no: i.doc_no, customer: cu.name, channel: cu.channel, lot: l.code, supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null,
            variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, kg: il.kg, price: il.price, amount: il.amount, cost: il.cost, gp: R2(il.amount - il.cost), _k: [i.doc_date, 0, i.id, il.line_no] }); });
      db.credit_note_lines.map((x) => ({ x, n: byId('credit_notes', x.credit_note_id) })).filter(({ n }) => n.status === 'issued' && inRange(n.doc_date, f, t))
        .forEach(({ x, n }) => { const l = byId('lots', x.lot_id); const cu = byId('customers', n.customer_id);
          rows.push({ date: n.doc_date, doc_no: n.doc_no, customer: cu.name, channel: cu.channel, lot: l.code, supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null,
            variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, kg: -x.kg, price: x.price, amount: -x.amount, cost: 0, gp: -x.amount, _k: [n.doc_date, 1, n.id, x.line_no] }); });
      rows = rows.sort((a, b) => (a._k[0] < b._k[0] ? -1 : a._k[0] > b._k[0] ? 1 : a._k[1] - b._k[1] || a._k[2] - b._k[2] || a._k[3] - b._k[3])).map(({ _k, ...r }) => r);
    } else if (k === 'waste') { c = cols('waste');
      db.movements.filter((m) => ['WASTE', 'CASE_LOSS'].includes(m.mtype) && inRange(m.occurred_at, f, t) && canSee(u, m.site_id)).forEach((m) => { const l = byId('lots', m.lot_id);
        rows.push({ date: bkkDate(m.occurred_at), doc_no: m.doc_no, type: m.mtype === 'WASTE' ? 'ตัดทิ้ง/เน่าเสีย' : 'สูญหายระหว่างขนส่ง', site: site(m.site_id).name, lot: l.code,
          supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, kg: R2(-m.d_kg), reason: m.reason }); });
      db.movements.filter((m) => (m.mtype === 'SHRINK' || (m.mtype === 'COUNT_ADJUST' && m.d_kg < 0)) && inRange(m.occurred_at, f, t) && canSee(u, m.site_id)).forEach((m) => { const l = byId('lots', m.lot_id);
        rows.push({ date: bkkDate(m.occurred_at), doc_no: m.doc_no, type: m.mtype === 'SHRINK' ? 'น้ำหนักหายระหว่างบ่ม (ชั่งซ้ำ)' : 'ตรวจนับขาด', site: site(m.site_id).name, lot: l.code,
          supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, kg: R2(-m.d_kg), reason: m.reason }); });
      db.return_lines.map((x) => ({ x, r: byId('returns', x.return_id) })).filter(({ x, r }) => r.status === 'applied' && x.disposition === 'discard' && inRange(r.decided_at, f, t) && canSee(u, r.site_id))
        .forEach(({ x, r }) => { const l = byId('lots', x.lot_id);
          rows.push({ date: bkkDate(r.decided_at), doc_no: r.doc_no, type: 'ลูกค้าเคลมเสียหาย', site: site(r.site_id).name, lot: l.code,
            supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, kg: x.kg, reason: r.reason }); });
      db.freezes.filter((fr) => inRange(fr.created_at, f, t) && canSee(u, fr.site_id)).forEach((fr) => { const l = byId('lots', fr.source_lot_id);
        rows.push({ date: bkkDate(fr.created_at), doc_no: fr.doc_no, type: 'สูญเสียจากแปรรูป (เปลือก/เมล็ด)', site: site(fr.site_id).name, lot: l.code,
          supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, kg: fr.loss_kg, reason: fr.note }); });
      db.receipt_lines.map((rl) => ({ rl, r: byId('receipts', rl.receipt_id) })).filter(({ rl, r }) => r.status === 'confirmed' && rl.rejected_kg > 0 && inRange(r.received_at, f, t) && canSee(u, r.site_id))
        .forEach(({ rl, r }) => rows.push({ date: bkkDate(r.received_at), doc_no: r.doc_no, type: 'คัดออกตอนรับเข้า', site: site(r.site_id).name, lot: byId('lots', rl.lot_id).code,
          supplier: byId('suppliers', r.supplier_id).name, variety: byId('varieties', rl.variety_id).name, kg: rl.rejected_kg, reason: rl.note }));
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    } else if (k === 'shrinkage') { c = cols('shrinkage');
      const g = {};
      db.movements.filter((m) => m.mtype === 'SHRINK' && inRange(m.occurred_at, f, t) && canSee(u, m.site_id)).forEach((m) => {
        const x = (g[m.lot_id] = g[m.lot_id] || { n: 0, sk: 0, last: '' }); x.n++; x.sk = R2(x.sk - m.d_kg); const d = bkkDate(m.occurred_at); if (d > x.last) x.last = d; });
      rows = Object.entries(g).map(([lid, x]) => { const l = byId('lots', Number(lid)); const rk = R2(db.receipt_lines.filter((rl) => rl.lot_id === l.id).reduce((a, rl) => a + (rl.accepted_kg || 0), 0));
        return { lot: l.code, supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
          received: bkkDate(l.received_at), weighs: x.n, received_kg: rk, shrink_kg: x.sk, shrink_pct: rk > 0 ? R2(x.sk * 100 / rk) : null, last_weigh: x.last }; })
        .sort((a, b) => b.shrink_kg - a.shrink_kg || a.lot.localeCompare(b.lot));
    } else if (k === 'returns') { c = cols('returns');
      rows = db.return_lines.map((x) => ({ x, r: byId('returns', x.return_id) }))
        .filter(({ r }) => r.status === 'applied' && inRange(r.decided_at, f, t) && (canSee(u, r.site_id) || canSee(u, byId('dispatches', r.dispatch_id).from_site_id)))
        .sort((a, b) => (a.r.decided_at < b.r.decided_at ? -1 : a.r.decided_at > b.r.decided_at ? 1 : a.r.id - b.r.id || a.x.line_no - b.x.line_no))
        .map(({ x, r }) => { const l = byId('lots', x.lot_id); const cu = byId('customers', r.customer_id);
          return { date: bkkDate(r.decided_at), doc_no: r.doc_no, customer: cu.name, channel: cu.channel, lot: l.code, supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null,
            variety: byId('varieties', l.variety_id)?.name ?? null, disposition: x.disposition === 'restock' ? 'คืนเข้าสต็อก' : 'เสียหาย (เคลม)', kg: x.kg, reason: r.reason,
            credit_note: u.role !== 'branch' ? byId('credit_notes', r.credit_note_id)?.doc_no ?? null : null }; });
    } else if (k === 'movements') { c = cols('movements');
      rows = db.movements.filter((m) => inRange(m.occurred_at, f, t) && canSee(u, m.site_id)).sort((a, b) => a.id - b.id)
        .map((m) => ({ date: m.occurred_at, mtype: m.mtype, doc_no: m.doc_no, lot: byId('lots', m.lot_id).code, site: site(m.site_id).name, zone: zoneL(m.zone), ripeness: ripL(m.ripeness),
          d_kg: m.d_kg, before_kg: m.before_kg, after_kg: m.after_kg, actor: uname(m.actor_id), approver: uname(m.approver_id), reason: m.reason }));
    } else fail('ประเภทรายงานไม่ถูกต้อง');
    if (u.role === 'branch') { c = c.filter((x) => !['value', 'cost', 'unit_cost', 'gp', 'credit_note'].includes(x.key)); rows = stripCost(rows); }
    return { kind: k, from: f, to: t, columns: c, rows };
  };

  // ---------- ชั่งซ้ำ (Shrinkage) ----------
  A.api_reweigh = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const sid = num(p, 'site_id'); needSite(u, sid);
    const z = txt(p, 'zone') || 'main'; checkZone(sid, z);
    const lot = byId('lots', num(p, 'lot_id')); const rip = txt(p, 'ripeness') || 'raw'; const w = num(p, 'weighed_kg'); const lmt = threshold('shrink_auto_pct', 3);
    if (!lot) fail('กรุณาเลือก Lot');
    if (lot.product !== 'fresh' || z === 'frozen') fail('ชั่งซ้ำใช้กับสินค้าสดเท่านั้น');
    if (w == null || w < 0) fail('กรุณากรอกน้ำหนักที่ชั่งได้');
    const sysk = bal(sid, z, lot.id, rip)?.kg || 0;
    if (sysk <= 0) fail('ไม่มียอด Lot นี้ในจุดที่เลือก');
    if (w >= sysk) fail(`น้ำหนักชั่งซ้ำ (${fmt(w)} กก.) ไม่น้อยกว่ายอดในระบบ (${fmt(sysk)} กก.) · ถ้าต้องการเพิ่มยอดให้ใช้ "ปรับยอดตามนับจริง"`);
    if (db.adjustments.some((a) => a.kind === 'shrinkage' && a.status === 'pending' && a.site_id === sid && a.zone === z && a.lot_id === lot.id && a.ripeness === rip))
      fail('Lot นี้มีผลชั่งซ้ำที่รอผู้จัดการอนุมัติอยู่ ให้พิจารณารายการเดิมก่อน');
    const diff = R2(w - sysk); const pct = R2(-diff * 100 / sysk);
    const rls = db.receipt_lines.filter((x) => x.lot_id === lot.id && x.accepted_kg != null);
    const base = rls.length ? rls.reduce((a, x) => a + x.accepted_kg, 0) : sysk;
    const prior = R2(db.movements.filter((m) => m.lot_id === lot.id && m.mtype === 'SHRINK').reduce((a, m) => a - m.d_kg, 0));
    const auto = (prior - diff) * 100 / Math.max(base, sysk) <= lmt;
    const a = ins('adjustments', { doc_no: nextNo('RW'), kind: 'shrinkage', site_id: sid, zone: z, lot_id: lot.id, ripeness: rip, kg: diff, baskets: 0, bags: 0, amount: null,
      reason: `${txt(p, 'note') || 'ชั่งซ้ำระหว่างบ่ม'} (ระบบ ${fmt(sysk)} → ชั่งได้ ${fmt(w)} กก. หาย ${fmt(pct)}%)`, evidence: txt(p, 'evidence'), status: 'pending',
      requested_by: u.id, requested_at: nowIso(), decided_by: null, decided_at: null, decision_note: null, ref_kg: R2(sysk), measured_kg: R2(w) });
    if (auto) {
      needFree(sid, z, lot.id, rip, -diff);
      move(sid, z, lot.id, rip, diff, 0, 0, 'SHRINK', 'ADJUST', a.id, a.doc_no, u.id, a.reason, a.evidence, u.id);
      Object.assign(a, { status: 'applied', decided_by: u.id, decided_at: nowIso(), decision_note: `บันทึกอัตโนมัติ: หาย ${fmt(pct)}% (สะสม ${fmt(prior - diff)} กก.) ไม่เกินเกณฑ์ ${fmt(lmt)}%` });
    }
    audit(u.id, 'reweigh', 'adjustment', a.id, p);
    return { ...a, pct, auto };
  };

  // ---------- รับคืน / เคลม ----------
  const creditedOf = (dlId) => db.invoice_lines.filter((il) => il.dispatch_line_id === dlId && byId('invoices', il.invoice_id).status === 'issued').reduce((s, il) => s + (il.credited_kg || 0), 0);
  const returnCreditKg = (rid) => {
    const r = byId('returns', rid); if (!r || r.status !== 'applied') return 0;
    return R2(db.return_lines.filter((x) => x.return_id === rid).reduce((a, x) => { const dl = byId('dispatch_lines', x.dispatch_line_id);
      return a + Math.max(0, Math.min(x.kg, dl.billed_kg + (dl.returned_kg || 0) - dl.received_kg - creditedOf(dl.id))); }, 0));
  };
  const returnJson = (id, company_ = true) => {
    const r = byId('returns', id); if (!r) return null; const c = byId('customers', r.customer_id); const d = byId('dispatches', r.dispatch_id);
    const lines = db.return_lines.filter((x) => x.return_id === r.id).sort((a, b) => a.line_no - b.line_no);
    const invs = new Map(); lines.forEach((x) => db.invoice_lines.filter((il) => il.dispatch_line_id === x.dispatch_line_id).forEach((il) => { const i = byId('invoices', il.invoice_id); invs.set(i.id, { id: i.id, doc_no: i.doc_no, status: i.status }); }));
    const j = { ...r, customer: c.name, channel: c.channel, site: site(r.site_id).name, dispatch_no: d.doc_no, from_site_id: d.from_site_id,
      requested_by_name: uname(r.requested_by), decided_by_name: uname(r.decided_by), credit_note_no: byId('credit_notes', r.credit_note_id)?.doc_no ?? null,
      credit_needed_kg: returnCreditKg(r.id), total_kg: R2(lines.reduce((a, x) => a + x.kg, 0)), invoices: [...invs.values()].sort((a, b) => a.id - b.id),
      lines: lines.map((x) => { const l = byId('lots', x.lot_id); const dl = byId('dispatch_lines', x.dispatch_line_id);
        return { ...x, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
          delivered_kg: dl.received_kg, returned_total_kg: dl.returned_kg || 0, ...(company_ ? { billed_kg: dl.billed_kg } : {}) }; }) };
    if (!company_) ['invoices', 'credit_note_no', 'credit_needed_kg', 'credit_note_id'].forEach((k) => delete j[k]);
    return j;
  };
  A.api_return_create = (p) => {
    const u = cur(); need(u, ['sales', 'warehouse', 'branch', 'executive']);
    const d = byId('dispatches', num(p, 'dispatch_id'));
    if (!d || d.kind !== 'sale') fail('รับคืนได้เฉพาะใบตีออกขายที่ส่งมอบแล้ว');
    if (!['received', 'partial', 'closed'].includes(d.status)) fail('ใบ ' + d.doc_no + ' ยังไม่ได้ยืนยันส่งมอบลูกค้า');
    if (u.role === 'branch' && !canAct(u, d.from_site_id)) fail('บันทึกรับคืนได้เฉพาะใบขายของสาขาตัวเอง');
    if (!txt(p, 'reason')) fail('กรุณาระบุเหตุผลการคืน / เคลม');
    if (!txt(p, 'evidence')) fail('กรุณาแนบรูปสินค้าที่คืน / เสียหาย');
    if (!(p.lines || []).length) fail('กรุณาระบุรายการที่คืน');
    const sid = num(p, 'site_id') ?? d.from_site_id; const z = txt(p, 'zone') || d.from_zone;
    if (sid !== d.from_site_id && !(['admin', 'executive'].includes(u.role) || canAct(u, sid))) fail('คืนเข้าได้เฉพาะสถานที่ต้นทางของใบขาย หรือสถานที่ที่คุณรับผิดชอบ');
    const r = ins('returns', { doc_no: nextNo('RT'), dispatch_id: d.id, customer_id: d.customer_id, site_id: sid, zone: z, status: 'pending', reason: txt(p, 'reason'),
      evidence: txt(p, 'evidence'), note: txt(p, 'note'), credit_note_id: null, requested_by: u.id, requested_at: nowIso(), decided_by: null, decided_at: null, decision_note: null });
    p.lines.forEach((ln, idx) => {
      const i = idx + 1; const dl = db.dispatch_lines.find((x) => x.id === num(ln, 'dispatch_line_id') && x.dispatch_id === d.id);
      if (!dl) fail(`รายการที่ ${i}: ไม่พบรายการในใบตีออกนี้`);
      const l = byId('lots', dl.lot_id); const kg = num(ln, 'kg'); const disp = txt(ln, 'disposition') || 'restock';
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุน้ำหนักที่คืน`);
      if (!['restock', 'discard'].includes(disp)) fail(`รายการที่ ${i}: เลือกคืนเข้าสต็อก หรือ เสียหาย`);
      const pend = db.return_lines.filter((x) => x.dispatch_line_id === dl.id && byId('returns', x.return_id).status === 'pending' && x.return_id !== r.id).reduce((a, x) => a + x.kg, 0)
        + db.return_lines.filter((x) => x.dispatch_line_id === dl.id && x.return_id === r.id).reduce((a, x) => a + x.kg, 0);
      const avail = R2((dl.received_kg || 0) - (dl.returned_kg || 0) - pend);
      if (kg > avail) fail(`คืนเกินจำนวนที่ลูกค้ารับไป: ${l.code} คืนได้อีก ${fmt(Math.max(avail, 0))} กก.`);
      let rip;
      if (l.product === 'frozen') rip = 'na';
      else { rip = txt(ln, 'ripeness') || dl.ripeness; if (!RIP.includes(rip)) fail(`รายการที่ ${i}: สถานะความสุกไม่ถูกต้อง`); }
      if ((int(ln, 'baskets') ?? 0) > (dl.received_baskets ?? dl.baskets) || (int(ln, 'bags') ?? 0) > (dl.received_bags ?? dl.bags)) fail(`รายการที่ ${i}: จำนวนตะกร้า/ถุงที่คืนเกินที่ลูกค้ารับไป`);
      if (disp === 'restock') { checkZone(sid, z); if ((l.product === 'frozen') !== (z === 'frozen')) fail(`รายการที่ ${i}: สินค้าแช่แข็งต้องคืนเข้าจุดแช่แข็ง และสินค้าสดต้องไม่เข้าจุดแช่แข็ง`); }
      ins('return_lines', { return_id: r.id, line_no: i, dispatch_line_id: dl.id, lot_id: dl.lot_id, kg: R2(kg), baskets: int(ln, 'baskets') ?? 0, bags: int(ln, 'bags') ?? 0, disposition: disp, ripeness: rip, note: txt(ln, 'note') });
    });
    audit(u.id, 'create', 'return', r.id, null);
    return returnJson(r.id, u.role !== 'branch');
  };
  A.api_return_decide = (p) => {
    const u = cur(); const r = byId('returns', num(p, 'id')); if (!r) fail('ไม่พบใบรับคืน');
    if (r.status !== 'pending') fail('ใบรับคืนนี้ได้รับการพิจารณาแล้ว');
    const d = byId('dispatches', r.dispatch_id);
    if (!isApprover(u, r.site_id)) fail('ต้องเป็นผู้จัดการของสถานที่ที่รับของคืน ผู้บริหาร หรือ Admin จึงอนุมัติรับคืนได้');
    if (r.requested_by === u.id && u.role !== 'admin') fail('ผู้ขอไม่สามารถอนุมัติรายการของตัวเองได้');
    const ok = bool(p, 'approve', false);
    if (!ok && !txt(p, 'note')) fail('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    if (ok) {
      const cname = byId('customers', r.customer_id).name;
      db.return_lines.filter((x) => x.return_id === r.id).sort((a, b) => a.line_no - b.line_no).forEach((x) => {
        const dl = byId('dispatch_lines', x.dispatch_line_id);
        if (R2((dl.returned_kg || 0) + x.kg) > (dl.received_kg || 0)) fail(`บรรทัด ${x.line_no}: คืนเกินจำนวนที่ลูกค้ารับไป`);
        dl.returned_kg = R2((dl.returned_kg || 0) + x.kg);
        if (x.disposition === 'restock') move(r.site_id, r.zone, x.lot_id, x.ripeness, x.kg, x.baskets, x.bags, 'CUST_RETURN', 'RETURN', r.id, r.doc_no, r.requested_by, r.reason, r.evidence, u.id, cname);
      });
    }
    Object.assign(r, { status: ok ? 'applied' : 'rejected', decided_by: u.id, decided_at: nowIso(), decision_note: txt(p, 'note') });
    audit(u.id, ok ? 'approve' : 'reject', 'return', r.id, p);
    return returnJson(r.id, u.role !== 'branch');
  };
  A.api_return_cancel = (p) => {
    const u = cur(); const r = byId('returns', num(p, 'id'));
    if (!r || r.status !== 'pending') fail('ยกเลิกได้เฉพาะใบรับคืนที่รออนุมัติ');
    if (!(r.requested_by === u.id || ['admin', 'executive'].includes(u.role) || isApprover(u, r.site_id))) fail('ไม่มีสิทธิ์ยกเลิกใบนี้');
    Object.assign(r, { status: 'cancelled', decision_note: txt(p, 'reason') || 'ยกเลิก', decided_by: u.id, decided_at: nowIso() });
    audit(u.id, 'cancel', 'return', r.id, p);
    return returnJson(r.id, u.role !== 'branch');
  };
  const seeReturn = (u, r) => canSee(u, r.site_id) || canSee(u, byId('dispatches', r.dispatch_id).from_site_id);
  A.api_returns = (p) => {
    const u = cur(); const sts = txt(p, 'status')?.split(',');
    return page(db.returns.filter((r) => seeReturn(u, r) && (!sts || sts.includes(r.status)) && (num(p, 'customer_id') == null || r.customer_id === num(p, 'customer_id'))
      && (num(p, 'dispatch_id') == null || r.dispatch_id === num(p, 'dispatch_id')))
      .sort((a, b) => (a.requested_at < b.requested_at ? 1 : a.requested_at > b.requested_at ? -1 : b.id - a.id)), p)
      .map((r) => { const { lines, ...j } = returnJson(r.id, u.role !== 'branch'); return j; });
  };
  A.api_return_get = (p) => { const u = cur(); const r = byId('returns', num(p, 'id')); if (!r) fail('ไม่พบใบรับคืน'); if (!seeReturn(u, r)) fail('ไม่มีสิทธิ์ดูเอกสารนี้'); return returnJson(r.id, u.role !== 'branch'); };

  // ---------- ใบลดหนี้ ----------
  const creditNoteJson = (id) => {
    const n = byId('credit_notes', id); if (!n) return null; const c = byId('customers', n.customer_id); const i = byId('invoices', n.invoice_id);
    return { ...n, customer: c.name, channel: c.channel, invoice_no: i.doc_no, invoice_date: i.doc_date, invoice_type: i.doc_type, invoice_title: i.title, invoice_total: i.total,
      return_no: byId('returns', n.return_id)?.doc_no ?? null, created_by_name: uname(n.created_by),
      lines: db.credit_note_lines.filter((x) => x.credit_note_id === n.id).sort((a, b) => a.line_no - b.line_no).map((x) => { const l = byId('lots', x.lot_id); const il = byId('invoice_lines', x.invoice_line_id);
        return { ...x, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, invoice_kg: il.kg, invoice_price: il.price }; }) };
  };
  A.api_credit_note_create = (p) => {
    const u = cur(); need(u, ['sales', 'executive']); const boss = ['admin', 'executive'].includes(u.role);
    const inv = byId('invoices', num(p, 'invoice_id'));
    if (!inv || inv.status !== 'issued') fail('ออกใบลดหนี้ได้เฉพาะบิลที่ออกแล้ว (ไม่ถูกยกเลิก)');
    if (!txt(p, 'reason')) fail('กรุณาระบุเหตุผลการลดหนี้');
    if (!(p.lines || []).length) fail('กรุณาเลือกรายการที่ลดหนี้');
    const rid = num(p, 'return_id'); let rt = null;
    if (rid == null && !boss) fail('ฝ่ายขายออกใบลดหนี้ได้เฉพาะที่อ้างอิงใบรับคืน/เคลมที่อนุมัติแล้ว (ลดหนี้กรณีอื่นให้ผู้บริหารออก)');
    if (rid != null) { rt = byId('returns', rid);
      if (!rt || rt.status !== 'applied') fail('ใบรับคืนต้องได้รับอนุมัติก่อน');
      if (rt.customer_id !== inv.customer_id) fail('ใบรับคืนกับบิลเป็นคนละลูกค้า');
      if (!boss && returnCreditKg(rid) <= 0) fail('ใบรับคืนนี้ไม่มียอดที่ต้องลดหนี้แล้ว'); }
    const factor = inv.subtotal > 0 ? (inv.subtotal - (inv.discount || 0)) / inv.subtotal : 1;
    const n = ins('credit_notes', { doc_no: nextNo('CN'), invoice_id: inv.id, customer_id: inv.customer_id, return_id: rid ?? null, doc_date: txt(p, 'doc_date') || today(),
      reason: txt(p, 'reason'), status: 'issued', vat_rate: inv.vat_rate, subtotal: 0, vat: 0, total: 0, seller: inv.seller ?? null, buyer: inv.buyer ?? null,
      created_by: u.id, created_at: nowIso(), cancel_reason: null, cancelled_by: null, cancelled_at: null });
    let sub = 0;
    p.lines.forEach((ln, idx) => { const i = idx + 1;
      const il = db.invoice_lines.find((x) => x.id === num(ln, 'invoice_line_id') && x.invoice_id === inv.id); if (!il) fail(`รายการที่ ${i}: ไม่พบรายการในบิลนี้`);
      const kg = num(ln, 'kg'); const pr = num(ln, 'price') ?? il.price;
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุ กก. ที่ลดหนี้`);
      if (kg > R2(il.kg - (il.credited_kg || 0))) fail(`รายการที่ ${i}: ลดหนี้ได้ไม่เกิน ${fmt(il.kg - (il.credited_kg || 0))} กก.`);
      if (pr < 0 || pr > il.price) fail(`รายการที่ ${i}: ราคาลดหนี้ต้องไม่เกินราคาในบิล (${fmt(il.price)} บาท/กก.)`);
      if (!boss) {
        if (pr !== il.price) fail(`รายการที่ ${i}: ราคาลดหนี้ต้องเท่ากับราคาในบิล (${fmt(il.price)} บาท/กก.) — ลดราคาเพิ่มให้ผู้บริหารออก`);
        if (!db.return_lines.some((x) => x.return_id === rid && x.dispatch_line_id === il.dispatch_line_id)) fail(`รายการที่ ${i}: ไม่ใช่สินค้าในใบรับคืนที่อ้างอิง`);
        const dl = byId('dispatch_lines', il.dispatch_line_id);
        const needDl = R2(dl.billed_kg + (dl.returned_kg || 0) - dl.received_kg - creditedOf(dl.id));
        if (kg > needDl) fail(`รายการที่ ${i}: ลดหนี้ได้ไม่เกินส่วนที่คืน/เคลมและออกบิลไปแล้ว (${fmt(Math.max(needDl, 0))} กก.)`);
      }
      il.credited_kg = R2((il.credited_kg || 0) + kg);
      ins('credit_note_lines', { credit_note_id: n.id, line_no: i, invoice_line_id: il.id, lot_id: il.lot_id, kg: R2(kg), price: pr, amount: R2(kg * pr * factor) });
      sub += R2(kg * pr * factor); });
    const prevCn = db.credit_notes.filter((x) => x.invoice_id === inv.id && x.status === 'issued' && x.id !== n.id).reduce((a, x) => a + x.subtotal, 0);
    if (sub + prevCn > inv.subtotal - (inv.discount || 0) + 0.005) fail(`ลดหนี้รวมเกินมูลค่าบิล (มูลค่าหลังส่วนลด ${fmt(inv.subtotal - (inv.discount || 0))} บาท)`);
    Object.assign(n, { subtotal: R2(sub), vat: R2(sub * n.vat_rate / 100), total: R2(sub * (1 + n.vat_rate / 100)) });
    if (rt) rt.credit_note_id = n.id;
    audit(u.id, 'create', 'credit_note', n.id, null);
    return creditNoteJson(n.id);
  };
  A.api_credit_note_cancel = (p) => {
    const u = cur(); need(u, ['executive']); const n = byId('credit_notes', num(p, 'id'));
    if (!n || n.status !== 'issued') fail('ยกเลิกได้เฉพาะใบลดหนี้ที่ออกแล้ว');
    if (!txt(p, 'reason')) fail('กรุณาระบุเหตุผลการยกเลิก');
    db.credit_note_lines.filter((x) => x.credit_note_id === n.id).forEach((x) => { const il = byId('invoice_lines', x.invoice_line_id); il.credited_kg = R2(il.credited_kg - x.kg); });
    db.returns.filter((r) => r.credit_note_id === n.id).forEach((r) => { r.credit_note_id = null; });
    Object.assign(n, { status: 'cancelled', cancel_reason: txt(p, 'reason'), cancelled_by: u.id, cancelled_at: nowIso() });
    audit(u.id, 'cancel', 'credit_note', n.id, p);
    return creditNoteJson(n.id);
  };
  A.api_credit_notes = (p) => { company(cur());
    return page(db.credit_notes.filter((n) => (num(p, 'customer_id') == null || n.customer_id === num(p, 'customer_id')) && (num(p, 'invoice_id') == null || n.invoice_id === num(p, 'invoice_id'))
      && inRange(n.doc_date, txt(p, 'from'), txt(p, 'to'))).sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.id - a.id)), p)
      .map((n) => { const { lines, ...j } = creditNoteJson(n.id); return j; }); };
  A.api_credit_note_get = (p) => { company(cur()); return creditNoteJson(num(p, 'id')); };

  // ---------- ตรวจนับสต็อก ----------
  const stocktakeJson = (id, cost = true) => {
    const t = byId('stocktakes', id); if (!t) return null; const st = site(t.site_id);
    const lines = db.stocktake_lines.filter((x) => x.stocktake_id === t.id);
    const counted = lines.filter((x) => x.counted_kg != null);
    const L = lines.map((x) => ({ x, l: byId('lots', x.lot_id) })).sort((a, b) => a.x.zone.localeCompare(b.x.zone) || a.l.code.localeCompare(b.l.code) || a.x.ripeness.localeCompare(b.x.ripeness));
    return { ...t, site: st.name, site_kind: st.kind, created_by_name: uname(t.created_by), submitted_by_name: uname(t.submitted_by), decided_by_name: uname(t.decided_by),
      line_count: lines.length, counted_count: counted.length, system_kg: R2(lines.reduce((a, x) => a + x.system_kg, 0)), counted_kg: R2(counted.reduce((a, x) => a + x.counted_kg, 0)),
      diff_kg: R2(counted.reduce((a, x) => a + x.counted_kg - (x.count_system_kg ?? x.system_kg), 0)),
      diff_value: cost ? R2(counted.reduce((a, x) => a + (x.counted_kg - (x.count_system_kg ?? x.system_kg)) * byId('lots', x.lot_id).unit_cost, 0)) : null,
      lines: L.map(({ x, l }) => ({ ...x, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
        received_at: l.received_at, avg_g: l.avg_g ?? null, diff_kg: x.counted_kg == null ? null : R2(x.counted_kg - (x.count_system_kg ?? x.system_kg)),
        current_kg: bal(t.site_id, x.zone, x.lot_id, x.ripeness)?.kg || 0, counted_by_name: uname(x.counted_by), unit_cost: cost ? l.unit_cost : null })) };
  };
  A.api_stocktake_start = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const sid = num(p, 'site_id'); needSite(u, sid); const z = txt(p, 'zone');
    if (z != null) checkZone(sid, z);
    const ex = db.stocktakes.find((t) => t.site_id === sid && ['draft', 'submitted'].includes(t.status));
    if (ex) fail('สถานที่นี้มีใบตรวจนับที่ยังไม่ปิดอยู่แล้ว (' + ex.doc_no + ')');
    const t = ins('stocktakes', { doc_no: nextNo('ST'), site_id: sid, zone: z ?? null, status: 'draft', note: txt(p, 'note'), created_by: u.id, created_at: nowIso(),
      submitted_by: null, submitted_at: null, decided_by: null, decided_at: null, decision_note: null });
    db.balances.filter((b) => b.site_id === sid && b.zone !== 'transit' && (z == null || b.zone === z) && (b.kg !== 0 || b.bags > 0))
      .forEach((b) => ins('stocktake_lines', { stocktake_id: t.id, zone: b.zone, lot_id: b.lot_id, ripeness: b.ripeness, system_kg: b.kg, system_baskets: b.baskets, system_bags: b.bags,
        counted_kg: null, counted_baskets: null, counted_bags: null, added: false, note: null, counted_by: null, counted_at: null, count_system_kg: null, count_system_baskets: null, count_system_bags: null }));
    audit(u.id, 'create', 'stocktake', t.id, p);
    return stocktakeJson(t.id, u.role !== 'branch');
  };
  A.api_stocktake_save = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const t = byId('stocktakes', num(p, 'id')); if (!t) fail('ไม่พบใบตรวจนับ');
    if (t.status !== 'draft') fail('แก้ผลนับได้เฉพาะใบที่ยังไม่ส่งอนุมัติ');
    needSite(u, t.site_id);
    const stamp = (z, lotId, rip) => { const b = bal(t.site_id, z, lotId, rip); return { counted_by: u.id, counted_at: nowIso(), count_system_kg: b?.kg || 0, count_system_baskets: b?.baskets || 0, count_system_bags: b?.bags || 0 }; };
    (p.lines || []).forEach((ln) => {
      const x = db.stocktake_lines.find((y) => y.id === num(ln, 'id') && y.stocktake_id === t.id); if (!x) return;
      const v = num(ln, 'counted_kg');
      if (v == null) { if (bool(ln, 'clear', false)) Object.assign(x, { counted_kg: null, counted_baskets: null, counted_bags: null, counted_by: null, counted_at: null, count_system_kg: null, count_system_baskets: null, count_system_bags: null }); return; }
      if (v < 0) fail('น้ำหนักที่นับต้องไม่ติดลบ');
      const cb = int(ln, 'counted_baskets'); const cg = int(ln, 'counted_bags');
      if (x.counted_kg !== R2(v) || (x.counted_baskets ?? null) !== (cb ?? null) || (x.counted_bags ?? null) !== (cg ?? null))
        Object.assign(x, { counted_kg: R2(v), counted_baskets: cb, counted_bags: cg, note: txt(ln, 'note') ?? x.note, ...stamp(x.zone, x.lot_id, x.ripeness) });
      else if (txt(ln, 'note') != null) x.note = txt(ln, 'note'); });
    (p.add || []).forEach((ln) => {
      const l = db.lots.find((x) => x.id === num(ln, 'lot_id') && x.status === 'active'); if (!l) fail('ไม่พบ Lot ที่ต้องการเพิ่ม');
      const z = txt(ln, 'zone') || t.zone; if (z == null) fail('กรุณาเลือกจุดจัดเก็บของรายการที่เพิ่ม');
      checkZone(t.site_id, z); if (t.zone != null && z !== t.zone) fail('จุดจัดเก็บต้องตรงกับใบตรวจนับ');
      const rip = l.product === 'frozen' ? 'na' : txt(ln, 'ripeness') || 'raw';
      if ((l.product === 'frozen') !== (z === 'frozen')) fail('สินค้าแช่แข็งอยู่ได้เฉพาะจุดแช่แข็ง');
      if (num(ln, 'counted_kg') == null || num(ln, 'counted_kg') < 0) fail('กรุณาระบุน้ำหนักที่นับได้');
      const b = bal(t.site_id, z, l.id, rip);
      const ex = db.stocktake_lines.find((x) => x.stocktake_id === t.id && x.zone === z && x.lot_id === l.id && x.ripeness === rip);
      const vals = { counted_kg: R2(num(ln, 'counted_kg')), counted_baskets: int(ln, 'counted_baskets'), counted_bags: int(ln, 'counted_bags'), note: txt(ln, 'note'), ...stamp(z, l.id, rip) };
      if (ex) Object.assign(ex, vals);
      else ins('stocktake_lines', { stocktake_id: t.id, zone: z, lot_id: l.id, ripeness: rip, system_kg: b?.kg || 0, system_baskets: b?.baskets || 0, system_bags: b?.bags || 0, ...vals, added: true });
    });
    if (txt(p, 'note')) t.note = txt(p, 'note');
    if (bool(p, 'submit', false)) {
      const miss = db.stocktake_lines.filter((x) => x.stocktake_id === t.id && x.counted_kg == null).length;
      if (miss > 0) fail(`ยังนับไม่ครบ ${miss} รายการ (ถ้าไม่พบของให้กรอก 0)`);
      Object.assign(t, { status: 'submitted', submitted_by: u.id, submitted_at: nowIso() });
    }
    return stocktakeJson(t.id, u.role !== 'branch');
  };
  A.api_stocktake_decide = (p) => {
    const u = cur(); const t = byId('stocktakes', num(p, 'id')); if (!t) fail('ไม่พบใบตรวจนับ');
    if (t.status !== 'submitted') fail('ใบตรวจนับนี้ยังไม่ส่งอนุมัติ หรือพิจารณาไปแล้ว');
    if (!isApprover(u, t.site_id)) fail('ต้องเป็นผู้จัดการ ผู้บริหาร หรือ Admin จึงอนุมัติผลตรวจนับได้');
    if ((t.submitted_by === u.id || t.created_by === u.id || db.stocktake_lines.some((x) => x.stocktake_id === t.id && x.counted_by === u.id)) && u.role !== 'admin') fail('ผู้นับไม่สามารถอนุมัติผลนับของตัวเองได้');
    const ok = bool(p, 'approve', false);
    if (!ok && !txt(p, 'note')) fail('กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    if (ok) {
      // ปรับทีละความสุกตามผลนับ (ปิดการหักกลบอัตโนมัติระหว่างปรับ) แล้วค่อยหักกลบยอดบวก/ลบที่ยังค้างใน Lot
      const sl = db.stocktake_lines.filter((x) => x.stocktake_id === t.id).sort((a, b) => a.zone.localeCompare(b.zone) || a.lot_id - b.lot_id || a.ripeness.localeCompare(b.ripeness));
      G.noNet = true;
      sl.forEach((x) => {
        const dk = R2(x.counted_kg - (x.count_system_kg ?? x.system_kg)); const dbk = x.counted_baskets == null ? 0 : x.counted_baskets - (x.count_system_baskets ?? x.system_baskets);
        const dg = x.counted_bags == null ? 0 : x.counted_bags - (x.count_system_bags ?? x.system_bags);
        move(t.site_id, x.zone, x.lot_id, x.ripeness, dk, dbk, dg, 'COUNT_ADJUST', 'STOCKTAKE', t.id, t.doc_no, t.submitted_by, x.note || 'ตรวจนับ', null, u.id);
      });
      G.noNet = false;
      [...new Set(sl.map((x) => x.zone + '|' + x.lot_id))].forEach((k) => { const [z, lot] = k.split('|'); netLot(t.site_id, z, Number(lot), t.submitted_by, t.id, t.doc_no, u.id); });
    }
    Object.assign(t, { status: ok ? 'approved' : 'rejected', decided_by: u.id, decided_at: nowIso(), decision_note: txt(p, 'note') });
    audit(u.id, ok ? 'approve' : 'reject', 'stocktake', t.id, p);
    return stocktakeJson(t.id, u.role !== 'branch');
  };
  A.api_stocktake_cancel = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const t = byId('stocktakes', num(p, 'id'));
    if (!t || !['draft', 'submitted'].includes(t.status)) fail('ยกเลิกได้เฉพาะใบตรวจนับที่ยังไม่ปิด');
    needSite(u, t.site_id);
    Object.assign(t, { status: 'cancelled', decision_note: txt(p, 'reason') || 'ยกเลิก', decided_by: u.id, decided_at: nowIso() });
    audit(u.id, 'cancel', 'stocktake', t.id, p);
    return stocktakeJson(t.id, u.role !== 'branch');
  };
  A.api_stocktakes = (p) => { const u = cur(); const sts = txt(p, 'status')?.split(',');
    return page(db.stocktakes.filter((t) => canSee(u, t.site_id) && (num(p, 'site_id') == null || t.site_id === num(p, 'site_id')) && (!sts || sts.includes(t.status)))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id)), p)
      .map((t) => { const { lines, ...j } = stocktakeJson(t.id, u.role !== 'branch'); return j; }); };
  A.api_stocktake_get = (p) => { const u = cur(); const t = byId('stocktakes', num(p, 'id')); if (!t) fail('ไม่พบใบตรวจนับ'); if (!canSee(u, t.site_id)) fail('ไม่มีสิทธิ์ดูเอกสารนี้'); return stocktakeJson(t.id, u.role !== 'branch'); };

  // ---------- คิวงานส่งต่อ ----------
  const canAssign = (u, ent, sid) => ['admin', 'executive'].includes(u.role) || (['bill', 'credit'].includes(ent) && u.role === 'sales') || (sid != null && isApprover(u, sid));
  function tasks(u) {
    const h = threshold('task_due_hours', 24); const rh = threshold('receive_deadline_hours', 4); const ch = threshold('receipt_check_hours', 4); const bh = threshold('bill_due_hours', 48);
    const T = []; const seeD = (d) => canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id));
    const push = (entity, id, doc_no, title, missing, who, site_id, created_at, dflt) => T.push({ entity, entity_id: id, doc_no, title, missing, who, site_id, created_at, dflt });
    db.receipts.filter((r) => r.status === 'pending_check' && canSee(u, r.site_id)).forEach((r) => push('receipt', r.id, r.doc_no, 'รอตรวจรับจากสวน', 'ชั่งน้ำหนักจริง คัดลูกช้ำออก แล้วกดยืนยันตรวจรับ', 'คลัง', r.site_id, r.updated_at, addH(r.updated_at, ch)));
    db.dispatches.filter((d) => d.status === 'draft' && canSee(u, d.from_site_id)).forEach((d) => push('dispatch', d.id, d.doc_no, 'ใบตีออกรอยืนยัน', 'ผู้จัดการตรวจ Lot/ความสุก แล้วกดยืนยันตีออก', 'ผู้จัดการต้นทาง', d.from_site_id, d.created_at, addH(d.created_at, h)));
    db.dispatches.filter((d) => d.status === 'shipped' && seeD(d)).forEach((d) => push('dispatch_receive', d.id, d.doc_no, d.kind === 'sale' ? 'รอบันทึกลูกค้ารับของ' : 'รอปลายทางยืนยันรับ',
      'ชั่งน้ำหนักจริง ถ่ายรูปสภาพสินค้า แล้วกดยืนยันรับ', byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name, d.to_site_id ?? d.from_site_id, d.shipped_at, addH(d.shipped_at, rh)));
    db.cases.filter((c) => c.status === 'open').forEach((c) => { const d = byId('dispatches', c.dispatch_id); if (!seeD(d)) return;
      push('case', c.id, c.doc_no, 'สรุปส่วนต่าง (รับไม่ครบ)', `ขาด ${fmt(c.kg)} กก. — เลือก สูญเสีย / ส่งคืน / ส่งตาม พร้อมเหตุผล`, 'ผู้จัดการ', d.to_site_id ?? d.from_site_id, c.created_at, addH(c.created_at, h)); });
    db.adjustments.filter((a) => a.status === 'pending' && canSee(u, a.site_id)).forEach((a) => push('adjustment', a.id, a.doc_no, 'รออนุมัติ' + ({ waste: 'ตัดทิ้ง', shrinkage: 'น้ำหนักหาย' }[a.kind] || 'ปรับยอด'),
      'ผู้จัดการตรวจรูปและเหตุผล แล้วอนุมัติ/ไม่อนุมัติ', 'ผู้จัดการ', a.site_id, a.requested_at, addH(a.requested_at, h)));
    db.returns.filter((r) => r.status === 'pending' && seeReturn(u, r)).forEach((r) => push('return', r.id, r.doc_no, 'รออนุมัติรับคืน / เคลม', 'ผู้จัดการตรวจรูปสินค้าที่คืน แล้วอนุมัติ', 'ผู้จัดการ', r.site_id, r.requested_at, addH(r.requested_at, h)));
    if (u.role !== 'branch') db.returns.filter((r) => r.status === 'applied' && returnCreditKg(r.id) > 0).forEach((r) => push('credit', r.id, r.doc_no, 'ต้องออกใบลดหนี้',
      `ของที่คืน/เคลม ${fmt(returnCreditKg(r.id))} กก. เคยออกบิลแล้ว — ออกใบลดหนี้อ้างอิงบิลเดิม`, 'ฝ่ายขาย', r.site_id, r.decided_at, addH(r.decided_at, h)));
    db.stocktakes.filter((s) => ['draft', 'submitted'].includes(s.status) && canSee(u, s.site_id)).forEach((s) => { const dr = s.status === 'draft'; const at = s.submitted_at || s.created_at;
      push('stocktake', s.id, s.doc_no, dr ? 'ตรวจนับสต็อก' : 'ผลตรวจนับรออนุมัติ', dr ? 'นับให้ครบทุกรายการ แล้วกดส่งอนุมัติ' : 'ผู้จัดการตรวจผลต่าง แล้วอนุมัติปรับยอด', dr ? 'พนักงานนับ' : 'ผู้จัดการ', s.site_id, at, addH(at, h)); });
    if (['admin', 'executive', 'warehouse'].includes(u.role)) db.purchase_orders.filter((po) => po.status === 'pending' && canSee(u, po.site_id)).forEach((po) =>
      push('po', po.id, po.doc_no, 'ใบสั่งซื้อรออนุมัติ', `${byId('suppliers', po.supplier_id).name} · ผู้จัดการ/ผู้บริหารตรวจราคาและปริมาณ แล้วอนุมัติ`, 'ผู้จัดการ/ผู้บริหาร', po.site_id, po.created_at, addH(po.created_at, h)));
    if (u.role !== 'branch') db.dispatches.filter((d) => d.kind === 'sale' && ['received', 'partial', 'closed'].includes(d.status)).forEach((d) => {
      const ls = db.dispatch_lines.filter((dl) => dl.dispatch_id === d.id && R2(dl.received_kg - (dl.returned_kg || 0)) > dl.billed_kg); if (!ls.length) return;
      push('bill', d.id, d.doc_no, 'ส่งมอบแล้ว รอออกบิล', `ค้างออกบิล ${fmt(ls.reduce((a, dl) => a + dl.received_kg - (dl.returned_kg || 0) - dl.billed_kg, 0))} กก.`, 'ฝ่ายขาย', d.from_site_id, d.received_at, addH(d.received_at, bh)); });
    const now = nowIso();
    return T.map((t) => { const a = db.assignments.find((x) => x.entity === t.entity && x.entity_id === t.entity_id); const due = a?.due_at ?? t.dflt;
      return { entity: t.entity, entity_id: t.entity_id, doc_no: t.doc_no, title: t.title, missing: t.missing, who: t.who ?? null, site_id: t.site_id ?? null, site: site(t.site_id)?.name ?? null,
        created_at: t.created_at, due_at: due, overdue: due < now, assignee_id: a?.assignee_id ?? null, assignee: a?.assignee_id ? uname(a.assignee_id) : null, assign_note: a?.note ?? null,
        can_assign: canAssign(u, t.entity, t.site_id) }; })
      .sort((a, b) => (a.due_at < b.due_at ? -1 : a.due_at > b.due_at ? 1 : a.doc_no.localeCompare(b.doc_no)));
  }
  A.api_tasks = (p) => { const u = cur();
    return tasks(u).filter((t) => (!bool(p, 'mine', false) || t.assignee_id === u.id) && (!bool(p, 'overdue', false) || t.overdue) && (!txt(p, 'entity') || t.entity === p.entity)); };
  A.api_assign = (p) => {
    const u = cur(); const ent = txt(p, 'entity'); const eid = num(p, 'id'); const who = num(p, 'assignee_id'); const due = txt(p, 'due_at') ? new Date(p.due_at).toISOString() : null;
    const t = tasks(u).find((x) => x.entity === ent && x.entity_id === eid);
    if (!t) fail('ไม่พบงานนี้ (อาจปิดไปแล้ว) หรือไม่มีสิทธิ์');
    if (!canAssign(u, ent, t.site_id)) fail('ต้องเป็นผู้จัดการ ผู้บริหาร หรือ Admin จึงมอบหมายงานได้');
    if (who != null) { const x = byId('users', who);
      if (!x || !x.active || x.role === 'pending') fail('ผู้รับผิดชอบต้องเป็นผู้ใช้ที่เปิดใช้งานแล้ว');
      if (x.role === 'branch' && t.site_id != null && x.site_id !== t.site_id) fail('ผู้ใช้สาขานี้ไม่ได้อยู่สถานที่ของงาน'); }
    db.assignments = db.assignments.filter((x) => !(x.entity === ent && x.entity_id === eid));
    if (!(who == null && due == null && !txt(p, 'note'))) db.assignments.push({ entity: ent, entity_id: eid, assignee_id: who, due_at: due, note: txt(p, 'note'), assigned_by: u.id, assigned_at: nowIso() });
    audit(u.id, 'assign', ent, eid, p);
    return tasks(u).find((x) => x.entity === ent && x.entity_id === eid);
  };

  // ---------- LINE (ตัวอย่างข้อความ) ----------
  A.api_line_preview = () => {
    const u = cur(); need(u, ['admin']);
    const cfg = setting('line'); const kinds = cfg.kinds || ['negative_stock', 'overripe', 'ripe', 'near_ripe', 'aging', 'late', 'case', 'overdue', 'pending_adjust', 'pending_return', 'credit_needed', 'pending_stocktake', 'pending_receipt', 'low_stock'];
    const lvl = { danger: 0, warn: 1, info: 2 };
    const items = alerts(sysUser()).filter((e) => kinds.includes(e.kind)).map((e, i) => ({ e, i })).sort((a, b) => lvl[a.e.level] - lvl[b.e.level] || a.i - b.i).map((x) => x.e);
    if (!items.length) return { text: null, keys: [], count: 0 };
    const key = (e) => e.kind + ':' + ([e.dispatch_id, e.lot_id, e.receipt_id, e.adjustment_id, e.return_id, e.stocktake_id, e.task_entity, e.task_id].filter((v) => v != null).join('/') || e.detail.split(' เหลือ')[0]);
    const keys = [];
    const t = new Date(Date.now() + 7 * 3600e3).toISOString();
    let txt_ = `AVO FLOW · แจ้งเตือน ${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)} (${items.length} เรื่อง)`; let n = 0;
    for (const lv of ['danger', 'warn', 'info']) {
      const g = items.filter((e) => e.level === lv); if (!g.length || n >= 30) continue;
      txt_ += '\n\n' + { danger: '🔴 ด่วน', warn: '🟠 ควรจัดการ', info: '🔵 ติดตาม' }[lv];
      for (const e of g) { if (n >= 30) break; txt_ += `\n• ${e.title}: ${e.detail}`; n++; keys.push(key(e)); }
    }
    if (items.length > n) txt_ += `\n…และอีก ${items.length - n} เรื่อง (จะส่งในรอบถัดไป)`;
    if (cfg.app_url) txt_ += '\n\nเปิดระบบ: ' + cfg.app_url;
    return { text: txt_.slice(0, 4900), keys, count: items.length };
  };

  // ---------- บันทึกตอนออฟไลน์ (กันส่งซ้ำ) ----------
  A.api_offline_submit = (p) => {
    const u = cur(); const ref = String(p.ref || '').toLowerCase(); const fn = p.fn;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(ref)) fail('รหัสอ้างอิงไม่ถูกต้อง');
    if (!['api_ripeness_change', 'api_adjust_request', 'api_reweigh', 'api_stocktake_save', 'api_zone_transfer', 'api_dispatch_receive', 'api_receipt_save'].includes(fn)) fail('ฟังก์ชันนี้บันทึกแบบออฟไลน์ไม่ได้');
    const ex = db.client_requests.find((x) => x.ref === ref);
    if (ex) { if (ex.user_id !== u.id || ex.fn !== fn) fail('รหัสอ้างอิงนี้ถูกใช้แล้ว'); return { ...(ex.result || {}), _replayed: true }; }
    const res = A[fn](p.p || {});
    db.client_requests.push({ ref, user_id: u.id, fn, result: JSON.parse(JSON.stringify(res ?? null)), created_at: nowIso() });
    return res;
  };

  // ---------- จัดซื้อ: ใบสั่งซื้อ + งบรายเดือน ----------
  const poMonth = (po) => (po.expected_date || po.order_date).slice(0, 7);
  const poLines = (id) => db.po_lines.filter((x) => x.po_id === id).sort((a, b) => a.line_no - b.line_no);
  const poValue = (id) => R2(poLines(id).reduce((a, x) => a + R2(x.est_kg * x.price), 0));
  const confirmedPoLines = (poId) => db.receipt_lines.filter((rl) => { const r = byId('receipts', rl.receipt_id); return r.po_id === poId && r.status === 'confirmed'; });
  const poReceivedValue = (id) => R2(confirmedPoLines(id).reduce((a, rl) => a + rl.accepted_kg * rl.unit_cost, 0));
  const poOpenValue = (id) => { const po = byId('purchase_orders', id); return ['approved', 'partial'].includes(po.status) ? Math.max(R2(poValue(id) - poReceivedValue(id)), 0) : 0; };
  const poLineFor = (poId, v, s) => poLines(poId).filter((x) => x.variety_id === v && (x.size_id === s || x.size_id == null)).sort((a, b) => (a.size_id == null) - (b.size_id == null) || a.line_no - b.line_no)[0] || null;
  function poRefresh(id) {
    if (id == null) return; const po = byId('purchase_orders', id); if (!po || !['approved', 'partial', 'received'].includes(po.status)) return;
    const tot = poLines(id).reduce((a, x) => a + x.est_kg, 0); const got = confirmedPoLines(id).reduce((a, rl) => a + rl.accepted_kg, 0);
    po.status = got <= 0 ? 'approved' : got >= tot ? 'received' : 'partial';
  }
  function budgetMonth(m) {
    const b = db.purchase_budgets.find((x) => x.month === m)?.amount ?? null;
    const rls = db.receipt_lines.filter((rl) => { const r = byId('receipts', rl.receipt_id); return r.status === 'confirmed' && bkkDate(r.received_at).slice(0, 7) === m; });
    const rv = R2(rls.reduce((a, rl) => a + rl.accepted_kg * rl.unit_cost, 0)); const kg = R2(rls.reduce((a, rl) => a + rl.accepted_kg, 0));
    const pos = db.purchase_orders.filter((po) => ['approved', 'partial'].includes(po.status) && poMonth(po) === m);
    const ov = R2(pos.reduce((a, po) => a + poOpenValue(po.id), 0));
    return { month: m, budget: b, received_value: rv, received_kg: kg, receipts: new Set(rls.map((x) => x.receipt_id)).size, open_po_value: ov,
      open_pos: pos.filter((po) => poOpenValue(po.id) > 0).length, total: R2(rv + ov), remaining: b == null ? null : R2(b - rv - ov),
      pct: b > 0 ? R1((rv + ov) * 100 / b) : null, over: b != null && b < rv + ov };
  }
  const poJson = (id) => {
    const po = byId('purchase_orders', id); if (!po) return null;
    return { ...po, supplier: byId('suppliers', po.supplier_id).name, site: site(po.site_id).name, month: poMonth(po),
      created_by_name: uname(po.created_by), approved_by_name: uname(po.approved_by), closed_by_name: uname(po.closed_by),
      total_kg: R2(poLines(id).reduce((a, x) => a + x.est_kg, 0)), total_value: poValue(id),
      received_kg: R2(confirmedPoLines(id).reduce((a, rl) => a + rl.accepted_kg, 0)), received_value: poReceivedValue(id), open_value: poOpenValue(id),
      pending_receipts: db.receipts.filter((r) => r.po_id === id && ['draft', 'pending_check'].includes(r.status)).length,
      lines: poLines(id).map((x) => ({ ...x, variety: byId('varieties', x.variety_id).name, size: byId('sizes', x.size_id)?.name ?? null, value: R2(x.est_kg * x.price),
        received_kg: R2(db.receipt_lines.filter((rl) => rl.po_line_id === x.id && byId('receipts', rl.receipt_id).status === 'confirmed').reduce((a, rl) => a + rl.accepted_kg, 0)) })),
      receipts: db.receipts.filter((r) => r.po_id === id && r.status !== 'cancelled').sort((a, b) => (a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.id - b.id))
        .map((r) => { const ls = db.receipt_lines.filter((x) => x.receipt_id === r.id);
          return { id: r.id, doc_no: r.doc_no, status: r.status, received_at: r.received_at, kg: R2(ls.reduce((a, x) => a + (x.accepted_kg ?? x.net_kg), 0)),
            value: R2(ls.reduce((a, x) => a + (x.accepted_kg ?? x.net_kg) * x.unit_cost, 0)) }; }),
      budget: budgetMonth(poMonth(po)) };
  };
  A.api_po_save = (p) => {
    const u = cur(); need(u, ['warehouse', 'executive']);
    const sup = num(p, 'supplier_id'); if (sup == null || !byId('suppliers', sup)) fail('กรุณาเลือกสวน');
    const sid = num(p, 'site_id') ?? (u.role === 'warehouse' ? u.site_id : null) ?? db.sites.filter((x) => x.kind === 'warehouse' && x.active).sort((a, b) => a.sort - b.sort || a.id - b.id)[0]?.id;
    if (sid == null || site(sid)?.kind !== 'warehouse') fail('กรุณาเลือกคลังที่จะรับของ');
    if (u.role === 'warehouse') needSite(u, sid);
    const od = txt(p, 'order_date') || today(); const ed = txt(p, 'expected_date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || (ed && !/^\d{4}-\d{2}-\d{2}$/.test(ed))) fail('วันที่ไม่ถูกต้อง');
    if (ed && ed < od) fail('วันนัดรับต้องไม่ก่อนวันที่สั่ง');
    if (!(p.lines || []).length) fail('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ');
    const pid = num(p, 'id'); let po;
    if (pid == null) po = ins('purchase_orders', { doc_no: nextNo('PO'), supplier_id: sup, site_id: sid, order_date: od, expected_date: ed ?? null, status: 'draft', note: txt(p, 'note'),
      over_budget: false, created_by: u.id, created_at: nowIso(), approved_by: null, approved_at: null, closed_by: null, closed_at: null, close_note: null });
    else { po = byId('purchase_orders', pid); if (!po || !['draft', 'pending'].includes(po.status)) fail('แก้ไขได้เฉพาะใบสั่งซื้อที่ยังไม่อนุมัติ');
      if (u.role === 'warehouse') needSite(u, po.site_id);
      Object.assign(po, { supplier_id: sup, site_id: sid, order_date: od, expected_date: ed ?? null, note: txt(p, 'note') }); db.po_lines = db.po_lines.filter((x) => x.po_id !== po.id); }
    p.lines.forEach((ln, idx) => { const i = idx + 1; const kg = num(ln, 'est_kg'); const pr = num(ln, 'price'); const v = num(ln, 'variety_id'); const z = num(ln, 'size_id') ?? null;
      if (v == null) fail(`รายการที่ ${i}: กรุณาเลือกสายพันธุ์`);
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุจำนวนที่สั่ง (กก.)`);
      if (pr == null || pr < 0) fail(`รายการที่ ${i}: กรุณาระบุราคาซื้อต่อ กก.`);
      if (db.po_lines.some((x) => x.po_id === po.id && x.variety_id === v && x.size_id === z)) fail(`รายการที่ ${i}: สายพันธุ์/ไซส์ซ้ำกับรายการก่อนหน้า`);
      ins('po_lines', { po_id: po.id, line_no: i, variety_id: v, size_id: z, est_kg: R2(kg), price: R2(pr), note: txt(ln, 'note') }); });
    if (bool(p, 'submit', false)) po.status = 'pending';
    audit(u.id, pid == null ? 'create' : 'update', 'po', po.id, null);
    return poJson(po.id);
  };
  A.api_po_approve = (p) => {
    const u = cur(); const po = byId('purchase_orders', num(p, 'id'));
    if (!po || !['draft', 'pending'].includes(po.status)) fail('อนุมัติได้เฉพาะใบสั่งซื้อที่ยังไม่อนุมัติ');
    if (!isApprover(u, po.site_id)) fail('ต้องเป็นผู้จัดการคลัง ผู้บริหาร หรือ Admin จึงอนุมัติใบสั่งซื้อได้');
    const bm = budgetMonth(poMonth(po));
    Object.assign(po, { status: 'approved', approved_by: u.id, approved_at: nowIso(), over_budget: bm.budget != null && bm.total + poValue(po.id) > bm.budget });
    audit(u.id, 'approve', 'po', po.id, p);
    return poJson(po.id);
  };
  A.api_po_cancel = (p) => {
    const u = cur(); need(u, ['warehouse', 'executive']); const po = byId('purchase_orders', num(p, 'id'));
    if (!po || ['closed', 'cancelled'].includes(po.status)) fail('ใบสั่งซื้อนี้ปิดหรือยกเลิกไปแล้ว');
    if (['partial', 'received'].includes(po.status) || db.receipts.some((r) => r.po_id === po.id && r.status !== 'cancelled')) fail('ใบสั่งซื้อนี้มีใบรับเข้าแล้ว — ให้ใช้ "ปิดใบสั่งซื้อ" แทน');
    if (po.status === 'approved' && !isApprover(u, po.site_id)) fail('ใบที่อนุมัติแล้ว ต้องให้ผู้จัดการ/ผู้บริหารยกเลิก');
    if (u.role === 'warehouse') needSite(u, po.site_id);
    if (!txt(p, 'reason')) fail('กรุณาระบุเหตุผลการยกเลิก');
    Object.assign(po, { status: 'cancelled', close_note: txt(p, 'reason'), closed_by: u.id, closed_at: nowIso() });
    audit(u.id, 'cancel', 'po', po.id, p);
    return poJson(po.id);
  };
  A.api_po_close = (p) => {
    const u = cur(); const po = byId('purchase_orders', num(p, 'id'));
    if (!po || !['approved', 'partial', 'received'].includes(po.status)) fail('ปิดได้เฉพาะใบสั่งซื้อที่อนุมัติแล้ว');
    if (!isApprover(u, po.site_id)) fail('ต้องเป็นผู้จัดการคลัง ผู้บริหาร หรือ Admin');
    if (db.receipts.some((r) => r.po_id === po.id && ['draft', 'pending_check'].includes(r.status))) fail('ยังมีใบรับเข้าที่อ้างอิงใบนี้รอตรวจรับ — ยืนยันหรือยกเลิกก่อน');
    Object.assign(po, { status: 'closed', close_note: txt(p, 'note'), closed_by: u.id, closed_at: nowIso() });
    audit(u.id, 'close', 'po', po.id, p);
    return poJson(po.id);
  };
  A.api_pos = (p) => {
    const u = cur(); need(u, ['warehouse', 'executive']); const q = txt(p, 'q')?.toLowerCase(); const sts = txt(p, 'status')?.split(',');
    return db.purchase_orders.filter((po) => canSee(u, po.site_id) && (!sts || sts.includes(po.status)) && (!bool(p, 'open', false) || ['approved', 'partial'].includes(po.status))
      && (num(p, 'supplier_id') == null || po.supplier_id === num(p, 'supplier_id')) && (!txt(p, 'month') || poMonth(po) === p.month)
      && (!q || like(po.doc_no, q) || like(byId('suppliers', po.supplier_id).name, q)))
      .sort((a, b) => (a.order_date < b.order_date ? 1 : a.order_date > b.order_date ? -1 : b.id - a.id)).slice(off(p), off(p) + lim(p))
      .map((po) => { const { lines, receipts, budget, ...j } = poJson(po.id); return j; });
  };
  A.api_po_get = (p) => { const u = cur(); need(u, ['warehouse', 'executive']); const po = byId('purchase_orders', num(p, 'id')); if (!po || !canSee(u, po.site_id)) fail('ไม่พบใบสั่งซื้อ'); return poJson(po.id); };
  A.api_budget_save = (p) => {
    const u = cur(); need(u, ['executive']); const m = txt(p, 'month'); const a = num(p, 'amount');
    if (!m || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) fail('เดือนไม่ถูกต้อง');
    if (a == null) db.purchase_budgets = db.purchase_budgets.filter((x) => x.month !== m);
    else { if (a < 0) fail('งบต้องไม่ติดลบ'); const ex = db.purchase_budgets.find((x) => x.month === m);
      const row = { month: m, amount: R2(a), note: txt(p, 'note'), updated_by: u.id, updated_at: nowIso() }; if (ex) Object.assign(ex, row); else db.purchase_budgets.push(row); }
    audit(u.id, 'update', 'budget', m, p);
    return budgetMonth(m);
  };
  A.api_budget_summary = (p) => {
    const u = cur(); need(u, ['warehouse', 'executive']); const y = int(p, 'year') ?? Number(bkkDate(Date.now()).slice(0, 4)); const m = txt(p, 'month') || bkkDate(Date.now()).slice(0, 7);
    const by = new Map();
    db.receipt_lines.forEach((rl) => { const r = byId('receipts', rl.receipt_id); if (r.status !== 'confirmed' || bkkDate(r.received_at).slice(0, 7) !== m) return;
      const g = by.get(r.supplier_id) || { supplier_id: r.supplier_id, supplier: byId('suppliers', r.supplier_id).name, kg: 0, value: 0, _r: new Set() };
      g.kg += rl.accepted_kg; g.value += rl.accepted_kg * rl.unit_cost; g._r.add(r.id); by.set(r.supplier_id, g); });
    return { year: y, month: m, months: Array.from({ length: 12 }, (_, i) => budgetMonth(`${y}-${String(i + 1).padStart(2, '0')}`)),
      suppliers: [...by.values()].map(({ _r, ...g }) => ({ ...g, kg: R2(g.kg), value: R2(g.value), receipts: _r.size, avg_price: g.kg > 0 ? R2(g.value / g.kg) : null })).sort((a, b) => b.value - a.value) };
  };

  // ---------- แผนจัดส่ง (ปฏิทินรายเดือน) · รุ่น 2.4 — ตรงกับ sql/08_api_plan.sql ----------
  const PLAN_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const thd = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${dd}/${m}/${y + 543}`; };
  const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
  const isoDow = (iso) => ((new Date(iso + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1;
  const validDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
  const planNextColor = () => PLAN_PALETTE.map((c, i) => [c, i, db.plan_dests.filter((d) => d.active && d.color === c).length])
    .sort((a, b) => a[2] - b[2] || a[1] - b[1])[0][0];
  const dispatchDay = (d) => d.doc_date || bkkDate(d.shipped_at || d.created_at);
  const destOf = (d) => (d.site_id != null ? site(d.site_id) : byId('customers', d.customer_id)) || null;
  const planDestJson = (d) => {
    const o = destOf(d); const c = d.customer_id != null ? o : null;
    const last = db.delivery_plans.filter((x) => x.dest_id === d.id && x.planned_kg != null).sort((a, b) => b.plan_date.localeCompare(a.plan_date) || b.id - a.id)[0];
    return { id: d.id, kind: d.site_id != null ? 'site' : 'customer', site_id: d.site_id, customer_id: d.customer_id, code: o?.code ?? null, name: o?.name ?? null,
      channel: c?.channel ?? null, color: d.color, sort: d.sort, active: !!d.active && (o ? !!o.active : true),
      last_kg: last ? last.planned_kg : null, last_baskets: last ? (last.planned_baskets ?? null) : null };
  };
  const planSeed = () => {
    db.sites.filter((s) => s.kind === 'branch' && s.active && !db.plan_dests.some((d) => d.site_id === s.id))
      .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name)) || a.id - b.id)
      .forEach((s) => ins('plan_dests', { site_id: s.id, customer_id: null, color: planNextColor(), sort: s.sort ?? 0, active: true, created_by: null, created_at: nowIso() }));
  };
  const planJson = (x) => ({ id: x.id, plan_date: x.plan_date, dest_id: x.dest_id, planned_kg: x.planned_kg, planned_baskets: x.planned_baskets, note: x.note });
  const PLANNERS = ['warehouse', 'executive'];

  A.api_plan_month = (p) => {
    const u = cur(); const t = today(); const m = txt(p, 'month') || t.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) fail('เดือนไม่ถูกต้อง');
    const br = u.role === 'branch'; const ed = ['admin', 'warehouse', 'executive'].includes(u.role);
    const m0 = m + '-01'; const [yy, mm] = m.split('-').map(Number);
    const m1 = addDays(`${mm === 12 ? yy + 1 : yy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`, -1);
    const g0 = addDays(m0, -(isoDow(m0) - 1)); const g1 = addDays(m1, 7 - isoDow(m1));
    if (ed) planSeed();
    const dests = db.plan_dests.filter((d) => !br || d.site_id === u.site_id)
      .sort((a, b) => a.sort - b.sort || String(destOf(a)?.name ?? '').localeCompare(String(destOf(b)?.name ?? '')) || a.id - b.id).map(planDestJson);
    const vis = (destId) => { const d = byId('plan_dests', destId); return !br || d.site_id === u.site_id; };
    const plans = db.delivery_plans.filter((x) => x.plan_date >= g0 && x.plan_date <= g1 && vis(x.dest_id))
      .sort((a, b) => a.plan_date.localeCompare(b.plan_date) || a.dest_id - b.dest_id)
      .map((x) => ({ ...planJson(x), updated_by_name: uname(x.updated_by ?? x.created_by), updated_at: x.updated_at }));
    const docs = [];
    for (const d of db.dispatches) {
      if (d.status === 'cancelled') continue;
      const day = dispatchDay(d); if (day < g0 || day > g1) continue;
      if (br && !(d.kind === 'transfer' && d.to_site_id === u.site_id)) continue;
      const pd = db.plan_dests.find((x) => (d.kind === 'transfer' && x.site_id === d.to_site_id) || (d.kind === 'sale' && x.customer_id != null && x.customer_id === d.customer_id));
      if (!pd) continue;
      const ls = db.dispatch_lines.filter((l) => l.dispatch_id === d.id);
      const rk = ls.filter((l) => l.received_kg != null); const rb = ls.filter((l) => l.received_baskets != null);
      docs.push({ id: d.id, doc_no: d.doc_no, date: day, dest_id: pd.id, kind: d.kind, status: d.status,
        kg: R2(ls.reduce((a, l) => a + l.kg, 0)), baskets: ls.reduce((a, l) => a + (l.baskets || 0), 0),
        received_kg: rk.length ? R2(rk.reduce((a, l) => a + l.received_kg, 0)) : null, received_baskets: rb.length ? rb.reduce((a, l) => a + l.received_baskets, 0) : null,
        shipped_at: d.shipped_at ?? null, received_at: d.received_at ?? null, open_cases: db.cases.filter((c) => c.dispatch_id === d.id && c.status === 'open').length });
    }
    docs.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    return { month: m, month_start: m0, month_end: m1, from: g0, to: g1, today: t, can_edit: ed,
      receive_deadline_hours: threshold('receive_deadline_hours', 4), dests, plans, docs };
  };

  A.api_plan_save = (p) => {
    const u = cur(); need(u, PLANNERS);
    const id = int(p, 'id'); const destId = int(p, 'dest_id');
    if (p.plan_date != null && !validDate(p.plan_date)) fail('วันที่ไม่ถูกต้อง');
    const date = p.plan_date ?? null; if (date == null) fail('กรุณาเลือกวันที่ส่ง');
    const d = byId('plan_dests', destId); if (!d) fail('กรุณาเลือกปลายทาง');
    const nm = destOf(d)?.name ?? null;
    const kg = num(p, 'planned_kg'); const bk = int(p, 'planned_baskets');
    if (kg != null && kg <= 0) fail('น้ำหนักตามแผนต้องมากกว่า 0 กก. (หรือเว้นว่างไว้)');
    if (kg > 100000) fail('น้ำหนักตามแผนมากเกินไป');
    if (bk != null && bk < 0) fail('จำนวนตะกร้าต้องไม่ติดลบ');
    let x = null;
    if (id != null) { x = byId('delivery_plans', id); if (!x) fail('ไม่พบแผนส่งนี้ (อาจถูกลบไปแล้ว)'); }
    const act = !!d.active && (destOf(d) ? !!destOf(d).active : true);
    if (!act && (id == null || x.dest_id !== destId)) fail('ปลายทาง ' + nm + ' ถูกนำออกจากแผนหรือปิดใช้งานแล้ว');
    if (db.delivery_plans.some((r) => r.plan_date === date && r.dest_id === destId && r.id !== id)) fail(`มีแผนส่ง ${nm} วันที่ ${thd(date)} อยู่แล้ว — แก้ไขรายการเดิมแทน`);
    const vals = { plan_date: date, dest_id: destId, planned_kg: kg == null ? null : R2(kg), planned_baskets: bk, note: txt(p, 'note'), updated_by: u.id, updated_at: nowIso() };
    if (id == null) x = ins('delivery_plans', { ...vals, created_by: u.id, created_at: nowIso() }); else Object.assign(x, vals);
    audit(u.id, id == null ? 'create' : 'update', 'delivery_plan', x.id, { date: x.plan_date, dest: nm, kg: x.planned_kg, baskets: x.planned_baskets });
    return planJson(x);
  };

  A.api_plan_delete = (p) => {
    const u = cur(); need(u, PLANNERS);
    const x = byId('delivery_plans', int(p, 'id')); if (!x) fail('ไม่พบแผนส่งนี้ (อาจถูกลบไปแล้ว)');
    db.delivery_plans = db.delivery_plans.filter((r) => r.id !== x.id);
    audit(u.id, 'delete', 'delivery_plan', x.id, { date: x.plan_date, dest: destOf(byId('plan_dests', x.dest_id))?.name ?? null, kg: x.planned_kg, baskets: x.planned_baskets });
    return { ok: true };
  };

  A.api_plan_dest_save = (p) => {
    const u = cur(); need(u, PLANNERS);
    const id = int(p, 'id'); const sid = int(p, 'site_id'); const cid = int(p, 'customer_id'); const color = txt(p, 'color')?.toLowerCase() ?? null;
    if (color != null && !/^#[0-9a-f]{6}$/.test(color)) fail('รหัสสีไม่ถูกต้อง (เช่น #2a78d6)');
    let d; let act;
    if (id != null) {
      d = byId('plan_dests', id); if (!d) fail('ไม่พบปลายทางนี้');
      if (color) d.color = color; const so = int(p, 'sort'); if (so != null) d.sort = so; act = 'update';
    } else {
      if ((sid == null) === (cid == null)) fail('กรุณาเลือกสาขาหรือลูกค้า 1 รายการ');
      if (sid != null && !db.sites.some((s) => s.id === sid && s.kind === 'branch' && s.active)) fail('เลือกได้เฉพาะสาขาที่ยังเปิดใช้งาน');
      if (cid != null && !db.customers.some((c) => c.id === cid && c.active)) fail('ไม่พบลูกค้านี้ หรือถูกปิดใช้งานแล้ว');
      d = db.plan_dests.find((x) => (sid != null && x.site_id === sid) || (cid != null && x.customer_id === cid));
      if (d) { if (d.active) fail('ปลายทางนี้อยู่ในแผนแล้ว'); d.active = true; if (color) d.color = color; act = 'restore'; }
      else { d = ins('plan_dests', { site_id: sid, customer_id: cid, color: color || planNextColor(), sort: sid != null ? (site(sid).sort ?? 0) : 1000, active: true, created_by: u.id, created_at: nowIso() }); act = 'create'; }
    }
    audit(u.id, act, 'plan_dest', d.id, { site_id: d.site_id, customer_id: d.customer_id, color: d.color });
    return planDestJson(d);
  };

  A.api_plan_dest_remove = (p) => {
    const u = cur(); need(u, PLANNERS);
    const d = byId('plan_dests', int(p, 'id')); if (!d) fail('ไม่พบปลายทางนี้');
    const n = db.delivery_plans.filter((x) => x.dest_id === d.id && x.plan_date >= today()).length;
    if (n > 0) fail(`ยังมีแผนส่ง ${n} รายการตั้งแต่วันนี้ไป — ลบหรือย้ายแผนก่อน`);
    d.active = false;
    audit(u.id, 'remove', 'plan_dest', d.id, { site_id: d.site_id, customer_id: d.customer_id });
    return { ok: true };
  };

  // ---------- เริ่มต้นข้อมูล ----------
  function install() {
    db = empty();
    db.settings = {
      thresholds: { value: { low_stock_kg: 200, near_ripe_days: 5, aging_days: 7, weight_variance_pct: 5, std_basket_kg: 20, receive_deadline_hours: 4, task_due_hours: 24, receipt_check_hours: 4, bill_due_hours: 48, shrink_auto_pct: 3, basket_tare_kg: 1.5 } },
      options: { value: { require_receive_photo: true, require_waste_photo: true, max_sales_discount_pct: 5, allow_negative_dispatch: true } },
      company: { value: { name: '', address: '', tax_id: '', phone: '', branch: 'สำนักงานใหญ่' } },
      line: { value: { enabled: false, repeat_hours: 20, app_url: '', kinds: ['negative_stock', 'overripe', 'ripe', 'near_ripe', 'aging', 'late', 'case', 'overdue', 'pending_adjust', 'pending_return', 'credit_needed', 'pending_stocktake', 'pending_receipt', 'low_stock'] } },
    };
    ins('sites', { code: 'CW', name: 'คลังกลาง', kind: 'warehouse', active: true, sort: 1, updated_by: null, updated_at: nowIso() });
    [['HASS', 'Hass', 1], ['BUCC', 'บัคคาเนีย', 2], ['BOOTH7', 'Booth 7', 3], ['PETER', 'ปีเตอร์สัน', 4]].forEach(([code, name, sort]) => ins('varieties', { code, name, active: true, sort, updated_by: null, updated_at: nowIso() }));
    [['S', 'S', null, 179, 1], ['M', 'M', 180, 219, 2], ['180', '180+', 180, null, 3], ['220', '220+', 220, null, 4], ['L', 'L', 220, 299, 5], ['XL', 'XL', 300, null, 6]]
      .forEach(([code, name, min_g, max_g, sort]) => ins('sizes', { code, name, min_g, max_g, active: true, sort, updated_by: null, updated_at: nowIso() }));
  }

  function save() { try { localStorage.setItem(storageKey, JSON.stringify(db)); } catch (e) { /* ไม่มีพื้นที่เก็บ — ทำงานในหน่วยความจำ */ } }
  function load() { try { const s = localStorage.getItem(storageKey); if (s) { db = { ...empty(), ...JSON.parse(s) }; return true; } } catch (e) { /* ignore */ } return false; }

  return {
    ApiError,
    hasData: () => !!db,
    load, save,
    reset() { install(); },
    setClaims(c) { claims = c; },
    getClaims() { return claims; },
    async rpc(fn, p = {}) {
      if (!A[fn]) throw new ApiError('ไม่พบฟังก์ชัน ' + fn);
      const snapshot = JSON.stringify(db);
      G.allowNeg = false; G.noNet = false;
      try {
        const out = A[fn](JSON.parse(JSON.stringify(p || {})));
        save();
        return out === undefined ? null : JSON.parse(JSON.stringify(out));
      } catch (e) {
        db = JSON.parse(snapshot);
        if (e instanceof ApiError) throw e;
        console.error(e);
        throw new ApiError('เกิดข้อผิดพลาดในระบบจำลอง: ' + e.message);
      }
    },
    // สำหรับทดสอบ
    _db: () => db,
    _setTime: null,
  };
}
