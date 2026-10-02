// =====================================================================
// ใบตีออก / ใบโอน แบบเอกสาร A4: ดูตัวอย่าง · ดาวน์โหลด PDF · แชร์ · พิมพ์ · มีช่องเซ็นผู้ส่ง / ผู้รับ
// วาดเอกสารลง canvas ด้วยฟอนต์ของเบราว์เซอร์ (ภาษาไทยแสดงถูกต้อง) แล้วประกอบเป็นไฟล์ PDF เอง
// ไม่ใช้ไลบรารีภายนอก จึงใช้ได้แม้ไม่มีสัญญาณ
// =====================================================================
import { $, esc, fmtN, thDateY, thDateTime, RIP, RIP_ORDER, ZONE, CHANNEL, openModal, toast, busy } from './ui.js';

const PT = { w: 595.28, h: 841.89, m: 36 };            // A4 หน่วยพอยต์ · ขอบ 0.5 นิ้ว
const SCALE = 3;                                        // 216 จุด/นิ้ว
const FONT = '"Noto Sans Thai", "Noto Sans", "Sarabun", "Leelawadee UI", "Thonburi", "Tahoma", sans-serif';
const INK = '#1c2a24'; const MUTED = '#5d6b64'; const LINE = '#c5d0ca'; const BAND = '#eef3f0'; const GREEN = '#1f5a49'; const WARN = '#9a6412'; const RED = '#9c3b27';
const CW = PT.w - PT.m * 2;                             // ความกว้างเนื้อหา

// ---------- ข้อมูลของใบ (รวมบรรทัดเป็น 1 แถวต่อ Lot แยกน้ำหนักตามความสุก) ----------
export function slipModel(ctx, d) {
  const co = ctx.master?.settings?.company || {}; const frozen = d.from_zone === 'frozen'; const isSale = d.kind === 'sale';
  const rows = []; const byLot = new Map();
  (d.lines || []).forEach((l) => {
    let r = byLot.get(l.lot_id);
    if (!r) { r = { lot: l.lot_code, product: [l.variety, l.size].filter(Boolean).join(' · ') || '-', kg: {}, total: 0, units: 0, detail: '' }; byLot.set(l.lot_id, r); rows.push(r); }
    r.kg[l.ripeness] = (r.kg[l.ripeness] || 0) + Number(l.kg); r.total += Number(l.kg); r.units += Number((frozen ? l.bags : l.baskets) || 0);
    if (l.detail && !r.detail) r.detail = l.detail;
  });
  const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
  return {
    docNo: d.doc_no, frozen, isSale,
    company: { name: co.name || 'AVO FLOW', lines: [co.address, [co.tax_id ? 'เลขประจำตัวผู้เสียภาษี ' + co.tax_id : '', co.phone ? 'โทร ' + co.phone : ''].filter(Boolean).join(' · ')].filter(Boolean) },
    title: 'ใบตีออกสินค้า', kindLabel: isSale ? 'ขาย / ส่งลูกค้า' : 'โอนระหว่างคลัง / สาขา',
    date: thDateY(d.doc_date || d.created_at),
    tag: d.status === 'draft' ? { text: 'ฉบับร่าง · ยังไม่ยืนยันตีออก', color: WARN } : d.status === 'cancelled' ? { text: 'ยกเลิกแล้ว', color: RED } : null,
    from: { name: d.from_site || '-', lines: ['จุดจัดเก็บ: ' + (ZONE[d.from_zone] || d.from_zone)] },
    to: { name: d.destination || '-', lines: [isSale && d.channel ? 'ช่องทาง: ' + (CHANNEL[d.channel] || d.channel) : '', d.destination_address || '', d.destination_phone ? 'โทร ' + d.destination_phone : '',
      !isSale && d.to_zone ? 'จุดจัดเก็บ: ' + (ZONE[d.to_zone] || d.to_zone) : ''].filter(Boolean) },
    meta: [['ผู้ขนส่ง', d.carrier], ['ทะเบียนรถ / เลขพัสดุ', d.vehicle], ['ผู้แพ็ค / ผู้จ่าย', d.packer], ['ผู้ยืนยันตีออก', d.shipped_by_name]].map(([k, v]) => [k, v || '—']),
    rows, totals: { kg: Object.fromEntries((frozen ? ['na'] : RIP_ORDER).map((k) => [k, sum((r) => r.kg[k] || 0)])), total: sum((r) => r.total), units: sum((r) => r.units) },
    details: d.details || '', note: d.note || '',
    edited: d.edited_at ? `แก้ไขหลังตีออก ${thDateTime(d.edited_at)} โดย ${d.edited_by_name || '-'}${d.edit_reason ? ' · ' + d.edit_reason : ''}` : '',
    sender: { place: d.from_site || '', record: d.shipped_at ? `ยืนยันตีออกในระบบ: ${d.shipped_by_name || '-'} · ${thDateTime(d.shipped_at)}` : '' },
    receiver: { place: d.destination || '', record: d.received_at ? `ยืนยันรับในระบบ: ${d.receiver_name || '-'} · ${thDateTime(d.received_at)}` : '' },
    printedAt: thDateTime(new Date().toISOString()),
  };
}

// ---------- ตัดบรรทัดภาษาไทย ----------
function segments(text) {
  try { if (typeof Intl !== 'undefined' && Intl.Segmenter) return [...new Intl.Segmenter('th', { granularity: 'word' }).segment(text)].map((s) => s.segment); } catch (e) { /* ใช้วิธีสำรอง */ }
  // ไม่มีตัวตัดคำ: แบ่งที่ช่องว่าง และไม่แยกสระบน/ล่าง วรรณยุกต์ ออกจากพยัญชนะ
  return text.match(/\s+|[^\sัิ-ฺ็-๎][ัิ-ฺ็-๎]*/gu) || [];
}
const clusters = (s) => s.match(/[^ัิ-ฺ็-๎][ัิ-ฺ็-๎]*/gu) || [s];
export function wrapText(g, text, maxW) {
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((para) => {
    let line = '';
    const put = (seg) => {
      if (g.measureText((line + seg).trimEnd()).width <= maxW) { line += seg; return; }
      if (line.trim()) { out.push(line.trimEnd()); line = ''; seg = seg.replace(/^\s+/, ''); if (!seg) return; }
      if (g.measureText(seg).width <= maxW) { line = seg; return; }
      for (const ch of clusters(seg)) {                 // คำเดียวยาวเกินบรรทัด: ตัดทีละตัวอักษร
        if (line && g.measureText(line + ch).width > maxW) { out.push(line); line = ''; }
        line += ch;
      }
    };
    segments(para).forEach(put);
    out.push(line.trimEnd());
  });
  return out;
}

async function loadFonts() {
  if (!document.fonts || !document.fonts.load) return;
  const jobs = ['400', '600', '700'].map((w) => document.fonts.load(`${w} 12px "Noto Sans Thai"`, 'กขค abc 123').catch(() => null));
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 2500))]);
}

// ---------- วาดเอกสารเป็นหน้า A4 (คืน canvas ทีละหน้า) ----------
export async function renderSlip(model) {
  await loadFonts();
  const pages = []; let g; let y;
  const font = (size, weight = 400) => { g.font = `${weight} ${size}px ${FONT}`; };
  const text = (s, x, yy, { size = 10, weight = 400, color = INK, align = 'left' } = {}) => { font(size, weight); g.fillStyle = color; g.textAlign = align; g.fillText(String(s ?? ''), x, yy); };
  const hr = (yy, color = LINE, w = 0.8) => { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(PT.m, yy); g.lineTo(PT.w - PT.m, yy); g.stroke(); };
  const lines = (s, maxW, size, weight = 400) => { font(size, weight); return wrapText(g, s, maxW); };
  const bottom = PT.h - PT.m - 18;                       // เว้นที่ให้ท้ายกระดาษ
  const newPage = () => {
    const c = document.createElement('canvas'); c.width = Math.round(PT.w * SCALE); c.height = Math.round(PT.h * SCALE);
    g = c.getContext('2d'); g.scale(SCALE, SCALE); g.fillStyle = '#ffffff'; g.fillRect(0, 0, PT.w, PT.h); g.textBaseline = 'alphabetic'; pages.push(c); y = PT.m;
    if (pages.length > 1) { text(`${model.title} ${model.docNo} (ต่อ)`, PT.m, y + 10, { size: 9.5, weight: 600, color: MUTED }); y += 18; hr(y); y += 10; }
  };
  const room = (h, onBreak = null) => { if (y + h > bottom) { newPage(); if (onBreak) onBreak(); return true; } return false; };

  newPage();
  // ----- หัวเอกสาร -----
  const R = PT.w - PT.m; let yl = y; let yr = y;
  lines(model.company.name, CW * 0.56, 15, 700).forEach((s) => { yl += 17; text(s, PT.m, yl, { size: 15, weight: 700 }); });
  model.company.lines.forEach((ln) => lines(ln, CW * 0.56, 9).forEach((s) => { yl += 13; text(s, PT.m, yl, { size: 9, color: MUTED }); }));
  yr += 18; text(model.title, R, yr, { size: 18, weight: 700, color: GREEN, align: 'right' });
  yr += 14; text(model.kindLabel, R, yr, { size: 9.5, color: MUTED, align: 'right' });
  yr += 17; text('เลขที่ ' + model.docNo, R, yr, { size: 12, weight: 700, align: 'right' });
  yr += 14; text('วันที่ ' + model.date, R, yr, { size: 10, align: 'right' });
  if (model.tag) { yr += 15; text(model.tag.text, R, yr, { size: 10, weight: 700, color: model.tag.color, align: 'right' }); }
  y = Math.max(yl, yr) + 12; hr(y, GREEN, 1.2); y += 6;

  // ----- จาก / ถึง -----
  const half = (CW - 20) / 2; let ya = y; let yb = y;
  const party = (label, p, x, y0) => { let yy = y0 + 12; text(label, x, yy, { size: 8.5, weight: 600, color: MUTED });
    lines(p.name, half, 12, 700).forEach((s) => { yy += 15; text(s, x, yy, { size: 12, weight: 700 }); });
    p.lines.forEach((ln) => lines(ln, half, 9.5).forEach((s) => { yy += 13; text(s, x, yy, { size: 9.5, color: MUTED }); })); return yy; };
  ya = party('จาก (ผู้ส่ง)', model.from, PT.m, y); yb = party('ถึง (ผู้รับ)', model.to, PT.m + half + 20, y);
  y = Math.max(ya, yb) + 10; hr(y); y += 4;
  // ----- ข้อมูลขนส่ง -----
  const mw = CW / model.meta.length; let ym = y;
  model.meta.forEach(([k, v], i) => { const x = PT.m + mw * i; let yy = y + 11; text(k, x, yy, { size: 8.5, weight: 600, color: MUTED });
    lines(v, mw - 8, 10).forEach((s) => { yy += 13; text(s, x, yy, { size: 10 }); }); ym = Math.max(ym, yy); });
  y = ym + 10;

  // ----- ตารางรายการ -----
  const rk = model.frozen ? ['na'] : RIP_ORDER;
  const cols = model.frozen
    ? [{ k: 'n', w: 20, a: 'center', t: '#' }, { k: 'lot', w: 96, t: 'Lot' }, { k: 'product', w: 130, t: 'สินค้า' }, { k: 'na', w: 64, a: 'right', t: 'น้ำหนัก (กก.)' }, { k: 'units', w: 46, a: 'right', t: 'ถุง' }, { k: 'detail', w: 0, t: 'รายละเอียด' }]
    : [{ k: 'n', w: 18, a: 'center', t: '#' }, { k: 'lot', w: 80, t: 'Lot' }, { k: 'product', w: 84, t: 'สินค้า' },
      ...RIP_ORDER.map((k) => ({ k, w: 37, a: 'right', t: RIP[k] })), { k: 'total', w: 46, a: 'right', t: 'รวม (กก.)' }, { k: 'units', w: 38, a: 'right', t: 'ตะกร้า' }, { k: 'detail', w: 0, t: 'รายละเอียด' }];
  cols[cols.length - 1].w = CW - cols.reduce((a, c) => a + c.w, 0);
  let cx = PT.m; cols.forEach((c) => { c.x = cx; cx += c.w; });
  const PAD = 4;
  const cellX = (c) => (c.a === 'right' ? c.x + c.w - PAD : c.a === 'center' ? c.x + c.w / 2 : c.x + PAD);
  const thead = () => { g.fillStyle = BAND; g.fillRect(PT.m, y, CW, 20);
    cols.forEach((c) => text(c.t, cellX(c), y + 13.5, { size: 8.5, weight: 700, color: MUTED, align: c.a || 'left' })); y += 20; hr(y, LINE, 0.8); };
  thead();
  const num = (v) => (v ? fmtN(v) : '–');
  model.rows.forEach((r, i) => {
    const pl = lines(r.product, cols.find((c) => c.k === 'product').w - PAD * 2, 9.5); const dc = cols.find((c) => c.k === 'detail'); const dl = lines(r.detail, dc.w - PAD * 2, 9);
    const ll = lines(r.lot, cols.find((c) => c.k === 'lot').w - PAD * 2, 9.5, 700);
    const h = Math.max(pl.length, dl.length, ll.length, 1) * 13 + 9;
    room(h + 1, thead);
    const base = y + 15;
    cols.forEach((c) => {
      const o = { size: 9.5, align: c.a || 'left' };
      if (c.k === 'n') text(i + 1, cellX(c), base, { ...o, color: MUTED });
      else if (c.k === 'lot') ll.forEach((s, j) => text(s, cellX(c), base + j * 13, { ...o, weight: 700, color: GREEN }));
      else if (c.k === 'product') pl.forEach((s, j) => text(s, cellX(c), base + j * 13, o));
      else if (c.k === 'detail') dl.forEach((s, j) => text(s, cellX(c), base + j * 13, { ...o, size: 9 }));
      else if (c.k === 'total') text(num(r.total), cellX(c), base, { ...o, weight: 700 });
      else if (c.k === 'units') text(num(r.units), cellX(c), base, o);
      else text(num(r.kg[c.k]), cellX(c), base, { ...o, weight: model.frozen ? 700 : 400, color: r.kg[c.k] ? INK : '#a9b4ae' });
    });
    y += h; hr(y, LINE, 0.6);
  });
  room(24, thead);
  g.fillStyle = BAND; g.fillRect(PT.m, y, CW, 22);
  cols.forEach((c) => {
    const o = { size: 10, weight: 700, align: c.a || 'left' };
    if (c.k === 'lot') text(`รวม ${model.rows.length} Lot`, cellX(c), y + 15, o);
    else if (c.k === 'total') text(num(model.totals.total), cellX(c), y + 15, o);
    else if (c.k === 'units') text(num(model.totals.units), cellX(c), y + 15, o);
    else if (rk.includes(c.k)) text(num(model.totals.kg[c.k]), cellX(c), y + 15, o);
  });
  y += 22; hr(y, INK, 0.9); y += 12;

  // ----- รายละเอียด / หมายเหตุ -----
  const block = (label, s, size, color) => {
    if (!s) return; room(30); text(label, PT.m, y + 10, { size: 9.5, weight: 700 }); y += 14;
    lines(s, CW, size).forEach((ln) => { room(size + 5); y += size + 4.5; text(ln, PT.m, y, { size, color }); }); y += 10;
  };
  block('รายละเอียด', model.details, 10.5, INK);
  block('หมายเหตุ', model.note, 9.5, MUTED);
  if (model.edited) { lines(model.edited, CW, 8.5).forEach((ln) => { room(14); y += 12; text(ln, PT.m, y, { size: 8.5, color: MUTED }); }); y += 6; }

  // ----- ช่องเซ็น ผู้ส่ง / ผู้รับ -----
  const SH = 118; room(SH + 20); y += 16;
  const sign = (label, p, x) => {
    g.strokeStyle = LINE; g.lineWidth = 0.9; g.strokeRect(x, y, half, SH);
    g.fillStyle = BAND; g.fillRect(x + 0.5, y + 0.5, half - 1, 22);
    text(label, x + 10, y + 15, { size: 11, weight: 700 });
    font(9, 400); const pn = wrapText(g, p.place, half - 70)[0] || ''; text(pn, x + half - 10, y + 15, { size: 9, color: MUTED, align: 'right' });
    const dots = (x0, x1, yy) => { g.strokeStyle = '#7a8a82'; g.lineWidth = 0.7; g.setLineDash([1.2, 2.4]); g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke(); g.setLineDash([]); };
    text('ลงชื่อ', x + 12, y + 56, { size: 10 }); dots(x + 42, x + half - 14, y + 57);
    text('(', x + 36, y + 76, { size: 10 }); dots(x + 42, x + half - 20, y + 77); text(')', x + half - 16, y + 76, { size: 10 });
    text('วันที่', x + 12, y + 96, { size: 10 }); dots(x + 38, x + half * 0.58, y + 97);
    text('เวลา', x + half * 0.62, y + 96, { size: 10 }); dots(x + half * 0.62 + 24, x + half - 28, y + 97); text('น.', x + half - 24, y + 96, { size: 10 });
    if (p.record) { font(7.5, 400); text(wrapText(g, p.record, half - 20)[0], x + 10, y + SH - 6, { size: 7.5, color: MUTED }); }
  };
  sign('ผู้ส่ง', model.sender, PT.m); sign('ผู้รับ', model.receiver, PT.m + half + 20); y += SH;

  // ----- ท้ายกระดาษทุกหน้า -----
  pages.forEach((c, i) => { g = c.getContext('2d'); const fy = PT.h - PT.m + 4;
    text(`AVO FLOW · ${model.docNo} · พิมพ์เมื่อ ${model.printedAt}`, PT.m, fy, { size: 8, color: MUTED });
    text(`หน้า ${i + 1} / ${pages.length}`, PT.w - PT.m, fy, { size: 8, color: MUTED, align: 'right' }); });
  return pages;
}

// ---------- ประกอบไฟล์ PDF (1 รูป JPEG ต่อหน้า) ----------
const canvasJpeg = (c, q = 0.93) => new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error('สร้างรูปเอกสารไม่ได้'))), 'image/jpeg', q));
const pdfText = (s) => '<FEFF' + [...String(s)].map((ch) => { const cp = ch.codePointAt(0);
  if (cp > 0xffff) { const v = cp - 0x10000; return (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); }
  return cp.toString(16).padStart(4, '0'); }).join('').toUpperCase() + '>';
export function buildPdf(images, title) {
  // images: [{ bytes: Uint8Array (JPEG), w, h }] → Blob (application/pdf)
  const enc = new TextEncoder(); const parts = []; const off = []; let pos = 0;
  const push = (x) => { const u = typeof x === 'string' ? enc.encode(x) : x; parts.push(u); pos += u.length; };
  const obj = (n, head, stream = null) => { off[n] = pos; push(`${n} 0 obj\n${head}\n`); if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); } push('endobj\n'); };
  push('%PDF-1.4\n'); push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const n = images.length; const now = new Date(Date.now() + 7 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${images.map((_, i) => `${4 + i * 3} 0 R`).join(' ')}] /Count ${n} >>`);
  obj(3, `<< /Title ${pdfText(title)} /Producer (AVO FLOW) /Creator (AVO FLOW) /CreationDate (D:${now}+07'00') >>`);
  images.forEach((im, i) => {
    const p = 4 + i * 3; const content = enc.encode(`q ${PT.w} 0 0 ${PT.h} 0 0 cm /Im0 Do Q`);
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PT.w} ${PT.h}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, `<< /Length ${content.length} >>`, content);
    obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>`, im.bytes);
  });
  const total = 3 + n * 3; const xref = pos;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= total; i++) push(String(off[i]).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

export async function slipPdf(model) {
  const pages = await renderSlip(model);
  const images = []; for (const c of pages) images.push({ bytes: await canvasJpeg(c), w: c.width, h: c.height });
  return { blob: buildPdf(images, `${model.title} ${model.docNo}`), images };
}

function saveBlob(blob, name) {
  const a = document.createElement('a'); const url = URL.createObjectURL(blob); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------- หน้าต่างใบตีออก: ตัวอย่างเอกสาร + ดาวน์โหลด PDF / แชร์ / พิมพ์ ----------
export async function dispatchSlip(ctx, d) {
  const name = `ใบตีออก-${d.doc_no}.pdf`;
  const m = openModal({ title: `ใบตีออก ${esc(d.doc_no)}`, sub: 'เอกสาร A4 พร้อมช่องเซ็นผู้ส่ง / ผู้รับ', size: 'lg',
    body: '<div class="print-area slip-pages" id="slip-pages"><div class="spinner"></div></div>',
    foot: '<div class="left"><button class="btn" id="sl-print" disabled>พิมพ์</button></div><button class="btn hidden" id="sl-share">แชร์ไฟล์</button><button class="btn primary" id="sl-pdf" disabled>ดาวน์โหลด PDF</button>' });
  let out;
  try { out = await slipPdf(slipModel(ctx, d)); }
  catch (e) { $('#slip-pages', m.el).innerHTML = `<div class="notice">สร้างเอกสารไม่ได้: ${esc(e.message || e)}</div>`; return m; }
  const urls = out.images.map((im) => URL.createObjectURL(new Blob([im.bytes], { type: 'image/jpeg' })));
  $('#slip-pages', m.el).innerHTML = urls.map((u, i) => `<img src="${u}" alt="ใบตีออก ${esc(d.doc_no)} หน้า ${i + 1}" width="${out.images[i].w}" height="${out.images[i].h}">`).join('');
  const pdfBtn = $('#sl-pdf', m.el); pdfBtn.disabled = false; pdfBtn.onclick = () => { saveBlob(out.blob, name); toast(`บันทึกไฟล์ ${name} แล้ว`, 'ok'); };
  // พิมพ์: แสดงเฉพาะหน้าเอกสาร (ซ่อนหน้าจออื่นระหว่างพิมพ์ แล้วคืนค่าเมื่อพิมพ์เสร็จ)
  m.el.classList.add('slip-ov');
  const pr = $('#sl-print', m.el); pr.disabled = false;
  pr.onclick = () => {
    const root = document.documentElement; const off = () => { root.classList.remove('printing-slip'); window.removeEventListener('afterprint', off); };
    root.classList.add('printing-slip'); window.addEventListener('afterprint', off);
    try { window.print(); } finally { setTimeout(off, 60000); }
  };
  let file = null; try { file = new File([out.blob], name, { type: 'application/pdf' }); } catch (e) { /* เบราว์เซอร์เก่า */ }
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    const sh = $('#sl-share', m.el); sh.classList.remove('hidden');
    sh.onclick = (e) => busy(e.currentTarget, async () => { try { await navigator.share({ files: [file], title: name }); } catch (err) { if (err?.name !== 'AbortError') throw err; } });
  }
  m._pdf = out.blob;
  return m;
}
