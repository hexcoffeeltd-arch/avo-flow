// =====================================================================
// AVO FLOW — Demo backend (ทำงานในเบราว์เซอร์ ไม่ต้องมีฐานข้อมูล)
// จำลองฟังก์ชัน public.api_* ของ PostgreSQL ด้วยกฎธุรกิจชุดเดียวกัน
// ใช้สำหรับทดลองระบบเท่านั้น — ระบบจริงใช้ SQL ในโฟลเดอร์ sql/
// ทุกคำสั่งทำงานแบบ all-or-nothing (ถ้าผิดพลาดจะย้อนข้อมูลกลับ)
// =====================================================================

const R2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (p, k) => (p == null || p[k] === undefined || p[k] === null || p[k] === '' ? null : Number(p[k]));
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
  const userOut = (u) => { const { auth_sub, ...rest } = u; return rest; };
  const checkZone = (sid, z) => { const k = site(sid)?.kind; if (!k) fail('ไม่พบสถานที่');
    if ((k === 'warehouse' && !['main', 'frozen'].includes(z)) || (k === 'branch' && !['front', 'back', 'frozen'].includes(z))) fail(`จุดจัดเก็บ "${zoneL(z)}" ใช้กับสถานที่นี้ไม่ได้`); };
  const needFree = (sid, z, l, r, kg) => { if (!(kg > 0)) return; const have = bal(sid, z, l, r)?.kg || 0; const res = reserved(sid, z, l, r);
    if (R2(have - res) < kg) fail(`สต็อกว่างไม่พอ: คงเหลือ ${fmt(have)} กก. ถูกจองในใบตีออกร่าง ${fmt(res)} กก. ใช้ได้ ${fmt(Math.max(have - res, 0))} กก.`); };
  const company = (u) => need(u, ['warehouse', 'sales', 'executive']);
  const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));

  // ---------- ยอดคงเหลือ + สมุดเคลื่อนไหว ----------
  const bal = (s, z, l, r) => db.balances.find((b) => b.site_id === s && b.zone === z && b.lot_id === l && b.ripeness === r);
  function move(s, z, l, r, dkg, dbask, dbag, mtype, docType, docId, docNo, actor, reason = null, evidence = null, approver = null, counterparty = null, occurred = null) {
    dkg = R2(dkg || 0); dbask = dbask || 0; dbag = dbag || 0;
    if (!dkg && !dbask && !dbag) return { id: null, d_baskets: 0, d_bags: 0 };
    let b = bal(s, z, l, r);
    if (!b) { b = { site_id: s, zone: z, lot_id: l, ripeness: r, kg: 0, baskets: 0, bags: 0, updated_at: nowIso() }; db.balances.push(b); }
    const nk = R2(b.kg + dkg);
    const lcode = byId('lots', l)?.code;
    if (nk < 0) fail(`สต็อกไม่พอ: ${lcode} (${zoneL(z)} · ${ripL(r)}) คงเหลือ ${fmt(b.kg)} กก. แต่ต้องการ ${fmt(-dkg)} กก.`);
    let nb = b.baskets + dbask;
    if (nb < 0 || (nk === 0 && dkg < 0)) nb = 0;
    let ng = b.bags + dbag;
    if (ng < 0) fail(`จำนวนถุงไม่พอ: ${lcode} คงเหลือ ${b.bags} ถุง แต่ต้องการ ${-dbag} ถุง`);
    if (nk === 0 && dkg < 0) ng = 0;
    const m = ins('movements', {
      mtype, doc_type: docType, doc_id: docId, doc_no: docNo, lot_id: l, site_id: s, zone: z, ripeness: r,
      d_kg: dkg, d_baskets: nb - b.baskets, d_bags: ng - b.bags, before_kg: b.kg, after_kg: nk,
      before_baskets: b.baskets, after_baskets: nb, before_bags: b.bags, after_bags: ng,
      occurred_at: occurred || nowIso(), recorded_at: nowIso(), actor_id: actor, approver_id: approver,
      counterparty, reason, evidence,
    });
    const out = { id: m.id, d_baskets: nb - b.baskets, d_bags: ng - b.bags };
    Object.assign(b, { kg: nk, baskets: nb, bags: ng, updated_at: nowIso() });
    return out;
  }
  const fmt = (n) => String(R2(n));

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
      supplier_id: l.supplier_id, received_at: l.received_at, unit_cost: l.unit_cost, status: l.status, parent_lot_id: l.parent_lot_id ?? null };
  };
  const receiptJson = (id) => {
    const r = byId('receipts', id); if (!r) return null;
    const lines = db.receipt_lines.filter((x) => x.receipt_id === r.id).sort((a, b) => a.line_no - b.line_no);
    return { ...r, supplier: byId('suppliers', r.supplier_id)?.name, site: site(r.site_id)?.name,
      created_by_name: uname(r.created_by), checked_by_name: uname(r.checked_by),
      total_net: R2(lines.reduce((s, x) => s + x.net_kg, 0)), total_accepted: R2(lines.reduce((s, x) => s + (x.accepted_kg || 0), 0)),
      total_baskets: lines.reduce((s, x) => s + x.baskets, 0),
      lines: lines.map((x) => ({ ...x, lot_code: byId('lots', x.lot_id)?.code, variety: byId('varieties', x.variety_id)?.name, size: byId('sizes', x.size_id)?.name })) };
  };
  const reserved = (s, z, l, r, exclude = null) => R2(db.dispatch_lines.filter((dl) => {
    const d = byId('dispatches', dl.dispatch_id);
    return d.status === 'draft' && d.from_site_id === s && d.from_zone === z && dl.lot_id === l && dl.ripeness === r && d.id !== exclude;
  }).reduce((a, dl) => a + dl.kg, 0));
  const dispatchJson = (id) => {
    const d = byId('dispatches', id); if (!d) return null;
    const lines = db.dispatch_lines.filter((x) => x.dispatch_id === d.id).sort((a, b) => a.line_no - b.line_no);
    const c = byId('customers', d.customer_id); const fs = site(d.from_site_id); const ts = site(d.to_site_id);
    const rec = lines.filter((x) => x.received_kg != null);
    return { ...d, from_site: fs?.name, from_site_kind: fs?.kind, to_site: ts?.name ?? null, customer: c?.name ?? null, channel: c?.channel ?? null,
      destination: c?.name ?? ts?.name ?? null, created_by_name: uname(d.created_by), shipped_by_name: uname(d.shipped_by), received_by_name: uname(d.received_by),
      total_kg: R2(lines.reduce((s, x) => s + x.kg, 0)), total_received_kg: rec.length ? R2(rec.reduce((s, x) => s + x.received_kg, 0)) : null,
      total_baskets: lines.reduce((s, x) => s + x.baskets, 0), total_billed_kg: R2(lines.reduce((s, x) => s + x.billed_kg, 0)),
      open_cases: db.cases.filter((x) => x.dispatch_id === d.id && x.status === 'open').length,
      lines: lines.map((x) => { const l = byId('lots', x.lot_id); return { ...x, lot_code: l.code, product: l.product,
        variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
        supplier: byId('suppliers', l.supplier_id)?.name ?? null, unit_cost: l.unit_cost }; }),
      cases: db.cases.filter((x) => x.dispatch_id === d.id).sort((a, b) => a.id - b.id) };
  };
  const priceFor = (cust, v, s, prod = 'fresh') => {
    const f = (c) => db.prices.find((p) => (p.customer_id ?? null) === (c ?? null) && p.variety_id === v && p.size_id === s && p.product === prod);
    const own = cust != null ? f(cust) : null;
    return own?.sell_price ?? f(null)?.sell_price ?? null;
  };
  const checkPrice = (u, cust, v, s, prod, price) => {
    const lp = priceFor(cust, v, s, prod);
    if (price == null || price < 0) fail('ราคาไม่ถูกต้อง');
    if (['admin', 'executive'].includes(u.role)) return lp;
    if (lp == null) fail('ยังไม่ได้ตั้งราคาขายของสินค้านี้ ให้ผู้บริหารตั้งราคาในหน้าตั้งค่าก่อน');
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
    return { ...i, customer: c.name, customer_address: c.address, customer_tax_id: c.tax_id, customer_phone: c.phone, channel: c.channel,
      created_by_name: uname(i.created_by), gross_profit: R2(i.subtotal - i.discount - i.cost_total), dispatches: dnos.join(', ') || null,
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

  A.api_users = () => { const u = cur(); need(u, ['admin']);
    return db.users.map((x) => ({ ...userOut(x), site_name: site(x.site_id)?.name ?? null }))
      .sort((a, b) => (b.active - a.active) || ((b.role === 'pending') - (a.role === 'pending')) || (a.display_name || '').localeCompare(b.display_name || '')); };

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
    if (!['thresholds', 'company', 'options'].includes(p.key)) fail('หมวดการตั้งค่าไม่ถูกต้อง');
    db.settings[p.key] = { value: p.value || {}, updated_by: u.id, updated_at: nowIso() };
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
    const waste = R2(db.movements.filter((m) => ['WASTE', 'CASE_LOSS'].includes(m.mtype)).filter((m) => { const l = byId('lots', m.lot_id);
      const root = l.parent_lot_id ? byId('lots', l.parent_lot_id) : l; return root.supplier_id === s.id; }).reduce((a, m) => a - m.d_kg, 0));
    const hist = db.receipt_lines.filter((rl) => byId('receipts', rl.receipt_id).supplier_id === s.id).map((rl) => { const r = byId('receipts', rl.receipt_id);
      return { receipt_id: r.id, doc_no: r.doc_no, received_at: r.received_at, status: r.status, lot: byId('lots', rl.lot_id).code,
        variety: byId('varieties', rl.variety_id)?.name, size: byId('sizes', rl.size_id)?.name, baskets: rl.baskets, net_kg: rl.net_kg,
        accepted_kg: rl.accepted_kg, rejected_kg: rl.rejected_kg, unit_cost: rl.unit_cost, _ln: rl.line_no }; })
      .sort((a, b) => (b.received_at > a.received_at ? 1 : b.received_at < a.received_at ? -1 : a._ln - b._ln)).map(({ _ln, ...x }) => x);
    return { ...s, received_kg: recv, waste_kg: waste, waste_rate: recv > 0 ? R2(waste * 100 / recv) : 0,
      rejected_kg: R2(confirmedLinesOf(s.id).reduce((a, x) => a + x.rejected_kg, 0)), history: hist };
  };

  A.api_customer_save = (p) => {
    const u = cur(); need(u, ['sales', 'executive']); if (!txt(p, 'name')) fail('กรุณากรอกชื่อลูกค้า');
    const ch = p.channel || 'wholesale'; if (!['wholesale', 'retail', 'dc', 'online', 'tiktok', 'other'].includes(ch)) fail('ช่องทางขายไม่ถูกต้อง');
    const rid = num(p, 'id'); const code = txt(p, 'code')?.toUpperCase();
    if (code && db.customers.some((s) => s.code === code && s.id !== rid)) fail('รหัสลูกค้านี้ถูกใช้แล้ว');
    const vals = { name: txt(p, 'name'), address: txt(p, 'address'), phone: txt(p, 'phone'), tax_id: txt(p, 'tax_id'), note: txt(p, 'note'), updated_by: u.id, updated_at: nowIso() };
    let c;
    if (rid == null) c = ins('customers', { code: code || 'C' + String(db.customers.length + 1).padStart(3, '0'), ctype: txt(p, 'ctype') || 'company', channel: ch, ...vals, active: bool(p, 'active', true) });
    else { c = byId('customers', rid); if (!c) fail('ไม่พบลูกค้า'); Object.assign(c, vals, { code: code || c.code, ctype: txt(p, 'ctype') || c.ctype, channel: txt(p, 'channel') || c.channel, active: bool(p, 'active', c.active) }); }
    audit(u.id, rid == null ? 'create' : 'update', 'customer', c.id, p);
    return { ...c };
  };
  A.api_customers = () => { company(cur()); return [...db.customers].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map((c) => {
    const inv = db.invoices.filter((i) => i.customer_id === c.id && i.status === 'issued');
    return { ...c, invoices: inv.length, sales_total: R2(inv.reduce((a, i) => a + i.total, 0)), last_sale: inv.length ? inv.map((i) => i.doc_date).sort().at(-1) : null }; }); };
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
    return { ...c, prices: db.prices.filter((x) => x.customer_id === c.id).map((x) => ({ variety: byId('varieties', x.variety_id)?.name, size: byId('sizes', x.size_id)?.name, product: x.product, sell_price: x.sell_price })),
      history: rows.map(({ _k, ...r }) => r), favorites: Object.values(fav).sort((a, b) => b.kg - a.kg) };
  };

  A.api_prices = () => { company(cur()); return db.prices.map((x) => ({ id: x.id, customer_id: x.customer_id ?? null, customer: byId('customers', x.customer_id)?.name ?? null,
    variety_id: x.variety_id, variety: byId('varieties', x.variety_id)?.name, size_id: x.size_id, size: byId('sizes', x.size_id)?.name, product: x.product,
    sell_price: x.sell_price, updated_at: x.updated_at, _vs: byId('varieties', x.variety_id)?.sort ?? 0, _zs: byId('sizes', x.size_id)?.sort ?? 0 }))
    .sort((a, b) => ((a.customer || '') < (b.customer || '') ? -1 : (a.customer || '') > (b.customer || '') ? 1 : a._vs - b._vs || a._zs - b._zs || a.product.localeCompare(b.product)))
    .map(({ _vs, _zs, ...x }) => x); };
  A.api_price_save = (p) => {
    const u = cur(); need(u, ['executive']);
    const cid = num(p, 'customer_id'); const vid = num(p, 'variety_id'); const zid = num(p, 'size_id'); const prod = txt(p, 'product') || 'fresh'; const pr = num(p, 'sell_price');
    if (vid == null || zid == null) fail('กรุณาเลือกสายพันธุ์และไซส์');
    db.prices = db.prices.filter((x) => !((x.customer_id ?? null) === (cid ?? null) && x.variety_id === vid && x.size_id === zid && x.product === prod));
    if (pr != null) { if (pr < 0) fail('ราคาต้องไม่ติดลบ'); ins('prices', { customer_id: cid, variety_id: vid, size_id: zid, product: prod, sell_price: pr, updated_by: u.id, updated_at: nowIso() }); }
    audit(u.id, 'update', 'price', `${cid ?? 'std'}:${vid}:${zid}:${prod}`, p);
    return A.api_prices({});
  };
  A.api_price_lookup = (p) => { cur();
    if ('lot_id' in p) { const l = byId('lots', num(p, 'lot_id')); return { price: l ? priceFor(num(p, 'customer_id'), l.variety_id, l.size_id, l.product) : null }; }
    return { price: priceFor(num(p, 'customer_id'), num(p, 'variety_id'), num(p, 'size_id'), txt(p, 'product') || 'fresh') }; };

  // ---------- รับเข้า ----------
  A.api_receipt_save = (p) => {
    const u = cur(); need(u, ['warehouse']);
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
        status, note: txt(p, 'note'), evidence: txt(p, 'evidence'), created_by: u.id, created_at: nowIso(), checked_by: null, checked_at: null, cancel_reason: null, updated_at: nowIso() });
    } else {
      r = byId('receipts', rid); if (r && !canAct(u, r.site_id)) fail('ไม่มีสิทธิ์แก้ไขใบรับเข้าของคลังอื่น');
      if (!r || !['draft', 'pending_check'].includes(r.status)) fail('แก้ไขได้เฉพาะใบรับเข้าที่ยังไม่ยืนยัน');
      Object.assign(r, { supplier_id: sup, site_id: sid, received_at: p.received_at ? new Date(p.received_at).toISOString() : r.received_at, status,
        note: txt(p, 'note'), evidence: txt(p, 'evidence') ?? r.evidence, updated_at: nowIso() });
    }
    const keep = [];
    p.lines.forEach((ln, idx) => {
      const i = idx + 1; const v = num(ln, 'variety_id'); const s = num(ln, 'size_id'); const rip = ln.ripeness || 'raw';
      const gross = num(ln, 'gross_kg'); const tare = num(ln, 'tare_kg') ?? 0;
      if (v == null || s == null) fail(`รายการที่ ${i}: กรุณาเลือกสายพันธุ์และไซส์`);
      if (!RIP.includes(rip)) fail(`รายการที่ ${i}: สถานะความสุกไม่ถูกต้อง`);
      if (gross == null || gross <= 0) fail(`รายการที่ ${i}: กรุณากรอกน้ำหนักรวม (ชั่งจริง)`);
      if (tare < 0 || tare >= gross) fail(`รายการที่ ${i}: น้ำหนักตะกร้าต้องน้อยกว่าน้ำหนักรวม`);
      if ((int(ln, 'baskets') ?? 0) < 0) fail(`รายการที่ ${i}: จำนวนตะกร้าไม่ถูกต้อง`);
      const vals = { line_no: i, variety_id: v, size_id: s, ripeness: rip, baskets: int(ln, 'baskets') ?? 0, gross_kg: R2(gross), tare_kg: R2(tare),
        net_kg: R2(gross - tare), unit_cost: num(ln, 'unit_cost') ?? 0, note: txt(ln, 'note') };
      const ex = db.receipt_lines.find((x) => x.id === num(ln, 'id') && x.receipt_id === r.id);
      if (ex) {
        Object.assign(byId('lots', ex.lot_id), { variety_id: v, size_id: s, supplier_id: sup, received_at: r.received_at, unit_cost: vals.unit_cost });
        Object.assign(ex, vals); keep.push(ex.id);
      } else {
        const lot = ins('lots', { code: nextNo('LOT'), product: 'fresh', variety_id: v, size_id: s, supplier_id: sup, receipt_id: r.id, parent_lot_id: null,
          received_at: r.received_at, unit_cost: vals.unit_cost, status: 'draft', created_at: nowIso() });
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
      const rej = num(ln, 'rejected_kg') ?? rl.rejected_kg ?? 0;
      if (rej < 0 || rej > rl.net_kg) fail(`บรรทัด ${rl.line_no}: น้ำหนักคัดออกต้องอยู่ระหว่าง 0 ถึง ${fmt(rl.net_kg)} กก.`);
      Object.assign(rl, { rejected_kg: R2(rej), accepted_kg: R2(rl.net_kg - rej), note: txt(ln, 'note') ?? rl.note });
      byId('lots', rl.lot_id).status = 'active';
      move(r.site_id, 'main', rl.lot_id, rl.ripeness, rl.accepted_kg, rl.baskets, 0, 'RECEIVE', 'RECEIPT', r.id, r.doc_no, u.id, txt(p, 'note'), txt(p, 'evidence') ?? r.evidence, u.id, sname, r.received_at);
    });
    Object.assign(r, { status: 'confirmed', checked_by: u.id, checked_at: nowIso(), evidence: txt(p, 'evidence') ?? r.evidence, updated_at: nowIso() });
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
    Object.assign(r, { status: 'reversed', cancel_reason: txt(p, 'reason'), updated_at: nowIso() });
    audit(u.id, 'reverse', 'receipt', r.id, p);
    return receiptJson(r.id);
  };
  A.api_receipts = (p) => {
    const u = cur(); const q = txt(p, 'q')?.toLowerCase();
    return db.receipts.filter((r) => canSee(u, r.site_id) && (!txt(p, 'status') || r.status === p.status) && inRange(r.received_at, txt(p, 'from'), txt(p, 'to'))
      && (!q || like(r.doc_no, q) || like(byId('suppliers', r.supplier_id)?.name, q) || db.receipt_lines.some((rl) => rl.receipt_id === r.id && like(byId('lots', rl.lot_id).code, q))))
      .sort((a, b) => (a.received_at < b.received_at ? 1 : a.received_at > b.received_at ? -1 : b.id - a.id))
      .map((r) => { const { lines, ...j } = receiptJson(r.id); return { ...j, lots: lines.map((l) => l.lot_code).join(', ') || null }; });
  };
  A.api_receipt_get = (p) => { const u = cur(); const r = byId('receipts', num(p, 'id')); if (!canSee(u, r?.site_id)) fail('ไม่มีสิทธิ์ดูเอกสารนี้'); return receiptJson(num(p, 'id')); };

  // ---------- สต็อก ----------
  A.api_stock = (p) => {
    const u = cur(); const q = txt(p, 'q')?.toLowerCase();
    return db.balances.filter((b) => (b.kg > 0 || b.bags > 0) && canSee(u, b.site_id)
      && (num(p, 'site_id') == null || b.site_id === num(p, 'site_id'))
      && (txt(p, 'zone') == null ? b.zone !== 'transit' : b.zone === p.zone)
      && (!txt(p, 'site_kind') || site(b.site_id).kind === p.site_kind)
      && (!txt(p, 'ripeness') || b.ripeness === p.ripeness))
      .map((b) => { const l = byId('lots', b.lot_id); const st = site(b.site_id);
        return { site_id: b.site_id, site: st.name, site_code: st.code, site_kind: st.kind, zone: b.zone, lot_id: l.id, lot_code: l.code, product: l.product,
          variety_id: l.variety_id, variety: byId('varieties', l.variety_id)?.name ?? null, size_id: l.size_id, size: byId('sizes', l.size_id)?.name ?? null,
          supplier_id: l.supplier_id, supplier: byId('suppliers', l.supplier_id)?.name ?? null, received_at: l.received_at, age_days: ageDays(l),
          ripeness: b.ripeness, rip_rank: RIP_RANK[b.ripeness], kg: b.kg, baskets: b.baskets, bags: b.bags, unit_cost: l.unit_cost,
          value: R2(b.kg * l.unit_cost), reserved_kg: reserved(b.site_id, b.zone, b.lot_id, b.ripeness), updated_at: b.updated_at }; })
      .filter((x) => (num(p, 'variety_id') == null || x.variety_id === num(p, 'variety_id')) && (num(p, 'size_id') == null || x.size_id === num(p, 'size_id'))
        && (num(p, 'supplier_id') == null || x.supplier_id === num(p, 'supplier_id')) && (!txt(p, 'product') || x.product === p.product)
        && (!q || like(x.lot_code, q) || like(x.variety, q) || like(x.supplier, q) || like(x.size, q)))
      .sort((a, b) => (a.site_kind !== b.site_kind ? (a.site_kind < b.site_kind ? 1 : -1) : a.site.localeCompare(b.site) || b.rip_rank - a.rip_rank
        || (a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : a.lot_code.localeCompare(b.lot_code))));
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
          baskets: b.baskets, bags: b.bags, suggest_kg: R2(take), suggest_baskets: b.kg > 0 ? Math.round(b.baskets * take / b.kg) : 0 });
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
    needFree(sid, z, lot, f, kg);
    const no = nextNo('RIP');
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
      .sort((a, b) => b.id - a.id).slice(0, int(p, 'limit') || 500)
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
      title: ({ retail_sale: 'ขายหน้าร้าน', internal_use: 'นำไปใช้', waste: 'ตัดทิ้ง' }[a.kind] || 'ปรับยอด') + ({ pending: ' (รออนุมัติ)', rejected: ' (ไม่อนุมัติ)' }[a.status] || ''),
      detail: `${site(a.site_id).name} · ${fmt(a.kind === 'count_adjust' ? a.kg : Math.abs(a.kg))} กก. · ${a.reason || '-'}`, doc_no: a.doc_no }));
    db.invoice_lines.filter((il) => il.lot_id === l.id && !br).forEach((il) => { const i = byId('invoices', il.invoice_id);
      ev.push({ at: i.created_at, seq: '9', kind: 'invoice', title: 'ออกบิล ' + i.doc_no + (i.status === 'cancelled' ? ' (ยกเลิก)' : ''),
        detail: `${byId('customers', i.customer_id).name} · ${fmt(il.kg)} กก. × ${fmt(il.price)} บาท`, doc_no: i.doc_no, invoice_id: i.id }); });
    ev.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.seq.localeCompare(b.seq)));
    const r = byId('receipts', root.receipt_id); const sp = r ? byId('suppliers', r.supplier_id) : null;
    const lj = lotJson(l.id); if (br) delete lj.unit_cost;
    return { ...lj, root: root.id !== l.id ? lotJson(root.id) : null,
      receipt: r ? { id: r.id, doc_no: r.doc_no, received_at: r.received_at, supplier: sp.name, contact: sp.contact, phone: sp.phone, province: sp.province } : null,
      balances: db.balances.filter((b) => b.lot_id === l.id && (b.kg > 0 || b.bags > 0) && canSee(tu, b.site_id)).map((b) => ({ site: site(b.site_id).name, zone: b.zone, ripeness: b.ripeness, kg: b.kg, baskets: b.baskets, bags: b.bags })),
      destinations: db.dispatch_lines.filter((dl) => dl.lot_id === l.id).map((dl) => ({ dl, d: byId('dispatches', dl.dispatch_id) })).filter(({ d }) => d.status !== 'cancelled' && mine(d.from_site_id, d.to_site_id))
        .sort((a, b) => ((a.d.shipped_at || '~') < (b.d.shipped_at || '~') ? -1 : 1))
        .map(({ dl, d }) => { const c = byId('customers', d.customer_id); return { doc_no: d.doc_no, kind: d.kind, to: c?.name ?? site(d.to_site_id)?.name, channel: c?.channel ?? null, kg: dl.kg, received_kg: dl.received_kg, status: d.status }; }),
      children: db.lots.filter((c) => c.parent_lot_id === l.id).map((c) => ({ id: c.id, code: c.code })),
      open_cases: db.cases.filter((c) => c.lot_id === l.id && c.status === 'open').length, events: ev };
  };

  // ---------- ตีออก ----------
  function shipInternal(u, id) {
    const d = byId('dispatches', id); if (!d) fail('ไม่พบใบตีออก');
    if (d.status !== 'draft') fail('ใบตีออก ' + d.doc_no + ' ถูกยืนยันส่งไปแล้ว (กันกดซ้ำ)');
    if (!isApprover(u, d.from_site_id)) fail('ต้องให้ผู้จัดการคลัง/สาขา ผู้บริหาร หรือ Admin ยืนยันการตีออก');
    const dest = byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name;
    db.dispatch_lines.filter((x) => x.dispatch_id === d.id).sort((a, b) => a.line_no - b.line_no).forEach((dl) => {
      const r = move(d.from_site_id, d.from_zone, dl.lot_id, dl.ripeness, -dl.kg, -dl.baskets, -dl.bags, 'SHIP_OUT', 'DISPATCH', d.id, d.doc_no, u.id, d.note, null, u.id, dest);
      move(d.from_site_id, 'transit', dl.lot_id, dl.ripeness, dl.kg, -r.d_baskets, -r.d_bags, 'TRANSIT_IN', 'DISPATCH', d.id, d.doc_no, u.id, d.note, null, u.id, dest);
      dl.baskets = -r.d_baskets;
    });
    Object.assign(d, { status: 'shipped', shipped_by: u.id, shipped_at: nowIso() });
    audit(u.id, 'ship', 'dispatch', d.id, null);
  }
  A.api_dispatch_save = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']);
    const kind = p.kind || 'transfer'; const from = num(p, 'from_site_id'); let to = num(p, 'to_site_id'); let cust = num(p, 'customer_id');
    const fk = site(from)?.kind; if (!fk) fail('กรุณาเลือกต้นทาง');
    needSite(u, from);
    const fz = txt(p, 'from_zone') || (fk === 'warehouse' ? 'main' : 'back');
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
    let d; const did = num(p, 'id');
    const vals = { kind, from_site_id: from, from_zone: fz, to_site_id: to, to_zone: tz, customer_id: cust, carrier: txt(p, 'carrier'), vehicle: txt(p, 'vehicle'), packer: txt(p, 'packer'), note: txt(p, 'note') };
    if (did == null) d = ins('dispatches', { doc_no: nextNo(kind === 'sale' ? 'OUT' : 'TR'), ...vals, status: 'draft', created_by: u.id, created_at: nowIso(),
      shipped_by: null, shipped_at: null, receiver_name: null, received_by: null, received_at: null, receive_note: null, evidence: null });
    else { d = byId('dispatches', did); if (d && !canAct(u, d.from_site_id)) fail('ไม่มีสิทธิ์แก้ไขใบตีออกของสถานที่อื่น');
      if (!d || d.status !== 'draft') fail('แก้ไขได้เฉพาะใบตีออกที่ยังเป็นร่าง'); Object.assign(d, vals);
      db.dispatch_lines = db.dispatch_lines.filter((x) => x.dispatch_id !== d.id); }
    p.lines.forEach((ln, idx) => {
      const i = idx + 1; const lot = db.lots.find((l) => l.id === num(ln, 'lot_id') && l.status === 'active'); const kg = num(ln, 'kg');
      if (!lot) fail(`รายการที่ ${i}: ไม่พบ Lot ที่ใช้งานได้`);
      const rip = lot.product === 'frozen' ? 'na' : ln.ripeness || 'raw';
      if ((lot.product === 'frozen') !== (fz === 'frozen')) fail(`รายการที่ ${i}: สินค้าแช่แข็งต้องตีออกจากจุดแช่แข็ง`);
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุน้ำหนัก (กก.)`);
      if (db.dispatch_lines.some((x) => x.dispatch_id === d.id && x.lot_id === lot.id && x.ripeness === rip)) fail(`Lot ${lot.code} (${ripL(rip)}) ถูกเลือกซ้ำ`);
      const avail = R2((bal(from, fz, lot.id, rip)?.kg || 0) - reserved(from, fz, lot.id, rip, d.id));
      if (kg > avail) fail(`ห้ามจ่ายเกินยอดพร้อมใช้: ${lot.code} (${ripL(rip)}) พร้อมจ่าย ${fmt(Math.max(avail, 0))} กก. แต่ขอ ${fmt(kg)} กก.`);
      ins('dispatch_lines', { dispatch_id: d.id, line_no: i, lot_id: lot.id, ripeness: rip, kg: R2(kg), baskets: int(ln, 'baskets') ?? 0, bags: int(ln, 'bags') ?? 0,
        received_kg: null, received_baskets: null, received_bags: null, billed_kg: 0 });
    });
    audit(u.id, did == null ? 'create' : 'update', 'dispatch', d.id, null);
    if (bool(p, 'ship', false)) shipInternal(u, d.id);
    return dispatchJson(d.id);
  };
  A.api_dispatch_ship = (p) => { const u = cur(); need(u, ['warehouse', 'branch', 'executive']); shipInternal(u, num(p, 'id')); return dispatchJson(num(p, 'id')); };
  A.api_dispatch_cancel = (p) => {
    const u = cur(); need(u, ['warehouse', 'branch']); const d = byId('dispatches', num(p, 'id'));
    if (!d || d.status !== 'draft') fail('ยกเลิกได้เฉพาะใบตีออกที่ยังเป็นร่าง (ถ้าส่งแล้วให้ใช้การรับคืน/สรุปส่วนต่าง)');
    needSite(u, d.from_site_id);
    d.status = 'cancelled'; d.note = (d.note ? d.note + ' · ' : '') + 'ยกเลิก: ' + (txt(p, 'reason') || '-');
    audit(u.id, 'cancel', 'dispatch', d.id, p);
    return dispatchJson(d.id);
  };
  A.api_dispatch_receive = (p) => {
    const u = cur(); const d = byId('dispatches', num(p, 'id')); if (!d) fail('ไม่พบใบตีออก');
    if (d.status !== 'shipped') fail('ใบ ' + d.doc_no + ' ไม่ได้อยู่ในสถานะ "ส่งแล้ว รอรับ" (อาจรับไปแล้ว)');
    if (d.kind === 'transfer') { if (!(u.role === 'admin' || canAct(u, d.to_site_id))) fail('ต้องเป็นผู้ใช้ของสาขาปลายทางจึงยืนยันรับได้'); }
    else if (!(['admin', 'warehouse', 'sales'].includes(u.role) || canAct(u, d.from_site_id))) fail('ต้องเป็นคลัง ฝ่ายขาย หรือสาขาต้นทางจึงบันทึกการส่งมอบลูกค้าได้');
    if (!txt(p, 'receiver_name')) fail('กรุณาระบุชื่อผู้รับสินค้า');
    if ((setting('options').require_receive_photo ?? true) && !txt(p, 'evidence')) fail('กรุณาแนบรูปสภาพสินค้าเมื่อถึงปลายทาง');
    const src = site(d.from_site_id).name; const at = p.received_at ? new Date(p.received_at).toISOString() : nowIso(); let partial = false;
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
    return dispatchJson(d.id);
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
    return dispatchJson(d.id);
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
      .map((d) => { const { cases, ...j } = dispatchJson(d.id); return j; });
  };
  A.api_dispatch_get = (p) => { const u = cur(); const d = byId('dispatches', num(p, 'id')); if (!d || !(canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id)))) fail('ไม่มีสิทธิ์ดูเอกสารนี้'); return dispatchJson(d.id); };
  A.api_cases = (p) => {
    const u = cur();
    return db.cases.map((c) => ({ c, d: byId('dispatches', c.dispatch_id) })).filter(({ c, d }) => (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id))) && (!txt(p, 'status') || c.status === p.status))
      .sort((a, b) => (a.c.status < b.c.status ? -1 : a.c.status > b.c.status ? 1 : a.c.created_at < b.c.created_at ? 1 : -1))
      .map(({ c, d }) => { const dl = byId('dispatch_lines', c.dispatch_line_id); return { ...c, dispatch_no: d.doc_no, lot_code: byId('lots', c.lot_id).code, from_site: site(d.from_site_id).name,
        destination: byId('customers', d.customer_id)?.name ?? site(d.to_site_id)?.name, shipped_kg: dl.kg, received_kg: dl.received_kg, resolved_by_name: uname(c.resolved_by) }; });
  };

  // ---------- สาขา ----------
  A.api_branch_stock = (p) => {
    const u = cur(); let sid = num(p, 'site_id') ?? u.site_id;
    if (sid == null) sid = db.sites.filter((s) => s.kind === 'branch' && s.active).sort((a, b) => a.sort - b.sort || a.id - b.id)[0]?.id;
    if (sid == null) return { site: null };
    if (!canSee(u, sid)) fail('ไม่มีสิทธิ์ดูสาขานี้');
    const zones = {};
    db.balances.filter((b) => b.site_id === sid && b.zone !== 'transit' && (b.kg > 0 || b.bags > 0)).forEach((b) => {
      zones[b.zone] = zones[b.zone] || {}; const g = (zones[b.zone][b.ripeness] = zones[b.zone][b.ripeness] || { ripeness: b.ripeness, kg: 0, baskets: 0, bags: 0, _lots: new Set() });
      g.kg = R2(g.kg + b.kg); g.baskets += b.baskets; g.bags += b.bags; g._lots.add(b.lot_id); });
    const zout = {};
    Object.entries(zones).forEach(([z, g]) => { zout[z] = Object.values(g).map(({ _lots, ...x }) => ({ ...x, lots: _lots.size })).sort((a, b) => RIP_RANK[b.ripeness] - RIP_RANK[a.ripeness]); });
    return { site: { ...site(sid) }, zones: zout,
      incoming: db.dispatches.filter((d) => d.to_site_id === sid && ['shipped', 'partial'].includes(d.status)).sort((a, b) => (a.shipped_at < b.shipped_at ? -1 : 1)).map((d) => dispatchJson(d.id)),
      recent: db.dispatches.filter((d) => d.to_site_id === sid && ['received', 'closed'].includes(d.status)).sort((a, b) => (a.received_at < b.received_at ? 1 : -1)).slice(0, 10)
        .map((d) => { const { cases, ...j } = dispatchJson(d.id); return j; }),
      pending_adjustments: db.adjustments.filter((a) => a.site_id === sid && a.status === 'pending').length };
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
    const k = p.kind; if (!['retail_sale', 'internal_use', 'waste', 'count_adjust'].includes(k)) fail('ประเภทรายการไม่ถูกต้อง');
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
      requested_at: nowIso(), decided_by: null, decided_at: null, decision_note: null });
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
    if (ok && a.kg < 0) needFree(a.site_id, a.zone, a.lot_id, a.ripeness, -a.kg);
    if (ok) move(a.site_id, a.zone, a.lot_id, a.ripeness, a.kg, a.baskets, a.bags, a.kind === 'waste' ? 'WASTE' : 'ADJUST', 'ADJUST', a.id, a.doc_no, a.requested_by, a.reason, a.evidence, u.id);
    Object.assign(a, { status: ok ? 'applied' : 'rejected', decided_by: u.id, decided_at: nowIso(), decision_note: txt(p, 'note') });
    audit(u.id, ok ? 'approve' : 'reject', 'adjustment', a.id, p);
    return { ...a };
  };
  A.api_adjustments = (p) => {
    const u = cur();
    return db.adjustments.filter((a) => canSee(u, a.site_id) && (!txt(p, 'status') || a.status === p.status) && (num(p, 'site_id') == null || a.site_id === num(p, 'site_id')) && (!txt(p, 'kind') || a.kind === p.kind))
      .sort((a, b) => (a.requested_at < b.requested_at ? 1 : -1)).slice(0, 300)
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
  A.api_quotes = (p) => { company(cur()); return db.quotes.filter((q) => num(p, 'customer_id') == null || q.customer_id === num(p, 'customer_id'))
    .sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.id - a.id)).map((q) => { const { lines, ...j } = quoteJson(q.id); return j; }); };
  A.api_quote_get = (p) => { company(cur()); return quoteJson(num(p, 'id')); };
  A.api_billable = (p) => {
    company(cur());
    return db.dispatch_lines.map((dl) => ({ dl, d: byId('dispatches', dl.dispatch_id) }))
      .filter(({ dl, d }) => d.kind === 'sale' && ['received', 'partial', 'closed'].includes(d.status) && dl.received_kg > dl.billed_kg
        && (num(p, 'customer_id') == null || d.customer_id === num(p, 'customer_id')) && (num(p, 'dispatch_id') == null || d.id === num(p, 'dispatch_id')))
      .sort((a, b) => (a.d.received_at < b.d.received_at ? -1 : a.d.received_at > b.d.received_at ? 1 : a.d.id - b.d.id || a.dl.line_no - b.dl.line_no))
      .map(({ dl, d }) => { const l = byId('lots', dl.lot_id); const c = byId('customers', d.customer_id);
        return { dispatch_line_id: dl.id, dispatch_id: d.id, dispatch_no: d.doc_no, customer_id: d.customer_id, customer: c.name, channel: c.channel, delivered_at: d.received_at,
          lot_id: l.id, lot_code: l.code, product: l.product, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, ripeness: dl.ripeness,
          shipped_kg: dl.kg, received_kg: dl.received_kg, billed_kg: dl.billed_kg, billable_kg: R2(dl.received_kg - dl.billed_kg),
          price: priceFor(d.customer_id, l.variety_id, l.size_id, l.product), unit_cost: l.unit_cost }; });
  };
  A.api_invoice_create = (p) => {
    const u = cur(); need(u, ['sales', 'executive']); const cust = num(p, 'customer_id'); if (cust == null) fail('กรุณาเลือกลูกค้า');
    if (!(p.lines || []).length) fail('กรุณาเลือกรายการจากใบตีออกที่ส่งมอบแล้ว');
    const inv = ins('invoices', { doc_no: nextNo('INV'), title: txt(p, 'title') || 'ใบส่งของ / ใบแจ้งหนี้', customer_id: cust, doc_date: txt(p, 'doc_date') || today(), status: 'issued',
      discount: 0, shipping: 0, vat_rate: 0, subtotal: 0, vat: 0, total: 0, cost_total: 0, note: txt(p, 'note'), created_by: u.id, created_at: nowIso(),
      cancel_reason: null, cancelled_by: null, cancelled_at: null });
    let sub = 0; let cost = 0;
    p.lines.forEach((ln, idx) => { const i = idx + 1; const kg = num(ln, 'kg'); const pr = num(ln, 'price');
      const dl = byId('dispatch_lines', num(ln, 'dispatch_line_id')); if (!dl) fail(`รายการที่ ${i}: ไม่พบรายการส่งสินค้า`);
      const d = byId('dispatches', dl.dispatch_id);
      if (d.kind !== 'sale') fail('การโอนไปสาขาไม่ถือเป็นยอดขาย ออกบิลไม่ได้');
      if (d.customer_id !== cust) fail('รวมบิลได้เฉพาะใบตีออกของลูกค้ารายเดียวกัน');
      if (!['received', 'partial', 'closed'].includes(d.status)) fail(`ใบ ${d.doc_no} ยังไม่ได้ยืนยันส่งมอบ`);
      if (kg == null || kg <= 0) fail(`รายการที่ ${i}: กรุณาระบุจำนวน กก.`);
      if (kg > R2(dl.received_kg - dl.billed_kg)) fail(`ออกบิลเกินจำนวนที่ส่งมอบจริง: ${d.doc_no} คงเหลือให้ออกบิล ${fmt(dl.received_kg - dl.billed_kg)} กก. (กันบิลซ้ำ)`);
      const l = byId('lots', dl.lot_id); const lp = checkPrice(u, cust, l.variety_id, l.size_id, l.product, pr);
      dl.billed_kg = R2(dl.billed_kg + kg);
      ins('invoice_lines', { invoice_id: inv.id, line_no: i, dispatch_line_id: dl.id, lot_id: dl.lot_id, kg: R2(kg), price: pr, list_price: lp ?? null, amount: R2(kg * pr), cost: R2(kg * l.unit_cost) });
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
    db.invoice_lines.filter((il) => il.invoice_id === inv.id).forEach((il) => { const dl = byId('dispatch_lines', il.dispatch_line_id); dl.billed_kg = R2(dl.billed_kg - il.kg); });
    Object.assign(inv, { status: 'cancelled', cancel_reason: txt(p, 'reason'), cancelled_by: u.id, cancelled_at: nowIso() });
    audit(u.id, 'cancel', 'invoice', inv.id, p);
    return invoiceJson(inv.id);
  };
  A.api_invoices = (p) => {
    const u = cur(); need(u, ['sales', 'executive', 'warehouse']); const q = txt(p, 'q')?.toLowerCase();
    return db.invoices.filter((i) => (num(p, 'customer_id') == null || i.customer_id === num(p, 'customer_id')) && (!txt(p, 'status') || i.status === p.status)
      && inRange(i.doc_date, txt(p, 'from'), txt(p, 'to')) && (!q || like(i.doc_no, q) || like(byId('customers', i.customer_id).name, q)))
      .sort((a, b) => (a.doc_date < b.doc_date ? 1 : a.doc_date > b.doc_date ? -1 : b.id - a.id)).map((i) => { const { lines, ...j } = invoiceJson(i.id); return j; });
  };
  A.api_invoice_get = (p) => { const u = cur(); need(u, ['sales', 'executive', 'warehouse']);
    const id = num(p, 'id') ?? db.invoices.find((i) => i.doc_no === (txt(p, 'doc_no') || '').toUpperCase())?.id; return invoiceJson(id); };

  // ---------- แจ้งเตือน / แดชบอร์ด / รายงาน ----------
  function alerts(u) {
    const low = threshold('low_stock_kg', 200), near = threshold('near_ripe_days', 5), aging = threshold('aging_days', 7), pct = threshold('weight_variance_pct', 5),
      std = threshold('std_basket_kg', 20), hrs = threshold('receive_deadline_hours', 4); const res = [];
    const B = db.balances.map((b) => ({ ...b, l: byId('lots', b.lot_id), st: site(b.site_id) }));
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
    const seeD = (d) => canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id));
    return {
      warehouse_kg: wh, reserved_kg: res, ready_kg: R2(wh - res),
      baskets: B.filter((b) => b.zone !== 'transit' && canSee(u, b.site_id)).reduce((a, b) => a + b.baskets, 0),
      transit_kg: R2(B.filter((b) => b.zone === 'transit' && canSee(u, b.site_id)).reduce((a, b) => a + b.kg, 0)),
      frozen_bags: B.filter((b) => b.zone === 'frozen' && canSee(u, b.site_id)).reduce((a, b) => a + b.bags, 0),
      lots_active: new Set(B.filter((b) => (b.kg > 0 || b.bags > 0) && b.zone !== 'transit' && canSee(u, b.site_id)).map((b) => b.lot_id)).size,
      by_ripeness: byRip,
      by_variety: Object.entries(grp(whB.filter((b) => b.kg > 0), (b) => byId('varieties', b.l.variety_id)?.name || '-')).map(([v, x]) => ({ variety: v, kg: x.kg, baskets: x.bk })).sort((a, b) => b.kg - a.kg),
      by_size: Object.entries(grp(whB.filter((b) => b.kg > 0), (b) => byId('sizes', b.l.size_id)?.name || '-')).map(([s, x]) => ({ size: s, kg: x.kg })).sort((a, b) => b.kg - a.kg),
      by_site: db.sites.filter((s) => s.active && canSee(u, s.id)).sort((a, b) => (a.kind === b.kind ? a.sort - b.sort || a.name.localeCompare(b.name) : a.kind === 'warehouse' ? -1 : 1))
        .map((s) => ({ site_id: s.id, site: s.name, kind: s.kind, kg: R2(B.filter((b) => b.site_id === s.id && b.zone !== 'transit').reduce((a, b) => a + b.kg, 0)),
          baskets: B.filter((b) => b.site_id === s.id && b.zone !== 'transit').reduce((a, b) => a + b.baskets, 0), bags: B.filter((b) => b.site_id === s.id && b.zone === 'frozen').reduce((a, b) => a + b.bags, 0) })),
      today: { in_kg: M(['RECEIVE'], (m) => m.d_kg), out_kg: M(['SHIP_OUT'], (m) => -m.d_kg), sales: R2(inv.reduce((a, i) => a + i.subtotal - i.discount, 0)),
        gross_profit: R2(inv.reduce((a, i) => a + i.subtotal - i.discount - i.cost_total, 0)), waste_kg: M(['WASTE', 'CASE_LOSS'], (m) => -m.d_kg) },
      queue: [
        { key: 'pending_receipt', title: 'รอตรวจรับจากสวน', sub: 'คลังต้องยืนยันน้ำหนักจริง', count: db.receipts.filter((r) => r.status === 'pending_check' && canSee(u, r.site_id)).length },
        { key: 'draft_dispatch', title: 'ใบตีออกรอผู้จัดการยืนยัน', sub: 'จองสต็อกไว้แล้ว ยังไม่ส่ง', count: db.dispatches.filter((d) => d.status === 'draft' && canSee(u, d.from_site_id)).length },
        { key: 'in_transit', title: 'ส่งแล้ว รอสาขารับ', sub: 'อยู่ระหว่างขนส่ง', count: db.dispatches.filter((d) => d.status === 'shipped' && (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id)))).length },
        { key: 'partial', title: 'รับบางส่วน', sub: 'รอตรวจสอบส่วนต่าง', count: db.cases.filter((c) => c.status === 'open' && seeD(byId('dispatches', c.dispatch_id))).length },
        { key: 'pending_adjust', title: 'รออนุมัติตัดทิ้ง / ปรับยอด', sub: 'ผู้จัดการต้องอนุมัติ', count: db.adjustments.filter((a) => a.status === 'pending' && canSee(u, a.site_id)).length },
        { key: 'to_bill', title: 'ส่งมอบแล้ว รอออกบิล', sub: 'ฝ่ายขายสร้างบิลจากใบตีออก',
          count: u.role === 'branch' ? 0 : new Set(db.dispatch_lines.filter((dl) => { const d = byId('dispatches', dl.dispatch_id); return d.kind === 'sale' && ['received', 'partial', 'closed'].includes(d.status) && dl.received_kg > dl.billed_kg; }).map((dl) => dl.dispatch_id)).size },
      ],
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
    receipts: [['date', 'วันที่', 'date'], ['doc_no', 'เลขที่รับเข้า'], ['supplier', 'สวน', null, 1], ['province', 'จังหวัด', null, 1], ['lot', 'Lot'], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['ripeness', 'ความสุก', null, 1], ['baskets', 'ตะกร้า', 'num'], ['net_kg', 'ชั่งสุทธิ (กก.)', 'num'], ['rejected_kg', 'คัดออก (กก.)', 'num'], ['accepted_kg', 'รับจริง (กก.)', 'num'], ['unit_cost', 'ราคาซื้อ/กก.', 'money', 0, 1], ['cost', 'ต้นทุน (บาท)', 'money']],
    dispatches: [['date', 'วันที่ส่ง', 'date'], ['doc_no', 'เลขที่'], ['kind', 'ประเภท', null, 1], ['from', 'ต้นทาง', null, 1], ['destination', 'ปลายทาง', null, 1], ['channel', 'ช่องทาง', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['kg', 'ส่ง (กก.)', 'num'], ['received_kg', 'รับจริง (กก.)', 'num'], ['variance_kg', 'ส่วนต่าง (กก.)', 'num'], ['status', 'สถานะ', null, 1]],
    stock: [['site', 'สถานที่', null, 1], ['zone', 'จุดจัดเก็บ', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['ripeness', 'ความสุก', null, 1], ['received', 'รับเข้า', 'date'], ['age_days', 'อายุ (วัน)', 'num', 0, 1], ['kg', 'คงเหลือ (กก.)', 'num'], ['baskets', 'ตะกร้า', 'num'], ['bags', 'ถุง', 'num'], ['value', 'มูลค่าทุน (บาท)', 'money']],
    sales: [['date', 'วันที่บิล', 'date'], ['doc_no', 'เลขที่บิล'], ['customer', 'ลูกค้า', null, 1], ['channel', 'ช่องทาง', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['size', 'ไซส์', null, 1], ['kg', 'กก.', 'num'], ['price', 'ราคา/กก.', 'money', 0, 1], ['amount', 'ยอดขาย (บาท)', 'money'], ['cost', 'ต้นทุน (บาท)', 'money'], ['gp', 'กำไรขั้นต้น (บาท)', 'money']],
    waste: [['date', 'วันที่', 'date'], ['doc_no', 'เอกสาร'], ['type', 'ประเภทสูญเสีย', null, 1], ['site', 'สถานที่', null, 1], ['lot', 'Lot'], ['supplier', 'สวน', null, 1], ['variety', 'สายพันธุ์', null, 1], ['kg', 'สูญเสีย (กก.)', 'num'], ['reason', 'เหตุผล']],
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
        .forEach(({ rl, r }) => { const s = byId('suppliers', r.supplier_id); rows.push({ date: bkkDate(r.received_at), doc_no: r.doc_no, supplier: s.name, province: s.province, lot: byId('lots', rl.lot_id).code,
          variety: byId('varieties', rl.variety_id).name, size: byId('sizes', rl.size_id).name, ripeness: ripL(rl.ripeness), baskets: rl.baskets, net_kg: rl.net_kg, rejected_kg: rl.rejected_kg,
          accepted_kg: rl.accepted_kg, unit_cost: rl.unit_cost, cost: R2(rl.accepted_kg * rl.unit_cost) }); });
    } else if (k === 'dispatches') { c = cols('dispatches');
      db.dispatch_lines.map((dl) => ({ dl, d: byId('dispatches', dl.dispatch_id) })).filter(({ d }) => d.shipped_at && inRange(d.shipped_at, f, t) && (canSee(u, d.from_site_id) || (d.to_site_id != null && canSee(u, d.to_site_id))))
        .sort((a, b) => (a.d.shipped_at < b.d.shipped_at ? -1 : a.d.shipped_at > b.d.shipped_at ? 1 : a.dl.line_no - b.dl.line_no))
        .forEach(({ dl, d }) => { const l = byId('lots', dl.lot_id); const cu = byId('customers', d.customer_id);
          rows.push({ date: bkkDate(d.shipped_at), doc_no: d.doc_no, kind: d.kind === 'sale' ? 'ขาย' : 'โอนสาขา', from: site(d.from_site_id).name, destination: cu?.name ?? site(d.to_site_id)?.name,
            channel: cu?.channel ?? 'สาขา', lot: l.code, supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null,
            kg: dl.kg, received_kg: dl.received_kg, variance_kg: dl.received_kg == null ? null : R2(dl.kg - dl.received_kg), status: d.status }); });
    } else if (['stock', 'branch', 'aging'].includes(k)) { c = cols('stock');
      rows = db.balances.map((b) => ({ b, l: byId('lots', b.lot_id), st: site(b.site_id) }))
        .filter(({ b, l, st }) => (b.kg > 0 || b.bags > 0) && canSee(u, b.site_id) && (k !== 'branch' || st.kind === 'branch') && (k !== 'aging' || (l.product === 'fresh' && b.zone !== 'transit')))
        .map(({ b, l, st }) => ({ _k: st.kind, site: st.name, zone: zoneL(b.zone), lot: l.code, supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null,
          size: byId('sizes', l.size_id)?.name ?? null, ripeness: ripL(b.ripeness), received: bkkDate(l.received_at), age_days: ageDays(l), kg: b.kg, baskets: b.baskets, bags: b.bags, value: R2(b.kg * l.unit_cost) }))
        .sort((a, b) => (k === 'aging' ? b.age_days - a.age_days : 0) || (a._k < b._k ? 1 : a._k > b._k ? -1 : 0) || a.site.localeCompare(b.site) || a.zone.localeCompare(b.zone) || a.lot.localeCompare(b.lot))
        .map(({ _k, ...x }) => x);
    } else if (k === 'sales') { c = cols('sales'); need(u, ['sales', 'executive', 'warehouse']);
      db.invoice_lines.map((il) => ({ il, i: byId('invoices', il.invoice_id) })).filter(({ i }) => i.status === 'issued' && inRange(i.doc_date, f, t))
        .sort((a, b) => (a.i.doc_date < b.i.doc_date ? -1 : a.i.doc_date > b.i.doc_date ? 1 : a.i.id - b.i.id || a.il.line_no - b.il.line_no))
        .forEach(({ il, i }) => { const l = byId('lots', il.lot_id); const cu = byId('customers', i.customer_id);
          rows.push({ date: i.doc_date, doc_no: i.doc_no, customer: cu.name, channel: cu.channel, lot: l.code, supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null,
            variety: byId('varieties', l.variety_id)?.name ?? null, size: byId('sizes', l.size_id)?.name ?? null, kg: il.kg, price: il.price, amount: il.amount, cost: il.cost, gp: R2(il.amount - il.cost) }); });
    } else if (k === 'waste') { c = cols('waste');
      db.movements.filter((m) => ['WASTE', 'CASE_LOSS'].includes(m.mtype) && inRange(m.occurred_at, f, t) && canSee(u, m.site_id)).forEach((m) => { const l = byId('lots', m.lot_id);
        rows.push({ date: bkkDate(m.occurred_at), doc_no: m.doc_no, type: m.mtype === 'WASTE' ? 'ตัดทิ้ง/เน่าเสีย' : 'สูญหายระหว่างขนส่ง', site: site(m.site_id).name, lot: l.code,
          supplier: byId('suppliers', rootOf(l).supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, kg: R2(-m.d_kg), reason: m.reason }); });
      db.freezes.filter((fr) => inRange(fr.created_at, f, t) && canSee(u, fr.site_id)).forEach((fr) => { const l = byId('lots', fr.source_lot_id);
        rows.push({ date: bkkDate(fr.created_at), doc_no: fr.doc_no, type: 'สูญเสียจากแปรรูป (เปลือก/เมล็ด)', site: site(fr.site_id).name, lot: l.code,
          supplier: byId('suppliers', l.supplier_id)?.name ?? null, variety: byId('varieties', l.variety_id)?.name ?? null, kg: fr.loss_kg, reason: fr.note }); });
      db.receipt_lines.map((rl) => ({ rl, r: byId('receipts', rl.receipt_id) })).filter(({ rl, r }) => r.status === 'confirmed' && rl.rejected_kg > 0 && inRange(r.received_at, f, t) && canSee(u, r.site_id))
        .forEach(({ rl, r }) => rows.push({ date: bkkDate(r.received_at), doc_no: r.doc_no, type: 'คัดออกตอนรับเข้า', site: site(r.site_id).name, lot: byId('lots', rl.lot_id).code,
          supplier: byId('suppliers', r.supplier_id).name, variety: byId('varieties', rl.variety_id).name, kg: rl.rejected_kg, reason: rl.note }));
      rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    } else if (k === 'movements') { c = cols('movements');
      rows = db.movements.filter((m) => inRange(m.occurred_at, f, t) && canSee(u, m.site_id)).sort((a, b) => a.id - b.id)
        .map((m) => ({ date: m.occurred_at, mtype: m.mtype, doc_no: m.doc_no, lot: byId('lots', m.lot_id).code, site: site(m.site_id).name, zone: zoneL(m.zone), ripeness: ripL(m.ripeness),
          d_kg: m.d_kg, before_kg: m.before_kg, after_kg: m.after_kg, actor: uname(m.actor_id), approver: uname(m.approver_id), reason: m.reason }));
    } else fail('ประเภทรายงานไม่ถูกต้อง');
    return { kind: k, from: f, to: t, columns: c, rows };
  };

  // ---------- เริ่มต้นข้อมูล ----------
  function install() {
    db = empty();
    db.settings = {
      thresholds: { value: { low_stock_kg: 200, near_ripe_days: 5, aging_days: 7, weight_variance_pct: 5, std_basket_kg: 20, receive_deadline_hours: 4 } },
      options: { value: { require_receive_photo: true, require_waste_photo: true, max_sales_discount_pct: 5 } },
      company: { value: { name: '', address: '', tax_id: '', phone: '' } },
    };
    ins('sites', { code: 'CW', name: 'คลังกลาง', kind: 'warehouse', active: true, sort: 1, updated_by: null, updated_at: nowIso() });
    [['HASS', 'Hass', 1], ['BUCC', 'บัคคาเนีย', 2], ['BOOTH7', 'Booth 7', 3], ['PETER', 'ปีเตอร์สัน', 4]].forEach(([code, name, sort]) => ins('varieties', { code, name, active: true, sort, updated_by: null, updated_at: nowIso() }));
    [['S', 'S', null, 179, 1], ['M', 'M', 180, 219, 2], ['180', '180+', 180, null, 3], ['220', '220+', 220, null, 4], ['L', 'L', 220, 299, 5], ['XL', 'XL', 300, null, 6]]
      .forEach(([code, name, min_g, max_g, sort]) => ins('sizes', { code, name, min_g, max_g, active: true, sort, updated_by: null, updated_at: nowIso() }));
  }

  function save() { try { localStorage.setItem(storageKey, JSON.stringify(db)); } catch (e) { /* ไม่มีพื้นที่เก็บ — ทำงานในหน่วยความจำ */ } }
  function load() { try { const s = localStorage.getItem(storageKey); if (s) { db = JSON.parse(s); return true; } } catch (e) { /* ignore */ } return false; }

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
