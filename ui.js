// =====================================================================
// ตัวช่วยหน้าจอ: รูปแบบตัวเลข/วันที่ไทย, modal, drawer, toast, ตาราง, รูปถ่าย
// =====================================================================
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const mf = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtN = (n) => (n == null || n === '' ? '—' : nf.format(Number(n)));
export const fmtKg = (n) => (n == null ? '—' : nf.format(Number(n)) + ' กก.');
export const fmtMoney = (n) => (n == null ? '—' : mf.format(Number(n)));
// จำนวนลูกโดยประมาณจากน้ำหนักเฉลี่ย/ลูก (กรัม)
export const pcs = (kg, avg_g) => (avg_g > 0 && kg != null ? Math.round((Number(kg) * 1000) / Number(avg_g)) : null);
export const fmtPcs = (kg, avg_g) => { const n = pcs(kg, avg_g); return n == null ? '' : `≈ ${nf.format(n)} ลูก`; };
const TZ = { timeZone: 'Asia/Bangkok' };
export const thDate = (iso) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T00:00:00+07:00' : iso); return d.toLocaleDateString('th-TH', { ...TZ, day: 'numeric', month: 'short' }); };
export const thDateY = (iso) => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T00:00:00+07:00' : iso); return d.toLocaleDateString('th-TH', { ...TZ, day: 'numeric', month: 'short', year: 'numeric' }); };
export const thDateTime = (iso) => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('th-TH', { ...TZ, day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('th-TH', { ...TZ, hour: '2-digit', minute: '2-digit' }); };
export const thTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { ...TZ, hour: '2-digit', minute: '2-digit' }) : '—');
export const todayISO = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const daysAgoISO = (n) => new Date(Date.now() + 7 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
export const toLocalInput = (iso) => { const d = new Date(iso ? new Date(iso).getTime() + 7 * 3600e3 : Date.now() + 7 * 3600e3); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (v) => (v ? new Date(v + ':00+07:00').toISOString() : null);

export const RIP = { raw: 'ดิบ', breaking: 'ห่าม', ripe: 'สุก', overripe: 'สุกมาก', na: 'แช่แข็ง' };
export const RIP_ORDER = ['raw', 'breaking', 'ripe', 'overripe'];
export const RIP_COLOR = { raw: 'var(--rip-raw)', breaking: 'var(--rip-breaking)', ripe: 'var(--rip-ripe)', overripe: 'var(--rip-overripe)' };
export const ZONE = { main: 'คลัง', front: 'หน้าร้าน', back: 'หลังร้าน', frozen: 'แช่แข็ง', transit: 'ระหว่างทาง' };
export const ROLE = { admin: 'Admin', executive: 'ผู้บริหาร', warehouse: 'คลัง', branch: 'สาขา', sales: 'ฝ่ายขาย', pending: 'รอกำหนดสิทธิ์' };
export const CHANNEL = { wholesale: 'ขายส่ง', retail: 'ขายปลีก', dc: 'DC', online: 'ONLINE', tiktok: 'TIKTOK', other: 'อื่น ๆ' };
export const ripBadge = (r) => `<span class="rip rip-${esc(r)}">${esc(RIP[r] || r)}</span>`;

export const STATUS = {
  receipt: { draft: ['ร่าง', 'b-gray'], pending_check: ['รอตรวจรับ', 'b-warn'], confirmed: ['ยืนยันรับเข้า', 'b-ok'], cancelled: ['ยกเลิก', 'b-gray'], reversed: ['กลับรายการ', 'b-danger'] },
  dispatch: { draft: ['ร่าง · จองสต็อก', 'b-gray'], shipped: ['ส่งแล้ว รอรับ', 'b-info'], received: ['รับครบ', 'b-ok'], partial: ['รับบางส่วน', 'b-warn'], closed: ['ปิดงาน', 'b-ok'], cancelled: ['ยกเลิก', 'b-gray'] },
  case: { open: ['รอตรวจสอบ', 'b-warn'], resolved: ['ปิดแล้ว', 'b-ok'] },
  adjust: { pending: ['รออนุมัติ', 'b-warn'], applied: ['บันทึกแล้ว', 'b-ok'], rejected: ['ไม่อนุมัติ', 'b-gray'] },
  invoice: { issued: ['ออกแล้ว', 'b-ok'], cancelled: ['ยกเลิก', 'b-gray'] },
  quote: { draft: ['ฉบับร่าง', 'b-gray'], sent: ['ส่งลูกค้าแล้ว', 'b-info'], accepted: ['ลูกค้าตกลง', 'b-ok'], cancelled: ['ยกเลิก', 'b-gray'] },
  return: { pending: ['รออนุมัติ', 'b-warn'], applied: ['อนุมัติแล้ว', 'b-ok'], rejected: ['ไม่อนุมัติ', 'b-gray'], cancelled: ['ยกเลิก', 'b-gray'] },
  credit: { issued: ['ออกแล้ว', 'b-ok'], cancelled: ['ยกเลิก', 'b-gray'] },
  po: { draft: ['ร่าง', 'b-gray'], pending: ['รออนุมัติ', 'b-warn'], approved: ['อนุมัติแล้ว · รอรับ', 'b-info'], partial: ['รับบางส่วน', 'b-warn'], received: ['รับครบ', 'b-ok'], closed: ['ปิดแล้ว', 'b-ok'], cancelled: ['ยกเลิก', 'b-gray'] },
  stocktake: { draft: ['กำลังนับ', 'b-info'], submitted: ['รออนุมัติ', 'b-warn'], approved: ['อนุมัติ · ปรับยอดแล้ว', 'b-ok'], rejected: ['ไม่อนุมัติ', 'b-gray'], cancelled: ['ยกเลิก', 'b-gray'] },
};
export const DOC_TYPE = { invoice: ['ใบส่งของ / ใบแจ้งหนี้', 'INV'], tax_invoice: ['ใบกำกับภาษีเต็มรูป', 'TIV'], cash: ['บิลเงินสด', 'CS'] };
export const statusBadge = (kind, s, extra = '') => { const [t, c] = STATUS[kind]?.[s] || [s, 'b-gray']; return `<span class="badge ${c}">${esc(t)}${extra}</span>`; };
export const ADJ_KIND = { retail_sale: 'ขายหน้าร้าน', internal_use: 'นำไปใช้', waste: 'ตัดทิ้ง', count_adjust: 'ปรับยอดนับจริง', shrinkage: 'น้ำหนักหาย (ชั่งซ้ำ)' };
export const MTYPE = {
  RECEIVE: 'รับเข้า', RECEIVE_REVERSE: 'กลับรายการรับเข้า', SHIP_OUT: 'ตีออก', TRANSIT_IN: 'เข้าระหว่างทาง', TRANSIT_OUT: 'ออกจากระหว่างทาง', TRANSFER_IN: 'รับโอนเข้า',
  DELIVERED: 'ส่งมอบลูกค้า', RIPEN_OUT: 'เปลี่ยนความสุก (ออก)', RIPEN_IN: 'เปลี่ยนความสุก (เข้า)', ZONE_OUT: 'โอนภายใน (ออก)', ZONE_IN: 'โอนภายใน (เข้า)',
  FREEZE_CONSUME: 'ใช้ทำแช่แข็ง', FREEZE_PRODUCE: 'ผลผลิตแช่แข็ง', RETAIL_SALE: 'ขายหน้าร้าน', INTERNAL_USE: 'นำไปใช้', WASTE: 'ตัดทิ้ง', ADJUST: 'ปรับยอด',
  CASE_LOSS: 'สูญเสียระหว่างขนส่ง', CASE_RETURN: 'ส่งคืน (ออกจากระหว่างทาง)', RETURN_IN: 'รับคืนเข้าต้นทาง',
  SHRINK: 'น้ำหนักหายระหว่างบ่ม', COUNT_ADJUST: 'ปรับยอดจากตรวจนับ', CUST_RETURN: 'ลูกค้าคืนเข้าสต็อก',
};

// ---------- toast ----------
export function toast(msg, type = '') {
  let w = $('.toast-wrap'); if (!w) { w = document.createElement('div'); w.className = 'toast-wrap'; document.body.appendChild(w); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; w.appendChild(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3200);
}

// ---------- modal ----------
export function openModal({ title, sub = '', body = '', size = '', foot = null, onMount = null, onClose = null }) {
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-head"><div><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}</div><button class="x no-print" aria-label="ปิด">×</button></div>
    <div class="modal-body">${body}</div>${foot != null ? `<div class="modal-foot no-print">${foot}</div>` : ''}</div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = 'hidden';
  const close = () => { ov.remove(); if (!$('.overlay') && !$('.drawer')) document.body.style.overflow = ''; onClose && onClose(); };
  $('.x', ov).onclick = close;
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) ov._down = true; });
  ov.addEventListener('mouseup', (e) => { if (e.target === ov && ov._down) close(); ov._down = false; });
  const m = { el: ov, root: $('.modal', ov), close, setBody(h) { $('.modal-body', ov).innerHTML = h; }, setFoot(h) { const f = $('.modal-foot', ov); if (f) f.innerHTML = h; } };
  onMount && onMount(m);
  return m;
}

export function confirmBox(title, message, { ok = 'ยืนยัน', danger = false, input = null } = {}) {
  return new Promise((resolve) => {
    const m = openModal({ title, size: 'sm', body: `<p style="margin:0 0 12px">${message}</p>${input ? `<div class="field"><label>${esc(input.label)}${input.required ? ' <span class="req">*</span>' : ''}</label><textarea class="input" id="cb-input" placeholder="${esc(input.placeholder || '')}"></textarea></div>` : ''}`,
      foot: `<button class="btn" data-a="no">ยกเลิก</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button>`,
      onClose: () => resolve(null) });
    $('[data-a=no]', m.el).onclick = () => { m.close(); };
    $('[data-a=yes]', m.el).onclick = () => {
      const v = input ? $('#cb-input', m.el).value.trim() : true;
      if (input?.required && !v) { toast('กรุณากรอก' + input.label, 'err'); return; }
      m.el.remove(); document.body.style.overflow = ''; resolve(v);
    };
  });
}

// ---------- drawer ----------
export function openDrawer({ title, sub = '', body = '' }) {
  const ov = document.createElement('div'); ov.className = 'drawer-overlay';
  const d = document.createElement('aside'); d.className = 'drawer';
  d.innerHTML = `<div class="drawer-head"><div><h3>${title}</h3>${sub ? `<div class="muted small" style="margin-top:4px">${sub}</div>` : ''}</div><button class="x" aria-label="ปิด">×</button></div><div class="drawer-body">${body}</div>`;
  document.body.append(ov, d); document.body.style.overflow = 'hidden';
  const close = () => { ov.remove(); d.remove(); if (!$('.overlay')) document.body.style.overflow = ''; };
  ov.onclick = close; $('.x', d).onclick = close;
  return { el: d, close, setBody(h) { $('.drawer-body', d).innerHTML = h; } };
}

// ---------- busy button ----------
export async function busy(btn, fn) {
  if (btn?.disabled) return;
  const old = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = 'กำลังบันทึก…'; }
  try { return await fn(); }
  catch (e) { toast(e.message || String(e), 'err'); return undefined; }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

// ---------- form helpers ----------
export const opt = (items, val, label = (x) => x.name, value = (x) => x.id, empty = null) =>
  (empty != null ? `<option value="">${esc(empty)}</option>` : '') + items.map((x) => `<option value="${esc(value(x))}" ${String(value(x)) === String(val ?? '') ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
export const formData = (root) => {
  const o = {};
  $$('[name]', root).forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else o[el.name] = el.value === '' ? null : el.value;
  });
  return o;
};
export const field = (label, inner, { req = false, hint = '', cls = '' } = {}) =>
  `<div class="field ${cls}"><label>${label}${req ? ' <span class="req">*</span>' : ''}</label>${inner}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

// ---------- table ----------
export function table(cols, rows, { empty = 'ยังไม่มีข้อมูล', rowAttr = () => '', foot = '' } = {}) {
  return `<div class="table-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th class="${c.right ? 'right' : ''}">${c.label}</th>`).join('')}</tr></thead><tbody>${
    rows.length ? rows.map((r, i) => `<tr ${rowAttr(r, i)}>${cols.map((c) => `<td class="${c.right ? 'right num' : ''} ${c.cls || ''}">${c.render ? c.render(r, i) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('')
      : `<tr><td class="empty" colspan="${cols.length}">${empty}</td></tr>`}</tbody>${foot}</table></div>`;
}

// ---------- รูปถ่ายหลักฐาน (ย่อก่อนอัปโหลด) ----------
// ย่อเหลือด้านยาว 800px (~80 KB/รูป) เพื่อประหยัดพื้นที่ฐานข้อมูล
export function compressImage(file, max = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
    img.src = url;
  });
}
// รูปหลักฐานแนบได้หลายรูป (ถ่ายรูป หรือเลือกจากอัลบั้มทีละหลายรูป) · เก็บเป็นรหัสรูปคั่นด้วย |
export const EV_SEP = '|';
export const MAX_PHOTOS = 8;
export const evidenceRefs = (v) => (v ? String(v).split(EV_SEP).filter(Boolean) : []);
export const photoField = (name, label = 'รูปหลักฐาน', req = false, value = '') => field(label,
  `<div class="photo-field" data-photo="${name}"><input type="hidden" name="${name}" value="${esc(value || '')}"><div class="photo-list" data-list></div>
   <span class="photo-btns"><label class="btn sm"><input type="file" accept="image/*" capture="environment" class="hidden" data-cam>📷 ถ่ายรูป</label>
   <label class="btn sm"><input type="file" accept="image/*" multiple class="hidden" data-alb>🖼 เลือกจากอัลบั้ม</label></span>
   <span class="small muted" data-st></span></div>`, { req, hint: `แนบได้สูงสุด ${MAX_PHOTOS} รูป` });
export function bindPhotoFields(root, api) {
  $$('[data-photo]', root).forEach((w) => {
    const hid = $('input[type=hidden]', w); const list = $('[data-list]', w); const st = $('[data-st]', w);
    const items = evidenceRefs(hid.value).map((ref) => ({ ref, src: ref.startsWith('local:') ? ref.slice(6) : null }));
    const sync = () => { hid.value = items.map((x) => x.ref).join(EV_SEP); };
    const draw = () => {
      list.innerHTML = items.map((x, i) => `<span class="photo-item"><img class="photo-thumb" alt="" ${x.src ? `src="${esc(x.src)}"` : ''} data-i="${i}"><button type="button" class="photo-del" data-del="${i}" aria-label="ลบรูป">×</button></span>`).join('');
      $$('[data-del]', list).forEach((b) => (b.onclick = () => { items.splice(Number(b.dataset.del), 1); sync(); draw(); }));
      items.forEach((x, i) => { if (!x.src && x.ref.startsWith('att:')) api.rpc('api_attachment_get', { ref: x.ref }).then((r) => { x.src = r?.data || ''; const im = $(`img[data-i="${i}"]`, list); if (im && x.src) im.src = x.src; }).catch(() => {}); });
    };
    const add = async (files) => {
      const room = MAX_PHOTOS - items.length; const fs = [...files].slice(0, Math.max(room, 0));
      if (files.length > room) toast(`แนบได้สูงสุด ${MAX_PHOTOS} รูป`, 'err');
      let n = 0;
      for (const f of fs) {
        st.textContent = `กำลังอัปโหลด ${++n}/${fs.length}…`; let data;
        try {
          data = await compressImage(f);
          const r = await api.rpc('api_attachment_save', { data });
          items.push({ ref: r.ref, src: data });
        } catch (e) {
          // สัญญาณหลุด: เก็บรูปไว้ในเครื่อง ระบบจะอัปโหลดให้ตอนส่งรายการ
          if (data && api.isNetworkError?.(e)) items.push({ ref: 'local:' + data, src: data });
          else toast(e.message, 'err');
        }
        sync(); draw();
      }
      st.textContent = items.length ? `แนบแล้ว ${items.length} รูป${items.some((x) => x.ref.startsWith('local:')) ? ' (บางรูปเก็บไว้ในเครื่อง รอส่งตอนมีสัญญาณ)' : ''}` : '';
    };
    $$('input[type=file]', w).forEach((inp) => (inp.onchange = async () => { const files = inp.files; if (files?.length) await add(files); inp.value = ''; }));
    draw(); if (items.length) st.textContent = `แนบแล้ว ${items.length} รูป`;
  });
}
export async function showEvidence(el, ref, api) {
  const refs = evidenceRefs(ref);
  if (!refs.length) { el.innerHTML = '<span class="muted small">ไม่มีรูปแนบ</span>'; return; }
  el.innerHTML = `<div class="evidence-grid">${refs.map((_, i) => `<img class="evidence-img" data-i="${i}" alt="หลักฐาน ${i + 1}">`).join('')}</div>`;
  await Promise.all(refs.map(async (r, i) => {
    const im = $(`img[data-i="${i}"]`, el);
    try {
      const src = r.startsWith('local:') ? r.slice(6) : (await api.rpc('api_attachment_get', { ref: r }))?.data;
      if (!src) { im.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'ไม่พบรูป' })); return; }
      im.src = src;
      im.onclick = () => openModal({ title: `รูปหลักฐาน ${refs.length > 1 ? `(${i + 1}/${refs.length})` : ''}`, size: 'lg', body: `<img src="${esc(src)}" style="width:100%;border-radius:10px" alt="">` });
    } catch (e) { im.replaceWith(Object.assign(document.createElement('span'), { className: 'muted small', textContent: 'โหลดรูปไม่ได้' })); }
  }));
}

// ---------- Export Excel ----------
export async function exportExcel(filename, columns, rows) {
  const head = columns.map((c) => c.label);
  const data = rows.map((r) => columns.map((c) => { const v = r[c.key]; return v == null ? '' : (c.type === 'num' || c.type === 'money') ? Number(v) : v; }));
  try {
    if (!window.XLSX) {
      await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); setTimeout(rej, 8000); });
    }
    const ws = window.XLSX.utils.aoa_to_sheet([head, ...data]);
    ws['!cols'] = head.map((h) => ({ wch: Math.max(10, h.length + 4) }));
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'AVO FLOW');
    window.XLSX.writeFile(wb, filename + '.xlsx');
  } catch (e) {
    const csv = '﻿' + [head, ...data].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = filename + '.csv'; a.click();
    toast('บันทึกเป็นไฟล์ CSV (เปิดด้วย Excel ได้)');
  }
}

// ---------- แบ่งหน้า: ปุ่ม "แสดงเพิ่ม" ----------
export const PAGE = 100;
export const moreBtn = (len, size = PAGE) => (len > 0 && len % size === 0 ? `<div class="actions" style="justify-content:center;margin-top:10px"><button class="btn sm" data-more>แสดงเพิ่ม</button></div>` : '');

export const ICONS = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h2M12 14h2M16 14h.5M8 17.5h2M12 17.5h2"/></svg>',
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><circle cx="8" cy="15" r="4"/><circle cx="16" cy="15" r="4"/><circle cx="12" cy="8" r="4"/></svg>',
  store: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M4 10v9h16v-9"/><path d="M3 10l2-6h14l2 6"/><path d="M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3"/><path d="M10 19v-4h4v4"/></svg>',
  bill: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  farm: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M12 21v-9"/><path d="M12 12c0-4 3-6 7-6 0 4-3 6-7 6z"/><path d="M12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z"/><path d="M7 21h10"/></svg>',
  report: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M4 20V10M9 20V6M14 20v-8M19 20V4"/><path d="M3 20h18"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M11 7h9M4 17h9"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8l1.5 1.5L12 7M8 14l1.5 1.5L12 13M14 8h3M14 14h3"/></svg>',
  help: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.5"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v7h-7M17 21v-2"/></svg>',
};
