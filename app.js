// =====================================================================
// AVO FLOW — โครงหน้าจอหลัก: เข้าสู่ระบบ, เมนู, เส้นทางหน้า, สิทธิ์, ออฟไลน์
// =====================================================================
import { CONFIG } from './config.js';
import { createApi, AppError, ssoRead } from './api.js';
import { $, $$, esc, toast, ICONS, ROLE, thDateY, busy, field } from './ui.js';
import * as docs from './docs.js';

const PAGES = {
  dashboard: { title: 'แดชบอร์ด', load: () => import('./dashboard.js') },
  tasks: { title: 'คิวงานส่งต่อ', load: () => import('./tasks.js') },
  warehouse: { title: 'คลังสินค้า', load: () => import('./warehouse.js') },
  branches: { title: 'สาขาและส่งต่องาน', load: () => import('./branches.js') },
  sales: { title: 'การขายและบิล', load: () => import('./sales.js') },
  suppliers: { title: 'จัดซื้อ / สวน', load: () => import('./suppliers.js') },
  reports: { title: 'รายงาน', load: () => import('./reports.js') },
  settings: { title: 'ตั้งค่า', load: () => import('./settings.js') },
  alerts: { title: 'แจ้งเตือนและงานรอตรวจ', load: () => import('./alerts.js') },
  help: { title: 'คู่มือและตรวจรับระบบ', load: () => import('./help.js') },
};

const ctx = { api: null, me: null, master: null, page: null, params: [] };
window.__avo = ctx; // สำหรับตรวจสอบ/ทดสอบ

// ---------- สิทธิ์ฝั่งหน้าจอ (ฐานข้อมูลตรวจซ้ำทุกครั้ง) ----------
function buildCan(u) {
  const r = u.role; const is = (...roles) => r === 'admin' || roles.includes(r);
  const site = (id) => ctx.master.sites.find((s) => s.id === Number(id));
  const canAct = (sid) => r === 'admin' || (r === 'warehouse' && ((u.site_id == null && site(sid)?.kind === 'warehouse') || u.site_id === Number(sid))) || (r === 'branch' && u.site_id === Number(sid));
  return {
    receive: is('warehouse'), dispatch: is('warehouse', 'branch'), actAt: canAct,
    approveAt: (sid) => ['admin', 'executive'].includes(r) || (u.is_manager && canAct(sid)),
    sales: is('sales', 'executive'), invoices: is('sales', 'executive', 'warehouse'), prices: is('executive'),
    settings: r === 'admin', master: r === 'admin' || (r === 'warehouse' && u.is_manager),
    suppliers: is('warehouse', 'executive'), customers: is('sales', 'executive'), addCustomer: is('sales', 'executive', 'warehouse'),
    seeWarehouse: r !== 'branch', recordDelivery: is('warehouse', 'sales'),
    returns: is('sales', 'warehouse', 'branch', 'executive'), credit: is('sales', 'executive'), stocktake: is('warehouse', 'branch'),
  };
}

// ---------- เข้าสู่ระบบ ----------
function authShell(inner) {
  document.body.innerHTML = `<div class="auth"><div class="card auth-card">
    <div class="brand"><div class="brand-mark">A</div><div><div class="brand-name">${esc(CONFIG.appName)}</div><div class="brand-sub">${esc(CONFIG.appSub)}</div></div></div>
    ${inner}</div></div>`;
}

function showDemoLogin() {
  authShell(`<p class="muted small" style="text-align:center;margin:0 0 16px">โหมดทดลอง · ข้อมูลจำลอง · เลือกบทบาทเพื่อเข้าใช้งาน</p>
    <div class="role-grid">${ctx.api.demoUsers.map((u) => `<button class="role-btn" data-sub="${u.sub}"><b>${esc(u.name)}</b><span>${esc(ROLE[u.role])}${u.manager ? ' · ผู้จัดการ' : ''} — ${esc(u.desc)}</span></button>`).join('')}</div>
    <p class="small muted" style="margin:16px 0 0;text-align:center">ข้อมูลในโหมดทดลองเก็บไว้ในเบราว์เซอร์นี้เท่านั้น <button class="link" id="reset-demo">รีเซ็ตข้อมูลตัวอย่าง</button></p>`);
  $$('.role-btn').forEach((b) => (b.onclick = async () => { await ctx.api.auth.signInAs(b.dataset.sub); boot(); }));
  $('#reset-demo').onclick = async () => { await ctx.api.resetDemo(); toast('รีเซ็ตข้อมูลตัวอย่างแล้ว', 'ok'); };
}

function showLogin(mode = 'in', msg = '', info = '') {
  const up = mode === 'up';
  const hr = CONFIG.neon?.hrspotUrl ? CONFIG.neon.hrspotUrl + (CONFIG.neon.hrspotUrl.includes('?') ? '&' : '?') + 'app=avoflow' : '';
  const pw = CONFIG.neon?.passwordLogin !== false;
  authShell(`<h2 style="font-size:18px;font-weight:500;text-align:center;margin:4px 0 16px">${up ? 'สมัครบัญชีผู้ใช้' : 'เข้าสู่ระบบ'}</h2>
    ${msg ? `<div class="notice">${esc(msg)}</div>` : ''}${info ? `<div class="notice info">${esc(info)}</div>` : ''}
    ${hr && !up ? `<a class="btn primary" href="${esc(hr)}" style="display:block;text-align:center;text-decoration:none">เข้าสู่ระบบด้วยบัญชี HR.SPOT</a>${pw ? '<p class="small muted" style="text-align:center;margin:12px 0">หรือใช้อีเมลเดิม</p>' : ''}` : ''}
    <form id="auth-form" class="grid" ${hr && !pw ? 'hidden' : ''}>
      ${up ? field('ชื่อที่แสดง', '<input class="input" name="name" required autocomplete="name">', { req: true }) : ''}
      ${field('อีเมล', '<input class="input" name="email" type="email" required autocomplete="email">', { req: true })}
      ${field('รหัสผ่าน', `<input class="input" name="password" type="password" required minlength="8" autocomplete="${up ? 'new-password' : 'current-password'}">`, { req: true, hint: up ? 'อย่างน้อย 8 ตัวอักษร' : '' })}
      <button class="btn primary" type="submit">${up ? 'สมัครและเข้าสู่ระบบ' : 'เข้าสู่ระบบ'}</button>
    </form>
 ${!up && pw && ctx.api.auth.canReset ? '<p class="small" style="text-align:center;margin:12px 0 0"><button class="link" id="forgot">ลืมรหัสผ่าน?</button></p>' : ''}
    ${pw && ctx.api.auth.allowSignup ? `<p class="small muted" style="text-align:center;margin:10px 0 0">${up ? 'มีบัญชีแล้ว?' : 'ยังไม่มีบัญชี?'} <button class="link" id="swap">${up ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน'}</button></p>` : ''}
    ${up ? '<p class="small muted" style="text-align:center;margin:8px 0 0">บัญชีใหม่ต้องรอ Admin กำหนดบทบาทและสาขาก่อนใช้งาน (ผู้ใช้คนแรกของระบบจะเป็น Admin อัตโนมัติ)</p>' : ''}`);
  const sw = $('#swap'); if (sw) sw.onclick = () => showLogin(up ? 'in' : 'up');
  const fg = $('#forgot'); if (fg) fg.onclick = () => showForgot();
  $('#auth-form').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); const btn = $('button[type=submit]', e.target);
    await busy(btn, async () => {
      if (up) await ctx.api.auth.signUp(f.name, f.email, f.password); else await ctx.api.auth.signIn(f.email, f.password);
      ctx.pendingName = f.name; boot();
    });
  };
}

function showForgot() {
  authShell(`<h2 style="font-size:18px;font-weight:500;text-align:center;margin:4px 0 8px">ลืมรหัสผ่าน</h2>
    <p class="small muted" style="text-align:center;margin:0 0 14px">กรอกอีเมลที่ใช้สมัคร ระบบจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้ (ลิงก์ใช้ได้ 15 นาที)</p>
    <form id="fg-form" class="grid">${field('อีเมล', '<input class="input" name="email" type="email" required autocomplete="email">', { req: true })}
      <button class="btn primary" type="submit">ส่งลิงก์ตั้งรหัสผ่านใหม่</button></form>
    <p class="small" style="text-align:center;margin:12px 0 0"><button class="link" id="back">กลับไปหน้าเข้าสู่ระบบ</button></p>`);
  $('#back').onclick = () => showLogin();
  $('#fg-form').onsubmit = async (e) => {
    e.preventDefault(); const email = new FormData(e.target).get('email');
    await busy($('button[type=submit]', e.target), async () => {
      await ctx.api.auth.requestReset(email);
      showLogin('in', '', `ถ้า ${email} มีบัญชีในระบบ จะได้รับอีเมลลิงก์ตั้งรหัสผ่านใหม่ภายในไม่กี่นาที (ตรวจในโฟลเดอร์สแปมด้วย)`);
    });
  };
}

function showReset(token, err) {
  if (err || !token) { history.replaceState(null, '', location.pathname); showLogin('in', 'ลิงก์ตั้งรหัสผ่านหมดอายุหรือไม่ถูกต้อง กรุณากด "ลืมรหัสผ่าน" เพื่อขอลิงก์ใหม่'); return; }
  authShell(`<h2 style="font-size:18px;font-weight:500;text-align:center;margin:4px 0 16px">ตั้งรหัสผ่านใหม่</h2>
    <form id="rs-form" class="grid">
      ${field('รหัสผ่านใหม่', '<input class="input" name="p1" type="password" required minlength="8" autocomplete="new-password">', { req: true, hint: 'อย่างน้อย 8 ตัวอักษร' })}
      ${field('ยืนยันรหัสผ่านใหม่', '<input class="input" name="p2" type="password" required minlength="8" autocomplete="new-password">', { req: true })}
      <button class="btn primary" type="submit">บันทึกรหัสผ่านใหม่</button></form>`);
  $('#rs-form').onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (f.p1 !== f.p2) { toast('รหัสผ่านสองช่องไม่ตรงกัน', 'err'); return; }
    await busy($('button[type=submit]', e.target), async () => {
      await ctx.api.auth.resetPassword(token, f.p1);
      history.replaceState(null, '', location.pathname);
      showLogin('in', '', 'ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย');
    });
  };
}

function showPending(u) {
  authShell(`<div class="notice info" style="margin:6px 0 14px">บัญชี <b>${esc(u.email || u.display_name)}</b> สมัครเรียบร้อยแล้ว กำลังรอผู้ดูแลระบบกำหนดบทบาทและสาขา</div>
    <p class="small muted">แจ้ง Admin ให้เข้าเมนู ตั้งค่า → ผู้ใช้งาน เพื่อกำหนดสิทธิ์ แล้วกด "ตรวจสอบอีกครั้ง"</p>
    <div class="actions" style="justify-content:center;margin-top:14px"><button class="btn primary" id="again">ตรวจสอบอีกครั้ง</button><button class="btn" id="out">ออกจากระบบ</button></div>`);
  $('#again').onclick = () => boot(); $('#out').onclick = async () => { await ctx.api.auth.signOut(); boot(); };
}

// ---------- โครงหน้าจอ ----------
const NAV = [
  { group: 'ภาพรวม' },
  { key: 'dashboard', icon: 'dash', label: 'แดชบอร์ด' },
  { key: 'tasks', icon: 'tasks', label: 'คิวงานส่งต่อ', sub: 'งานอยู่ที่ใคร · ขาดอะไร · กำหนดเสร็จ', badge: 'nav-tasks' },
  { group: 'ปฏิบัติงาน' },
  { key: 'warehouse', icon: 'stock', label: 'คลังสินค้า', sub: 'รับเข้า · คงคลัง · ตีออก · ตรวจนับ', show: (c) => c.seeWarehouse },
  { key: 'branches', icon: 'store', label: 'สาขาและส่งต่องาน', sub: 'หน้าร้าน · หลังร้าน · แช่แข็ง' },
  { key: 'sales', icon: 'bill', label: 'การขายและบิล', sub: 'บิล · รับคืน · ลดหนี้ · ลูกค้า', show: (c) => c.invoices },
  { group: 'ข้อมูลและระบบ' },
  { key: 'suppliers', icon: 'farm', label: 'จัดซื้อ / สวน', show: (c) => c.seeWarehouse },
  { key: 'reports', icon: 'report', label: 'รายงาน' },
  { key: 'settings', icon: 'settings', label: 'ตั้งค่า', show: (c) => c.settings || c.master || c.prices },
  { key: 'help', icon: 'help', label: 'คู่มือ' },
];

/* ระบบอื่นของ Spot of Quality: กลับไป HR.SPOT หรือไประบบอุปกรณ์ผ่านหน้าล็อกอินกลาง (ไม่ต้องกรอกรหัสซ้ำถ้ายังเข้าระบบ HR.SPOT อยู่) */
const OTHER_ICONS = {
  hr: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c2.9.2 5.5 2.6 5.5 5.8"/></svg>',
  eq: '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.7"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.6 17.1a1.5 1.5 0 0 0 2.1 2.1l5.7-5.7a4 4 0 0 0 5.1-5.4l-2.5 2.5-2.1-.5-.5-2.1z"/></svg>',
};
function otherAppsNav() {
  const hr = String(CONFIG.neon?.hrspotUrl || '');
  if (CONFIG.backend !== 'neon' || !/^https:\/\/[^\s"'<>]+$/.test(hr)) return '';
  const to = (app) => hr + (app ? (hr.includes('?') ? '&' : '?') + 'app=' + app : '');
  return `<div class="nav-group">ระบบอื่น</div>` +
    `<a href="${esc(to(''))}" class="nav-ext">${OTHER_ICONS.hr}<span>HR.SPOT</span></a>` +
    `<a href="${esc(to('equipment'))}" class="nav-ext" data-sso-app="equipment">${OTHER_ICONS.eq}<span>ระบบบริหารอุปกรณ์</span></a>`;
}
/* เข้าด้วยบัญชี HR.SPOT อยู่: ขอบัตรผ่านของระบบอุปกรณ์จาก HR.SPOT แล้วไปที่ระบบนั้นเลย (ไม่ต้องผ่านหน้า "ไปที่ …")
 * ถ้าขอไม่ได้ (บัตรหมดอายุ ไม่มีเน็ต ฯลฯ) ใช้ลิงก์ปกติ ซึ่งพาไปหน้าล็อกอินกลาง */
function bindOtherApps() {
  $$('a[data-sso-app]').forEach((a) => a.addEventListener('click', async (e) => {
    const sso = ssoRead(); const hr = String(CONFIG.neon?.hrspotUrl || '');
    if (!sso || !hr || a.dataset.busy) return; // ไม่มีบัตร HR.SPOT → ลิงก์ปกติ
    e.preventDefault(); a.dataset.busy = '1';
    const fallback = a.href; toast('กำลังเปิดระบบบริหารอุปกรณ์…');
    try {
      const r = await fetch(hr + (hr.includes('?') ? '&' : '?') + 'op=sso', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ app: a.dataset.ssoApp, jwt: sso.token }) });
      const d = await r.json();
      location.href = d && d.ok && /^https:\/\//.test(d.url) ? d.url : fallback;
    } catch (err) { location.href = fallback; }
  }));
}

function renderShell() {
  const u = ctx.me; const c = ctx.can;
  const nm = (u.display_name || u.email || 'U').replace(/[()]/g, '').trim();
  const initials = /^[A-Za-z]/.test(nm) ? nm.slice(0, 2).toUpperCase() : ({ admin: 'AD', executive: 'EX', warehouse: 'WH', branch: 'BR', sales: 'SA' }[u.role] || 'U');
  document.body.innerHTML = `<div class="app" id="app">
    <aside class="sidebar">
      <div class="brand"><div class="brand-mark">A</div><div><div class="brand-name">${esc(CONFIG.appName)}</div><div class="brand-sub">${esc(CONFIG.appSub)}</div></div></div>
      <nav class="nav">${NAV.map((n) => n.group ? `<div class="nav-group">${n.group}</div>` : (!n.show || n.show(c)) ? `<a href="#/${n.key}" data-nav="${n.key}">${ICONS[n.icon]}<span>${n.label}</span>${n.badge ? `<span class="nav-badge hidden" id="${n.badge}"></span>` : ''}</a>${n.sub ? `<div class="sub">${n.sub}</div>` : ''}` : '').join('')}${otherAppsNav()}</nav>
      <div class="sidebar-foot" id="me-btn" title="บัญชีผู้ใช้"><div class="avatar">${esc(initials)}</div><div style="min-width:0"><div class="user-name">${esc(u.display_name || u.email)}</div>
        <div class="user-role">${esc(ROLE[u.role])}${u.is_manager ? ' · ผู้จัดการ' : ''} · ${esc(u.site?.name || 'ทุกสาขา')}</div></div></div>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="iconbtn menu-btn" id="menu-btn" aria-label="เมนู">${ICONS.menu}</button>
        <div class="crumb" id="crumb"></div><div class="spacer"></div>
        ${ctx.api.mode === 'demo' ? '<span class="pill">ตัวอย่างหน้าจอ · ข้อมูลจำลอง</span>' : ''}
        <button class="pill warn hidden" id="net-pill" title="รายการที่รอส่ง"></button>
        <span class="topdate">${thDateY(new Date().toISOString())}</span>
        <button class="iconbtn" id="bell" aria-label="แจ้งเตือน" title="แจ้งเตือนและงานรอตรวจ">${ICONS.bell}<span class="dot hidden" id="bell-dot"></span></button>
      </header>
      <main class="content" id="content"></main>
    </div></div>`;
  $('#menu-btn').onclick = () => $('#app').classList.toggle('nav-open');
  $('#app').addEventListener('click', (e) => { if (e.target.id === 'app') $('#app').classList.remove('nav-open'); });
  $$('.nav a').forEach((a) => (a.onclick = () => $('#app').classList.remove('nav-open')));
  $('#bell').onclick = () => go('alerts');
  $('#me-btn').onclick = () => docs.userMenu(ctx);
  $('#net-pill').onclick = () => docs.outboxModal(ctx);
  bindOtherApps();
  updateNetPill();
}

function updateNetPill() {
  const el = $('#net-pill'); if (!el || !ctx.api.outbox) return;
  const ob = ctx.api.outbox(); const pend = ob.filter((x) => x.status === 'pending').length; const failed = ob.filter((x) => x.status === 'failed').length;
  const off = ctx.api.offline;
  el.textContent = off ? `ออฟไลน์${pend ? ` · รอส่ง ${pend}` : ''}` : pend ? `รอส่ง ${pend} รายการ` : failed ? `ส่งไม่สำเร็จ ${failed}` : '';
  el.classList.toggle('hidden', !off && !pend && !failed);
  el.classList.toggle('danger', !!failed && !pend && !off);
}
window.addEventListener('avo:net', updateNetPill);
window.addEventListener('avo:outbox', updateNetPill);
window.addEventListener('avo:synced', () => { toast('ส่งรายการที่บันทึกตอนออฟไลน์แล้ว', 'ok'); updateNetPill(); if (ctx.me) route(); });

export function go(path) { location.hash = '#/' + path; }
ctx.go = go;

async function route() {
  if (!ctx.me) return;
  const parts = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/').map(decodeURIComponent);
  // ลิงก์จาก QR บนป้าย Lot: #/lot/LOT-xxxx
  if (parts[0] === 'lot' && parts[1]) { history.replaceState(null, '', location.pathname + location.search + '#/' + (ctx.can.seeWarehouse ? 'warehouse' : 'branches')); await route(); docs.lotTrace(ctx, parts[1].toUpperCase()); return; }
  let key = parts[0]; if (!PAGES[key]) key = 'dashboard';
  const navKey = key === 'alerts' ? null : key;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === navKey));
  $('#crumb').innerHTML = `${esc(CONFIG.appName)} / <b>${esc(PAGES[key].title)}</b>`;
  const el = $('#content'); el.innerHTML = '<div class="spinner"></div>';
  ctx.page = key; ctx.params = parts.slice(1);
  try {
    const mod = await PAGES[key].load();
    if (ctx.page !== key) return;
    await mod.render(el, ctx, parts.slice(1));
  } catch (e) {
    if (!(e instanceof AppError)) console.error(e);
    el.innerHTML = `<div class="notice">${esc(e.message || e)}</div>`;
  }
  refreshBell();
  window.scrollTo(0, 0);
}
ctx.rerender = () => route();

async function refreshBell() {
  try {
    const a = await ctx.api.rpc('api_alerts', {});
    const n = a.filter((x) => x.level !== 'info' || ['pending_receipt', 'pending_adjust', 'pending_return', 'pending_stocktake'].includes(x.kind)).length;
    const dot = $('#bell-dot'); if (!dot) return; dot.textContent = n > 99 ? '99+' : n; dot.classList.toggle('hidden', !n);
    const t = await ctx.api.rpc('api_tasks', {});
    const nb = $('#nav-tasks'); const over = t.filter((x) => x.overdue).length;
    if (nb) { nb.textContent = over ? `${over} เกิน` : t.length; nb.classList.toggle('hidden', !t.length); nb.classList.toggle('danger', !!over); }
  } catch (e) { /* ignore */ }
}
ctx.refreshBell = refreshBell;

ctx.reloadMe = async () => {
  const r = await ctx.api.rpc('api_me', {});
  ctx.me = r.user; ctx.master = r.master; ctx.can = buildCan(ctx.me);
};

async function boot() {
  try {
    if (!ctx.api) ctx.api = await createApi();
  } catch (e) {
    authShell(`<div class="notice">${esc(e.message)}</div><p class="small muted">ผู้ดูแลระบบ: ตรวจสอบไฟล์ config.js ตามคู่มือ docs/DEPLOY.md</p>`); return;
  }
  const q = new URLSearchParams(location.search);
  if (q.get('reset') === '1') { showReset(q.get('token'), q.get('error')); return; }
  let s;
  try { s = await ctx.api.auth.getSession(); }
  catch (e) {
    // เปิดแอปตอนไม่มีสัญญาณ: ใช้ข้อมูลผู้ใช้ล่าสุดที่เก็บไว้ในเครื่อง
    const cached = ctx.api.cachedMe?.();
    if (cached?.user && cached.master) { ctx.me = cached.user; ctx.master = cached.master; ctx.can = buildCan(ctx.me); renderShell(); route(); toast('ออฟไลน์อยู่ — แสดงข้อมูลล่าสุดที่เก็บไว้ในเครื่อง'); return; }
    authShell(`<div class="notice">${esc(e.message)}</div><div class="actions" style="justify-content:center"><button class="btn primary" id="again">ลองใหม่</button></div>`);
    $('#again').onclick = () => boot(); return;
  }
  if (!s) { ctx.me = null; return ctx.api.mode === 'demo' ? showDemoLogin() : showLogin(); }
  try {
    const r = await ctx.api.rpc('api_me', { name: ctx.pendingName || s.name || null, email: s.email || null });
    if (r.user.role === 'pending' || !r.user.active) { ctx.me = null; return showPending(r.user); }
    ctx.me = r.user; ctx.master = r.master; ctx.can = buildCan(ctx.me);
  } catch (e) {
    ctx.me = null; await ctx.api.auth.signOut();
    return ctx.api.mode === 'demo' ? showDemoLogin() : showLogin('in', e.message);
  }
  renderShell();
  route();
  ctx.api.flush?.();
}

window.addEventListener('hashchange', route);
ctx.boot = boot;
boot();

// ติดตั้งเป็นแอป (PWA) + เก็บไฟล์ไว้ใช้ตอนออฟไลน์ — ข้ามในโหมดทดลอง/เปิดจากไฟล์
if ('serviceWorker' in navigator && location.protocol === 'https:' && CONFIG.backend !== 'demo') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* ignore */ }));
}
