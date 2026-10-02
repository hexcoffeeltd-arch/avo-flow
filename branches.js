import { $, $$, esc, fmtN, thDate, thDateTime, ripBadge, statusBadge, RIP, RIP_ORDER, ZONE, table, opt } from './ui.js';
import { lotTrace, dispatchForm, dispatchView, ripenessModal, reweighModal, zoneTransferModal, freezeModal, adjustModal, approvalsModal, stocktakeStart, stocktakeView, onChange } from './docs.js';

let current = null;

export async function render(el, ctx, params) {
  onChange(ctx, () => ctx.page === 'branches' && render(el, ctx, params));
  const branches = ctx.master.sites.filter((s) => s.kind === 'branch' && s.active && (ctx.me.role !== 'branch' || s.id === ctx.me.site_id));
  if (params[0]) current = Number(params[0]);
  if (!branches.find((b) => b.id === current)) current = ctx.me.role === 'branch' ? ctx.me.site_id : branches[0]?.id;
  if (!current) { el.innerHTML = `<div class="page-head"><div><h1>สาขาและส่งต่องาน</h1></div></div><div class="card empty">ยังไม่มีสาขา ${ctx.can.settings ? '— เพิ่มได้ที่ <a href="#/settings/master">ตั้งค่า → ข้อมูลหลัก</a>' : ''}</div>`; return; }
  const b = await ctx.api.rpc('api_branch_stock', { site_id: current });
  const outgoing = (await ctx.api.rpc('api_dispatches', { site_id: current, status: 'draft,shipped,partial' })).filter((d) => d.from_site_id === current);
  const stock = await ctx.api.rpc('api_stock', { site_id: current });
  const openSt = (await ctx.api.rpc('api_stocktakes', { site_id: current, status: 'draft,submitted' }).catch(() => []))[0];
  const act = ctx.can.actAt(current); const approver = ctx.can.approveAt(current);
  const whs = ctx.master.sites.filter((s) => s.kind === 'warehouse' && ctx.can.actAt(s.id));
  const z = (k) => b.zones[k] || [];
  const zoneCard = (k, title) => `<div class="card"><div class="card-title" style="margin-bottom:8px">${title}</div>
    ${['ripe', 'breaking', 'raw', 'overripe'].filter((r) => r !== 'overripe' || z(k).some((x) => x.ripeness === 'overripe')).map((r) => { const x = z(k).find((y) => y.ripeness === r);
      return `<div class="zone-row"><span>${RIP[r]}</span><span class="num">${fmtN(x?.baskets || 0)} ตะกร้า <span class="small muted">· ${fmtN(x?.kg || 0)} กก.</span></span></div>`; }).join('')}</div>`;
  const fr = z('frozen'); const frBags = fr.reduce((a, x) => a + Number(x.bags), 0); const frKg = fr.reduce((a, x) => a + Number(x.kg), 0); const frLots = fr.reduce((a, x) => a + Number(x.lots), 0);
  const incomingLines = b.incoming.flatMap((d) => d.lines.map((l) => ({ d, l })));
  const partial = b.incoming.filter((d) => d.status === 'partial').length;

  el.innerHTML = `<div class="page-head"><div><h1>สาขาและส่งต่องาน</h1><div class="sub">${branches.length > 1 ? '' : `<b>${esc(b.site.name)}</b> · `}ดูสินค้าหน้าร้าน หลังร้าน แช่แข็ง และงานระหว่างขนส่ง</div></div>
      <div class="actions">${whs.length ? '<button class="btn primary" id="tr">+ โอนสต็อก</button>' : act ? '<button class="btn primary" id="tr-out">+ โอนออก / ส่งลูกค้า</button>' : ''}</div></div>
    ${branches.length > 1 ? `<div class="seg"><select class="input" id="pick" style="width:auto;min-width:220px;height:42px" aria-label="เลือกสาขา">${opt(branches, b.site.id)}</select></div>` : ''}
    ${act ? `<div class="toolbar">
      <button class="btn sm" data-op="zone">ย้ายหลังร้าน → หน้าร้าน</button><button class="btn sm" data-op="rip">ตรวจความสุก</button><button class="btn sm" data-op="freeze">แปรรูปแช่แข็ง</button>
      <button class="btn sm" data-op="retail_sale">ขายหน้าร้าน</button><button class="btn sm" data-op="internal_use">นำไปใช้</button><button class="btn sm" data-op="waste">ตัดทิ้ง</button><button class="btn sm" data-op="count_adjust">ปรับยอดนับจริง</button>
      <button class="btn sm" data-op="reweigh">ชั่งซ้ำ</button><button class="btn sm ${openSt ? 'primary' : ''}" data-op="stocktake">${openSt ? 'ใบตรวจนับ ' + esc(openSt.doc_no) : 'ตรวจนับทั้งสาขา'}</button>
      <button class="btn sm ${b.pending_adjustments ? 'primary' : ''}" data-op="approve">รออนุมัติ ${b.pending_adjustments}</button></div>` : ''}
    <div class="row-3">${zoneCard('front', 'หน้าร้าน')}${zoneCard('back', 'หลังร้าน')}
      <div class="card"><div class="card-title" style="margin-bottom:8px">แช่แข็ง</div>
        <div class="zone-row"><span>จำนวนถุง</span><span class="num">${fmtN(frBags)} ถุง</span></div><div class="zone-row"><span>น้ำหนักรวม</span><span class="num">${fmtN(frKg)} กก.</span></div><div class="zone-row"><span>Lot ที่ใช้</span><span class="num">${frLots} Lot</span></div></div></div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">งานส่งต่อที่รอรับ</div><div class="card-sub">ยืนยันรับตามน้ำหนักจริงและเก็บหลักฐาน</div></div>${partial ? `<span class="badge b-warn">${partial} รายการรับบางส่วน</span>` : ''}</div>
      ${table([
        { label: 'ใบโอน', render: (x) => esc(x.d.doc_no) },
        { label: 'ต้นทาง', render: (x) => esc(x.d.from_site) },
        { label: 'Lot', render: (x) => `<span class="lot">${esc(x.l.lot_code)}</span>` },
        { label: 'ส่งมา', render: (x) => `${fmtN(x.l.kg)} กก.` },
        { label: 'รับจริง', render: (x) => (x.l.received_kg != null ? `${fmtN(x.l.received_kg)} กก.` : '—') },
        { label: 'สถานะ', right: true, render: (x) => (x.d.status === 'partial' && Number(x.l.received_kg) < Number(x.l.kg) ? `<span class="badge b-warn">รอตรวจ ${fmtN(x.l.kg - x.l.received_kg)} กก.</span>` : x.d.status === 'partial' ? '<span class="badge b-ok">รับครบ</span>' : statusBadge('dispatch', x.d.status)) },
      ], incomingLines, { rowAttr: (x) => `class="click" data-d="${x.d.id}"`, empty: 'ไม่มีสินค้ารอรับ' })}</div>
    ${outgoing.length ? `<div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">ใบส่งออกจากสาขา</div><div class="card-sub">ใบร่างรอผู้จัดการยืนยัน และของที่ส่งแล้วรอปลายทาง/ลูกค้ารับ</div></div></div>
      ${table([{ label: 'เลขที่', render: (d) => `<b>${esc(d.doc_no)}</b>` }, { label: 'ประเภท', render: (d) => (d.kind === 'sale' ? 'ขาย' : 'โอน') }, { label: 'ปลายทาง', render: (d) => esc(d.destination) },
        { label: 'กก.', right: true, render: (d) => fmtN(d.total_kg) }, { label: 'สถานะ', right: true, render: (d) => statusBadge('dispatch', d.status) }], outgoing, { rowAttr: (d) => `class="click" data-d="${d.id}"` })}</div>` : ''}
    <div class="card" style="margin-bottom:14px"><div class="card-head"><div><div class="card-title">สต็อกสาขารายการ Lot</div><div class="card-sub">กด Lot เพื่อย้อนดูสวนต้นทาง</div></div></div>
      ${table([
        { label: 'จุด', render: (r) => ZONE[r.zone] }, { label: 'Lot', render: (r) => `<span class="lot">${esc(r.lot_code)}</span>` },
        { label: 'สินค้า', render: (r) => `${esc(r.variety || '-')} · ${esc(r.size || '-')}` }, { label: 'ความสุก', render: (r) => ripBadge(r.ripeness) },
        { label: 'รับเข้า', render: (r) => `${thDate(r.received_at)} <span class="small muted">(${r.age_days} วัน)</span>` },
        { label: 'คงเหลือ', right: true, render: (r) => (Number(r.kg) < 0 ? `<b class="bad">${fmtN(r.kg)} กก.</b><div class="small bad">ติดลบ · รอเคลียร์</div>`
          : `<b>${fmtN(r.kg)} กก.</b><div class="small muted">${r.bags ? fmtN(r.bags) + ' ถุง' : fmtN(r.baskets) + ' ตะกร้า'}${r.est_pieces ? ' · ≈' + fmtN(r.est_pieces) + ' ลูก' : ''}</div>`) },
        { label: '', render: (r) => (!act ? '' : Number(r.kg) < 0 ? `<span class="actions" style="justify-content:flex-end"><button class="btn sm" data-q="adj" data-k="${r.lot_id}|${r.ripeness}|${r.zone}|${-Number(r.kg)}">ปรับยอด</button></span>`
          : `<span class="actions" style="justify-content:flex-end">${r.product === 'fresh' ? `<button class="btn sm" data-q="rip" data-k="${r.lot_id}|${r.ripeness}|${r.zone}">ความสุก</button><button class="btn sm" data-q="rw" data-k="${r.lot_id}|${r.ripeness}|${r.zone}">ชั่งซ้ำ</button>` : ''}<button class="btn sm" data-q="waste" data-k="${r.lot_id}|${r.ripeness}|${r.zone}">ตัดทิ้ง</button></span>`) },
      ], stock.sort((a, c) => a.zone.localeCompare(c.zone) || c.rip_rank - a.rip_rank), { rowAttr: (r) => `class="click" data-lot="${r.lot_id}"`, empty: 'ยังไม่มีสต็อกที่สาขานี้' })}</div>
    ${b.recent.length ? `<div class="card"><div class="card-title" style="margin-bottom:10px">รับล่าสุด</div>${table([{ label: 'ใบโอน', key: 'doc_no' }, { label: 'ต้นทาง', key: 'from_site' }, { label: 'รับเมื่อ', render: (d) => thDateTime(d.received_at) }, { label: 'ส่ง / รับ', right: true, render: (d) => `${fmtN(d.total_kg)} / ${fmtN(d.total_received_kg)} กก.` }, { label: 'ผู้รับ', key: 'receiver_name' }, { label: '', right: true, render: (d) => statusBadge('dispatch', d.status) }], b.recent, { rowAttr: (d) => `class="click" data-d="${d.id}"` })}</div>` : ''}
    <div class="foot-note"><b>กฎสต็อก</b> คลัง → ระหว่างทาง → สาขา · ไม่นับยอดซ้ำ · ตัดทิ้งและปรับยอดต้องให้ผู้จัดการสาขาอนุมัติ</div>`;

  const p = $('#pick', el); if (p) p.onchange = () => { if (p.value && Number(p.value) !== b.site.id) ctx.go('branches/' + p.value); };
  const tr = $('#tr', el); if (tr) tr.onclick = () => dispatchForm(ctx, { kind: 'transfer', from_site_id: whs[0].id, to_site_id: current });
  const to = $('#tr-out', el); if (to) to.onclick = () => dispatchForm(ctx, { kind: 'transfer', from_site_id: current });
  $$('[data-d]', el).forEach((r) => (r.onclick = () => dispatchView(ctx, Number(r.dataset.d))));
  $$('tr[data-lot]', el).forEach((r) => (r.onclick = (e) => { if (e.target.closest('button')) return; lotTrace(ctx, Number(r.dataset.lot)); }));
  $$('[data-op]', el).forEach((btn) => (btn.onclick = () => {
    const op = btn.dataset.op;
    if (op === 'zone') zoneTransferModal(ctx, current);
    else if (op === 'rip') ripenessModal(ctx, { site_id: current, zone: 'back' });
    else if (op === 'freeze') freezeModal(ctx, current);
    else if (op === 'approve') approvalsModal(ctx, current);
    else if (op === 'reweigh') reweighModal(ctx, { site_id: current, zone: 'back' });
    else if (op === 'stocktake') { if (openSt) stocktakeView(ctx, openSt.id); else stocktakeStart(ctx, current); }
    else adjustModal(ctx, current, op);
  }));
  $$('[data-q]', el).forEach((btn) => (btn.onclick = () => { const [lot_id, ripeness, zone, kg] = btn.dataset.k.split('|');
    if (btn.dataset.q === 'adj') adjustModal(ctx, current, 'count_adjust', { lot_id, ripeness, zone, kg: Number(kg), reason: 'เคลียร์ยอดติดลบ: ' });
    else if (btn.dataset.q === 'rip') ripenessModal(ctx, { site_id: current, zone, preset: { lot_id, ripeness } });
    else if (btn.dataset.q === 'rw') reweighModal(ctx, { site_id: current, zone, preset: { lot_id, ripeness } });
    else adjustModal(ctx, current, 'waste', { lot_id, ripeness, zone }); }));
}
