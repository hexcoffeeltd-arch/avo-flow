// =====================================================================
// ข้อมูลตัวอย่างสำหรับโหมดทดลอง (ชื่อสวน/ลูกค้า/ตัวเลขเป็นข้อมูลสมมติ)
// สร้างผ่าน API จริงทีละขั้น จึงผ่านกฎธุรกิจเดียวกับระบบจริงทุกข้อ
// =====================================================================
export const DEMO_USERS = [
  { sub: 'demo-admin', name: 'ผู้ดูแลระบบ', role: 'admin', desc: 'ทุกเมนู · ตั้งค่า · ผู้ใช้' },
  { sub: 'demo-whm', name: 'สมศักดิ์ (ผจก.คลัง)', role: 'warehouse', manager: true, site: 'CW', desc: 'รับเข้า · อนุมัติตีออก' },
  { sub: 'demo-wh', name: 'นิด (พนักงานคลัง)', role: 'warehouse', site: 'CW', desc: 'รับเข้า · ตรวจความสุก · สร้างใบตีออก' },
  { sub: 'demo-brm', name: 'แพร (ผจก.สาขา NWW)', role: 'branch', manager: true, site: 'NWW', desc: 'รับของ · อนุมัติตัดทิ้ง' },
  { sub: 'demo-br', name: 'ต้น (สาขา NWW)', role: 'branch', site: 'NWW', desc: 'หน้าร้าน · หลังร้าน · แช่แข็ง' },
  { sub: 'demo-sales', name: 'มายด์ (ฝ่ายขาย)', role: 'sales', desc: 'ลูกค้า · ใบเสนอราคา · ทำบิล' },
  { sub: 'demo-exec', name: 'คุณวิทย์ (ผู้บริหาร)', role: 'executive', desc: 'ภาพรวม · ราคา · อนุมัติ' },
];

const photo = (label, color = '#1f5a49') => 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320"><rect width="480" height="320" fill="#eef3ef"/>` +
  `<rect x="90" y="120" width="300" height="150" rx="14" fill="${color}" opacity=".85"/>` +
  `<g fill="#a9c77a">${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${135 + i * 52}" cy="112" rx="24" ry="30"/>`).join('')}</g>` +
  `<text x="240" y="210" font-family="sans-serif" font-size="22" fill="#fff" text-anchor="middle">${label}</text>` +
  `<text x="240" y="300" font-family="sans-serif" font-size="14" fill="#6b7a72" text-anchor="middle">ภาพตัวอย่าง (ข้อมูลจำลอง)</text></svg>`)));

const daysAgo = (d, hh = 8, mm = 30) => {
  const t = new Date(Date.now() - d * 86400e3);
  const bkk = new Date(t.getTime() + 7 * 3600e3);
  return new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate(), hh - 7, mm)).toISOString();
};

/** call(sub, fn, p) → result */
export async function seedDemo(call) {
  const A = 'demo-admin';
  const me = await call(A, 'api_me', {});
  const m = me.master;
  const V = Object.fromEntries(m.varieties.map((x) => [x.code, x.id]));
  const S = Object.fromEntries(m.sizes.map((x) => [x.code, x.id]));
  const CW = m.sites.find((s) => s.code === 'CW').id;
  const NWW = (await call(A, 'api_master_save', { entity: 'site', row: { code: 'NWW', name: 'สาขา NWW', kind: 'branch', sort: 1 } })).id;
  await call(A, 'api_master_save', { entity: 'site', row: { code: 'CNX', name: 'สาขาเชียงใหม่', kind: 'branch', sort: 2 } });
  const siteId = { CW, NWW };

  for (const u of DEMO_USERS.slice(1)) await call(u.sub, 'api_me', { name: u.name });
  const users = await call(A, 'api_users', {});
  for (const u of DEMO_USERS.slice(1)) {
    const row = users.find((x) => x.email === u.sub + '@demo.local' || x.display_name === u.name);
    await call(A, 'api_user_save', { id: row.id, role: u.role, site_id: u.site ? siteId[u.site] : null, is_manager: !!u.manager, display_name: u.name });
  }
  await call(A, 'api_settings_save', { key: 'company', value: { name: 'บริษัท ตัวอย่าง อะโวคาโด จำกัด', address: '99 หมู่ 1 ต.ตัวอย่าง อ.เมือง จ.น่าน 55000', tax_id: '0-5555-60000-00-1', phone: '054-000-000', branch: 'สำนักงานใหญ่' } });

  const WH = 'demo-wh', WHM = 'demo-whm', BR = 'demo-br', BRM = 'demo-brm', SALES = 'demo-sales', EX = 'demo-exec';
  const sup = {};
  for (const [k, row] of Object.entries({
    noi: { name: 'สวนคุณหน่อย', contact: 'คุณหน่อย', phone: '081-111-2222', province: 'น่าน', varieties: 'Hass', buy_price: 42 },
    cm: { name: 'สวนเชียงใหม่', contact: 'ลุงคำ', phone: '089-333-4444', province: 'เชียงใหม่', varieties: 'บัคคาเนีย, Hass', buy_price: 28 },
    hill: { name: 'สวนภูเขา', contact: 'พี่ดาว', phone: '086-555-6666', province: 'ตาก', varieties: 'Hass', buy_price: 38 },
    chai: { name: 'สวนลุงชัย', contact: 'ลุงชัย', phone: '087-777-8888', province: 'เลย', varieties: 'Booth 7, ปีเตอร์สัน', buy_price: 25 },
  })) sup[k] = (await call(WH, 'api_supplier_save', row)).id;

  const cust = {};
  for (const [k, row] of Object.entries({
    nww: { name: 'บริษัท NWW', channel: 'wholesale', address: '12 ถ.สุขุมวิท กรุงเทพฯ 10110', phone: '02-000-1111', tax_id: '0105500000000' },
    dc: { name: 'DC ซูเปอร์มาร์เก็ต', channel: 'dc', address: 'ศูนย์กระจายสินค้า ลำลูกกา ปทุมธานี', phone: '02-000-2222' },
    online: { name: 'ร้านออนไลน์ (เว็บไซต์)', channel: 'online', ctype: 'company' },
    tiktok: { name: 'TikTok Shop', channel: 'tiktok' },
    cafe: { name: 'คาเฟ่ กรีนโบวล์', channel: 'retail', ctype: 'person', phone: '090-000-3333' },
  })) cust[k] = (await call(SALES, 'api_customer_save', row)).id;

  for (const [v, s, pr] of [['HASS', '220', 70], ['HASS', '180', 60], ['HASS', 'M', 55], ['BUCC', 'M', 45], ['BUCC', 'L', 50], ['BOOTH7', 'L', 40], ['PETER', 'M', 38]])
    await call(EX, 'api_price_save', { variety_id: V[v], size_id: S[s], sell_price: pr });
  await call(EX, 'api_price_save', { variety_id: V.HASS, size_id: S['220'], product: 'frozen', sell_price: 120 });
  await call(EX, 'api_price_save', { customer_id: cust.nww, variety_id: V.HASS, size_id: S['220'], sell_price: 68 });

  const receipt = async (who, supplier, when, lines, confirm = true, rejected = null) => {
    let r = await call(who, 'api_receipt_save', { supplier_id: supplier, received_at: when, submit: true, lines, evidence: await call(who, 'api_attachment_save', { data: photo('ใบชั่งน้ำหนัก') }).then((x) => x.ref) });
    if (confirm) r = await call(WH, 'api_receipt_confirm', { id: r.id, lines: rejected ? r.lines.map((l, i) => ({ id: l.id, rejected_kg: rejected[i] || 0 })) : [] });
    return r;
  };
  const r1 = await receipt(WH, sup.noi, daysAgo(8, 7, 40), [{ variety_id: V.HASS, size_id: S['220'], ripeness: 'raw', baskets: 12, gross_kg: 252, tare_kg: 12, pieces: 1000, unit_cost: 42 }]);
  const r2 = await receipt(WH, sup.cm, daysAgo(6, 9, 10), [{ variety_id: V.BUCC, size_id: S.M, ripeness: 'raw', baskets: 10, gross_kg: 205, tare_kg: 10, unit_cost: 28 }]);
  const r3 = await receipt(WH, sup.hill, daysAgo(3, 8, 5), [
    { variety_id: V.HASS, size_id: S['180'], ripeness: 'raw', baskets: 18, gross_kg: 372, tare_kg: 18, unit_cost: 38 },
    { variety_id: V.HASS, size_id: S.M, ripeness: 'raw', baskets: 6, gross_kg: 118, tare_kg: 6, unit_cost: 34 }]);
  const r4 = await receipt(WH, sup.chai, daysAgo(1, 10, 20), [{ variety_id: V.BOOTH7, size_id: S.L, ripeness: 'breaking', baskets: 14, gross_kg: 290, tare_kg: 14, unit_cost: 25 }], true, [6]);
  await receipt(WH, sup.noi, daysAgo(0, 7, 15), [{ variety_id: V.HASS, size_id: S['220'], ripeness: 'raw', baskets: 8, estimated: true, unit_cost: 42 }], false);
  const L1 = r1.lines[0].lot_id, L2 = r2.lines[0].lot_id, L3 = r3.lines[0].lot_id, L3b = r3.lines[1].lot_id, L4 = r4.lines[0].lot_id;

  // ตรวจความสุกในคลัง
  await call(WH, 'api_ripeness_change', { site_id: CW, zone: 'main', lot_id: L1, from: 'raw', to: 'ripe', kg: 150, baskets: 7, note: 'กดนุ่ม สีเข้ม' });
  await call(WH, 'api_ripeness_change', { site_id: CW, zone: 'main', lot_id: L1, from: 'raw', to: 'breaking', kg: 50, baskets: 3, note: 'เริ่มนิ่ม' });
  await call(WH, 'api_ripeness_change', { site_id: CW, zone: 'main', lot_id: L1, from: 'ripe', to: 'overripe', kg: 12, baskets: 1, note: 'นิ่มมาก ผิวดำ' });
  await call(WH, 'api_ripeness_change', { site_id: CW, zone: 'main', lot_id: L2, from: 'raw', to: 'breaking', kg: 120, baskets: 6 });

  // โอนไปสาขา NWW — รับบางส่วน (ส่ง 50 รับจริง 48)
  let t1 = await call(WH, 'api_dispatch_save', { kind: 'transfer', from_site_id: CW, to_site_id: NWW, carrier: 'รถบริษัท', vehicle: 'บต-1234', packer: 'นิด',
    lines: [{ lot_id: L1, ripeness: 'ripe', kg: 50, baskets: 3 }, { lot_id: L2, ripeness: 'breaking', kg: 40, baskets: 2 }] });
  t1 = await call(WHM, 'api_dispatch_ship', { id: t1.id });
  const ev1 = (await call(BR, 'api_attachment_save', { data: photo('สภาพสินค้าถึงสาขา') })).ref;
  await call(BR, 'api_dispatch_receive', { id: t1.id, receiver_name: 'ต้น', evidence: ev1, note: 'มีผลช้ำ 1 ถุง',
    lines: [{ id: t1.lines[0].id, received_kg: 48, received_baskets: 3 }, { id: t1.lines[1].id, received_kg: 40, received_baskets: 2 }] });

  // โอนรอบสอง — ส่งแล้ว รอรับ
  const t2 = await call(WH, 'api_dispatch_save', { kind: 'transfer', from_site_id: CW, to_site_id: NWW, carrier: 'รถบริษัท', lines: [{ lot_id: L3, ripeness: 'raw', kg: 80, baskets: 4 }] });
  await call(WHM, 'api_dispatch_ship', { id: t2.id });

  // งานสาขา
  await call(BR, 'api_zone_transfer', { site_id: NWW, from_zone: 'back', to_zone: 'front', lot_id: L1, ripeness: 'ripe', kg: 30, baskets: 2 });
  await call(BR, 'api_ripeness_change', { site_id: NWW, zone: 'back', lot_id: L2, from: 'breaking', to: 'ripe', kg: 15, baskets: 1 });
  await call(BR, 'api_freeze', { site_id: NWW, from_zone: 'back', lot_id: L1, ripeness: 'ripe', input_kg: 12, output_kg: 8.4, bags: 21, note: 'เนื้อบด ถุงละ 400 กรัม' });
  await call(BR, 'api_adjust_request', { kind: 'retail_sale', site_id: NWW, zone: 'front', lot_id: L1, ripeness: 'ripe', kg: 6, amount: 540 });
  const wev = (await call(BR, 'api_attachment_save', { data: photo('ผลเน่า', '#8a4b35') })).ref;
  await call(BR, 'api_adjust_request', { kind: 'waste', site_id: NWW, zone: 'front', lot_id: L1, ripeness: 'ripe', kg: 2, reason: 'ผลช้ำ เนื้อดำ', evidence: wev });

  // ขาย: บริษัท NWW รับแล้ว ออกบิลบางส่วน
  let s1 = await call(WH, 'api_dispatch_save', { kind: 'sale', from_site_id: CW, customer_id: cust.nww, carrier: 'Kerry Cool',
    lines: [{ lot_id: L1, ripeness: 'ripe', kg: 60, baskets: 3 }, { lot_id: L2, ripeness: 'breaking', kg: 50, baskets: 2 }] });
  s1 = await call(WHM, 'api_dispatch_ship', { id: s1.id });
  const ev2 = (await call(SALES, 'api_attachment_save', { data: photo('ลูกค้าเซ็นรับ') })).ref;
  s1 = await call(SALES, 'api_dispatch_receive', { id: s1.id, receiver_name: 'คุณเอ (NWW)', evidence: ev2 });
  await call(SALES, 'api_invoice_create', { customer_id: cust.nww, vat_rate: 0, shipping: 0, lines: [{ dispatch_line_id: s1.lines[0].id, kg: 60, price: 68 }] });

  // ขายออนไลน์ ส่งแล้ว รับครบ ยังไม่ออกบิล
  let s2 = await call(WH, 'api_dispatch_save', { kind: 'sale', from_site_id: CW, customer_id: cust.online, carrier: 'Flash Express', lines: [{ lot_id: L3b, ripeness: 'raw', kg: 25, baskets: 1 }] });
  s2 = await call(WHM, 'api_dispatch_ship', { id: s2.id });
  await call(WH, 'api_dispatch_receive', { id: s2.id, receiver_name: 'ลูกค้าออนไลน์ 5 ราย', evidence: ev2 });

  // ใบตีออกร่าง (จองสต็อก) รอผู้จัดการยืนยัน
  const dcDraft = await call(WH, 'api_dispatch_save', { kind: 'sale', from_site_id: CW, customer_id: cust.dc, carrier: 'รถห้องเย็น DC', lines: [{ lot_id: L3, ripeness: 'raw', kg: 120, baskets: 6 }, { lot_id: L4, ripeness: 'breaking', kg: 60, baskets: 3 }] });

  // ใบเสนอราคา
  await call(SALES, 'api_quote_save', { customer_id: cust.tiktok, valid_until: new Date(Date.now() + 7 * 86400e3).toISOString().slice(0, 10), status: 'sent',
    lines: [{ variety_id: V.HASS, size_id: S['220'], kg: 100, price: 70 }, { variety_id: V.BUCC, size_id: S.M, kg: 50, price: 45 }], note: 'ราคาส่งรายสัปดาห์' });

  // ---------- รุ่น 2 ----------
  // กรอบราคาที่อนุมัติล่วงหน้า + ใบกำกับภาษีเต็มรูป
  await call(EX, 'api_price_save', { variety_id: V.HASS, size_id: S['180'], sell_price: 60, min_price: 57, max_price: 63 });
  await call(SALES, 'api_invoice_create', { customer_id: cust.nww, doc_type: 'tax_invoice', vat_rate: 7, lines: [{ dispatch_line_id: s1.lines[1].id, kg: 20, price: 45 }] });
  // ลูกค้าเคลมของที่ออกบิลแล้ว → อนุมัติ → ใบลดหนี้
  const cev = (await call(SALES, 'api_attachment_save', { data: photo('ผลเนื้อดำที่ลูกค้าเคลม', '#8a4b35') })).ref;
  const rt1 = await call(SALES, 'api_return_create', { dispatch_id: s1.id, reason: 'ลูกค้าแจ้งเนื้อดำ 3 กก.', evidence: cev, lines: [{ dispatch_line_id: s1.lines[0].id, kg: 3, disposition: 'discard' }] });
  await call(EX, 'api_return_decide', { id: rt1.id, approve: true, note: 'ตรวจรูปแล้ว' });
  const inv1 = (await call(SALES, 'api_invoices', { customer_id: cust.nww })).find((i) => i.doc_type === 'invoice');
  const invFull = await call(SALES, 'api_invoice_get', { id: inv1.id });
  await call(SALES, 'api_credit_note_create', { invoice_id: inv1.id, return_id: rt1.id, reason: 'ลูกค้าเคลมเนื้อดำ', lines: [{ invoice_line_id: invFull.lines[0].id, kg: 3 }] });
  // ลูกค้าออนไลน์ขอคืน รอผู้จัดการอนุมัติ
  await call(SALES, 'api_return_create', { dispatch_id: s2.id, reason: 'ลูกค้าได้ของเกิน ส่งคืน', evidence: cev, lines: [{ dispatch_line_id: s2.lines[0].id, kg: 2, disposition: 'restock', ripeness: 'breaking' }] });
  // ชั่งซ้ำระหว่างบ่ม (หายเล็กน้อย บันทึกอัตโนมัติ)
  const l3row = (await call(WH, 'api_stock', { site_id: CW })).find((r) => r.lot_id === L3 && r.ripeness === 'raw');
  if (l3row) await call(WH, 'api_reweigh', { site_id: CW, zone: 'main', lot_id: L3, ripeness: 'raw', weighed_kg: Math.round((l3row.kg - 4) * 100) / 100, note: 'ชั่งซ้ำรอบเช้า' });
  // สาขาเปิดใบตรวจนับ (ยังนับไม่ครบ)
  await call(BR, 'api_stocktake_start', { site_id: NWW, note: 'นับสิ้นสัปดาห์' });
  // ผู้บริหารมอบหมายงาน: ใบตีออก DC ให้ผู้จัดการคลังยืนยันภายใน 3 ชม.
  const whmRow = (await call(A, 'api_users', {})).find((u) => u.display_name === 'สมศักดิ์ (ผจก.คลัง)');
  await call(EX, 'api_assign', { entity: 'dispatch', id: dcDraft.id, assignee_id: whmRow.id, due_at: new Date(Date.now() + 3 * 3600e3).toISOString(), note: 'รถ DC มารับบ่ายนี้' });
}
